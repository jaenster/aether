import type { Game, Monster } from "diablo:game"
import { CollisionMask } from "./collision.js"

/**
 * Area clearing using collision-based room discovery.
 *
 * Scans the collision grid to find walkable tiles, tracks which tiles
 * have been "cleared" (player was close enough to see monsters), and
 * moves to the nearest uncleared walkable tile. Monsters always take
 * priority over exploration.
 */

const WALL_MASK = CollisionMask.BLOCK_WALK | CollisionMask.BLOCK_MISSILE
const SCAN_SIZE = 60           // collision grid scan per step (tiles per side)
const CLEAR_RADIUS = 20        // tiles around player marked as "cleared" per visit
const KILL_RANGE = 30          // scan + attack range (same for both)
const MAX_STEPS = 120          // safety cap
const MAX_EMPTY_STREAK = 12    // bail after N consecutive empty positions

interface ClearContext {
  game: Game
  move: { moveTo(x: number, y: number): Generator<void> }
  atk: { clear(opts: any): Generator<void>, alive(m: Monster): boolean }
  loot: { lootGround(): Generator<void> }
  buffs: { needsRefresh(): boolean, refreshOne(): Generator<void> }
  priority?: (a: Monster, b: Monster) => number
  tag: string
}

/**
 * Track cleared positions using a grid of cells.
 * Cell size matches CLEAR_RADIUS so each visit clears exactly one cell.
 */
class ClearedMap {
  private cleared = new Set<string>()
  private walkable = new Set<string>()

  private cellKey(wx: number, wy: number): string {
    return `${Math.floor(wx / CLEAR_RADIUS)},${Math.floor(wy / CLEAR_RADIUS)}`
  }

  markCleared(wx: number, wy: number) {
    this.cleared.add(this.cellKey(wx, wy))
  }

  isCleared(wx: number, wy: number): boolean {
    return this.cleared.has(this.cellKey(wx, wy))
  }

  /** Register walkable tiles discovered from collision scan */
  addWalkable(tiles: { x: number, y: number }[]) {
    for (const t of tiles) {
      this.walkable.add(this.cellKey(t.x, t.y))
    }
  }

  /** Find nearest uncleared walkable cell center */
  nearestUncleared(wx: number, wy: number): { x: number, y: number } | null {
    let best: { x: number, y: number } | null = null
    let bestDist = Infinity

    for (const key of this.walkable) {
      if (this.cleared.has(key)) continue
      const [gx, gy] = key.split(',').map(Number)
      const cx = gx! * CLEAR_RADIUS + CLEAR_RADIUS / 2
      const cy = gy! * CLEAR_RADIUS + CLEAR_RADIUS / 2
      const dx = cx - wx, dy = cy - wy
      const d = dx * dx + dy * dy
      if (d < bestDist) {
        bestDist = d
        best = { x: cx, y: cy }
      }
    }
    return best
  }

  get clearedCount() { return this.cleared.size }
  get walkableCount() { return this.walkable.size }
}

/** Scan collision grid and return walkable tile positions */
function scanWalkable(game: Game, cx: number, cy: number): { x: number, y: number }[] {
  const half = SCAN_SIZE / 2
  const x0 = cx - half, y0 = cy - half
  const grid = game.getCollisionRect(x0, y0, SCAN_SIZE, SCAN_SIZE)
  if (grid.length === 0) return []

  const result: { x: number, y: number }[] = []
  for (let dy = 0; dy < SCAN_SIZE; dy++) {
    for (let dx = 0; dx < SCAN_SIZE; dx++) {
      const flags = grid[dy * SCAN_SIZE + dx]!
      if (flags !== 0xFFFF && !(flags & WALL_MASK)) {
        result.push({ x: x0 + dx, y: y0 + dy })
      }
    }
  }
  return result
}

/**
 * Clear an area by systematically visiting all walkable regions.
 */
export function* clearArea(ctx: ClearContext) {
  const { game, move, atk, loot, buffs, tag } = ctx
  const map = new ClearedMap()
  let emptyStreak = 0
  let totalKills = 0

  for (let step = 0; step < MAX_STEPS; step++) {
    if (!game.inGame) break

    // Mark current position as cleared
    map.markCleared(game.player.x, game.player.y)

    // Scan collision around us and register walkable tiles
    const walkable = scanWalkable(game, game.player.x, game.player.y)
    map.addWalkable(walkable)

    // Kill anything nearby
    const hasMonsters = game.monsters.find((m: Monster) => atk.alive(m) && m.distance < KILL_RANGE)

    if (hasMonsters) {
      emptyStreak = 0
      if (buffs.needsRefresh()) yield* buffs.refreshOne()

      const before = game.monsters.filter((m: Monster) => atk.alive(m)).length
      yield* atk.clear({ killRange: KILL_RANGE, maxCasts: 30, priority: ctx.priority })
      const after = game.monsters.filter((m: Monster) => atk.alive(m)).length
      totalKills += Math.max(0, before - after)

      yield* loot.lootGround()
      continue // re-check before exploring
    }

    emptyStreak++
    if (emptyStreak >= MAX_EMPTY_STREAK) {
      game.log(`${tag} ${emptyStreak} empty visits — area clear`)
      break
    }

    // Move to nearest uncleared walkable cell
    const next = map.nearestUncleared(game.player.x, game.player.y)
    if (!next) {
      game.log(`${tag} all walkable cells cleared`)
      break
    }

    // Verify destination is actually walkable (cell center might be in a wall)
    let tx = next.x, ty = next.y
    const coll = game.getCollision(tx, ty)
    if (coll === -1 || (coll & WALL_MASK)) {
      // Cell center is blocked — find a nearby walkable tile
      let found = false
      for (let r = 1; r <= 5 && !found; r++) {
        for (const [dx, dy] of [[r,0],[-r,0],[0,r],[0,-r],[r,r],[-r,-r]]) {
          const c2 = game.getCollision(tx + dx, ty + dy)
          if (c2 >= 0 && !(c2 & WALL_MASK)) {
            tx += dx; ty += dy
            found = true
            break
          }
        }
      }
      if (!found) {
        // Can't reach this cell — mark it cleared and skip
        map.markCleared(next.x, next.y)
        continue
      }
    }

    yield* move.moveTo(tx, ty)
  }

  game.log(`${tag} done (${map.clearedCount}/${map.walkableCount} cells, ~${totalKills} kills)`)
}
