import type { Game } from "diablo:game"
import { seedAdvance, seedRoll, type D2Seed } from "./seed.js"

export type { D2Seed }
export { seedAdvance, seedRoll, seedClone } from "./seed.js"

export interface Pos { x: number, y: number }

// Common collision masks (from D2 collision grid flags)
export const CollisionMask = {
  BLOCK_WALK:    0x0001, // blocks player/monster walking (includes lava, gaps)
  BLOCK_MISSILE: 0x0004, // blocks missiles/spells (actual walls)
  BLOCK_PLAYER:  0x0008, // blocks player specifically
  OBJECT:        0x0400, // objects (barrels, shrines, etc.)
  DOOR:          0x0800, // closed doors
  // Composite masks
  SPAWN: 0x3f11,         // server's FindSpawnableLocation mask
  SPELL_LOS: 0x0C04,     // missile LoS (walls + objects + doors, NOT walk-blocking)
} as const

/**
 * Replicate D2's FindSpawnableLocation @ 0x00545340.
 *
 * Searches outward from (cx, cy) in expanding rectangular rings for a position
 * where a (scanRadius*2+1) square area has no collision flags matching `mask`.
 *
 * Server algorithm:
 * - halfR = scanRadius >> 1
 * - startX = cx - halfR, startY = cy - halfR
 * - For each ring (1..maxRings): Y descends (ring to -ring, step -2), X ascends (-ring to ring, step +2)
 * - At each candidate: check (scanRadius*2+1)x(scanRadius*2+1) area via CheckCollision_Vector
 * - If clear: return (candidate + halfR, candidate + halfR)
 *
 * Since we don't have CheckCollision_Vector on the client, we approximate by checking
 * the center point + cardinal/diagonal samples within the square.
 */
export function findSpawnableLocation(
  game: Game, cx: number, cy: number,
  scanRadius = 3, mask: number = CollisionMask.SPAWN, maxRings = 100
): Pos | null {
  const halfR = scanRadius >> 1
  const startX = cx - halfR
  const startY = cy - halfR
  const vecSize = scanRadius * 2 + 1

  for (let ring = 1; ring < maxRings; ring++) {
    // Y descends (ring to -ring), X ascends (-ring to ring), stride 2
    for (let dy = ring; dy >= -ring; dy -= 2) {
      const nY = dy + startY
      for (let dx = -ring; dx <= ring; dx += 2) {
        const nX = dx + startX
        if (checkArea(game, nX, nY, vecSize, mask)) {
          return { x: nX + halfR, y: nY + halfR }
        }
      }
    }
  }

  return null
}

/**
 * Safe collision check — returns -1 for unloaded tiles, treats as blocked.
 */
function safeCollision(game: Game, x: number, y: number, mask: number): boolean {
  const c = game.getCollision(x, y)
  return c >= 0 && (c & mask) === 0
}

/**
 * Check if a square area centered at (x, y) with size `size` is free of collision flags.
 * Approximates CheckCollision_Vector by sampling key points in the area.
 * Returns false if any tile is unloaded (-1) or blocked.
 */
function checkArea(game: Game, x: number, y: number, size: number, mask: number): boolean {
  const half = size >> 1
  // Check center first — if unloaded, area is too far away
  if (!safeCollision(game, x + half, y + half, mask)) return false
  // Check corners
  if (!safeCollision(game, x, y, mask)) return false
  if (!safeCollision(game, x + size - 1, y, mask)) return false
  if (!safeCollision(game, x, y + size - 1, mask)) return false
  if (!safeCollision(game, x + size - 1, y + size - 1, mask)) return false
  // Check edge midpoints
  if (!safeCollision(game, x + half, y, mask)) return false
  if (!safeCollision(game, x + half, y + size - 1, mask)) return false
  if (!safeCollision(game, x, y + half, mask)) return false
  if (!safeCollision(game, x + size - 1, y + half, mask)) return false
  return true
}

/**
 * Convenience: find a spawnable location near a point, matching what the server does
 * for monster/object placement (radius=3, mask=0x3f11).
 */
export function findMonsterSpawnPoint(game: Game, x: number, y: number): Pos | null {
  return findSpawnableLocation(game, x, y, 3, CollisionMask.SPAWN, 100)
}

