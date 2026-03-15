import type { Game } from "diablo:game"
import { seedAdvance, seedRoll } from "./seed.js"

export type { D2Seed } from "./seed.js"
export { seedClone } from "./seed.js"
// Re-export the ones we also use locally
export { seedAdvance, seedRoll }

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

// ── SpawnMonster position search ────────────────────────────────────

// Collision masks by spawnCol (from MonStats2.txt)
const SPAWN_COL_MASK: Record<number, number> = {
  0: 0x3C01,
  1: 0x01C0,
  2: 0x3F11,
  3: 0x0000,
}

/**
 * Replicate D2's CreateMonster spawn position search.
 * Uses the room's RNG seed to determine the random starting point on the
 * perimeter, then walks the perimeter checking collision.
 *
 * @param game - Game instance for collision checks
 * @param seed - Room seed (read via game.getRoomSeed, COPIED — will be mutated)
 * @param cx, cy - Center position (glow/target coords)
 * @param nSpawnRadius - SpawnMonster's radius param (1 for seal bosses → maxRadius=3)
 * @param spawnCol - From MonStats2.txt (determines collision mask)
 */
export function predictSpawnMonsterPosition(
  game: Game, seed: D2Seed,
  cx: number, cy: number,
  nSpawnRadius: number,
  spawnCol: number,
): Pos | null {
  const maxRadius = nSpawnRadius * 3
  const mask = SPAWN_COL_MASK[spawnCol] ?? 0x3C01

  for (let radius = 3; radius <= maxRadius; radius += 3) {
    const range = radius * 2

    // RNG step 1: pick axis (coin flip)
    seedAdvance(seed)
    const coin = (seed.high & 1) === 0

    let startA: number, startB: number
    let dx: number, dy: number
    if (coin) {
      startA = seedRoll(seed, range >> 1)
      startB = radius
      dx = 1; dy = 0
    } else {
      startA = radius
      startB = seedRoll(seed, range >> 1)
      dx = 0; dy = 1
    }

    // RNG step 2: sign of A
    seedAdvance(seed)
    if (seed.high & 1) startA = -startA

    // RNG step 3: sign of B
    seedAdvance(seed)
    if (seed.high & 1) startB = -startB

    let px = cx + startA
    let py = cy + startB

    const left = cx - radius
    const right = cx + radius
    const top = cy - radius
    const bottom = cy + radius

    const steps = radius * 8
    for (let i = 0; i < steps; i++) {
      // Corner detection → direction change
      if (px <= left  && py <= top)    { dx =  1; dy =  0 }
      if (px >= right && py <= top)    { dx =  0; dy =  1 }
      if (px >= right && py >= bottom) { dx = -1; dy =  0 }
      if (px <= left  && py >= bottom) { dx =  0; dy = -1 }

      px += dx
      py += dy

      // Collision check (simplified — uses single-tile check, not SizeX-aware)
      const c = game.getCollision(px, py)
      if (c < 0) continue // unloaded tile
      if (mask === 0 || (c & mask) === 0) {
        return { x: px, y: py }
      }
    }
  }

  return null
}
