import type { Game } from "diablo:game"

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