/**
 * Replicate CheckCollision_BlockAll_Width — checks collision for a monster of given SizeX.
 * Returns true if the tile is CLEAR (no collision).
 */
function checkCollisionWidth(game: Game, x: number, y: number, sizeX: number, mask: number): boolean {
  const c = game.getCollision(x, y)
  if (c < 0 || (c & mask) !== 0) return false

  if (sizeX >= 2) {
    // Cross pattern: center + 4 cardinal neighbors
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cc = game.getCollision(x + dx!, y + dy!)
      if (cc < 0 || (cc & mask) !== 0) return false
    }
  }

  if (sizeX >= 3) {
    // 3x3 bounding box: add diagonal corners
    for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const cc = game.getCollision(x + dx!, y + dy!)
      if (cc < 0 || (cc & mask) !== 0) return false
    }
  }

  return true
}

// ── SpawnMonster position search ────────────────────────────────────

// Collision masks by spawnCol (from MonStats2.txt)
const SPAWN_COL_MASK: Record<number, number> = {
  0: 0x3C01,
  1: 0x01C0,
  2: 0x3F11,
  3: 0x0000,
}

/**
 * Replicate D2's CreateMonster @ 0x005b2a00 spawn position search.
 *
 * Algorithm: random perimeter walk at expanding radii (3, 6, 9...).
 * Room RNG determines starting corner + direction. Walks the full
 * perimeter checking collision at each tile.
 *
 * Matches the exact Ghidra decompilation:
 * - Corner detection uses == (exact), not <= / >=
 * - Step order: y += dy THEN x += dx (not x first)
 * - Corner grouping matches server's if/else structure
 */
/**
 * Optional room bounds for clipping the perimeter walk.
 * Server uses DRLGROOM_GetRoomCoordinates if no coord list provided.
 */
export interface RoomBounds {
  left: number, top: number, right: number, bottom: number
}

export function predictSpawnMonsterPosition(
  game: Game, seed: D2Seed,
  cx: number, cy: number,
  nSpawnRadius: number,
  spawnCol: number,
  sizeX = 1,
  roomBounds?: RoomBounds,
): Pos | null {
  const maxRadius = nSpawnRadius * 3
  const mask = SPAWN_COL_MASK[spawnCol] ?? 0x3C01

  for (let radius = 3; radius <= maxRadius; radius += 3) {
    const range = radius * 2

    // RNG step 1: coin flip — checks LOW bit of full seed (not just high)
    seedAdvance(seed)
    const coin = (seed.low & 1) === 0

    // local_1c = X offset, local_14 = Y offset
    let offX: number, offY: number
    let dx: number, dy: number
    if (coin) {
      offX = seedRoll(seed, range >> 1) // random X offset
      offY = radius                      // fixed Y = radius
      dx = 1; dy = 0
    } else {
      offX = radius                      // fixed X = radius
      offY = seedRoll(seed, range >> 1)  // random Y offset
      dx = 0; dy = 1
    }

    // RNG step 2: negate X if odd
    seedAdvance(seed)
    if (seed.low & 1) offX = -offX

    // RNG step 3: negate Y if odd
    seedAdvance(seed)
    if (seed.low & 1) offY = -offY

    let px = cx + offX
    let py = cy + offY

    const left = cx - radius
    const right = cx + radius
    const top = cy - radius
    const bottom = cy + radius

    let steps = radius * 8
    while (steps > 0) {
      // Corner detection — exact match with server's if/else structure
      if (px === left && py === top) {
        dx = 1; dy = 0
      }
      if (px === right) {
        if (py === top) { dx = 0; dy = 1 }
        if (py === bottom) { dx = -1; dy = 0 }
      }
      if (px === left) {
        if (py === bottom) { dx = 0; dy = -1 }
      }

      // Step: y first, then x (matches server)
      py += dy
      px += dx

      // Room bounds clip (PtInRect) — server skips tiles outside the room
      if (roomBounds) {
        if (px < roomBounds.left || px >= roomBounds.right ||
            py < roomBounds.top || py >= roomBounds.bottom) {
          steps--
          continue
        }
      }

      // Collision check — width-aware (matches CheckCollision_BlockAll_Width)
      if (mask === 0 || checkCollisionWidth(game, px, py, sizeX, mask)) {
        return { x: px, y: py }
      }

      steps--
    }
  }

  return null
}
