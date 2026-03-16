import type { Game, Monster } from "diablo:game"
import { CollisionMask } from "./collision.js"

const WALL_MASK = CollisionMask.BLOCK_WALK | CollisionMask.BLOCK_MISSILE
const SCAN_SIZE = 60           // collision grid scan per step (tiles per side)
const CLEAR_RADIUS = 20        // tiles around player marked as "cleared" per visit
const KILL_RANGE = 30          // scan + attack range
const MAX_STEPS = 200          // safety cap

interface ClearContext {
  game: Game
  move: { moveTo(x: number, y: number): Generator<void> }
  atk: { clear(opts: any): Generator<void>, alive(m: Monster): boolean }
  loot: { lootGround(): Generator<void> }
  buffs: { needsRefresh(): boolean, refreshOne(): Generator<void> }
  priority?: (a: Monster, b: Monster) => number
  tag: string
}

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

  addWalkable(tiles: { x: number, y: number }[]): number {
    let added = 0
    for (const t of tiles) {
      const k = this.cellKey(t.x, t.y)
      if (!this.walkable.has(k)) {
        this.walkable.add(k)
        added++
      }
    }
    return added
  }

  removeWalkable(wx: number, wy: number) {
    this.walkable.delete(this.cellKey(wx, wy))
  }

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

  get unclearedCount(): number {
    let count = 0
    for (const key of this.walkable) {
      if (!this.cleared.has(key)) count++
    }
    return count
  }

  get clearedCount() { return this.cleared.size }
  get walkableCount() { return this.walkable.size }
}

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

function findWalkableNear(game: Game, x: number, y: number): { x: number, y: number } | null {
  const coll = game.getCollision(x, y)
  if (coll >= 0 && !(coll & WALL_MASK)) return { x, y }
  for (let r = 1; r <= 8; r++) {
    for (const [dx, dy] of [[r,0],[-r,0],[0,r],[0,-r],[r,r],[-r,-r],[r,-r],[-r,r]]) {
      const c = game.getCollision(x + dx, y + dy)
      if (c >= 0 && !(c & WALL_MASK)) return { x: x + dx, y: y + dy }
    }
  }
  return null
}

export function* clearArea(ctx: ClearContext) {
  const { game, move, atk, loot, buffs, tag } = ctx
  const map = new ClearedMap()
  let totalKills = 0
  let consecutiveEmpty = 0

  for (let step = 0; step < MAX_STEPS; step++) {
    if (!game.inGame) break

    // Mark current position as cleared
    map.markCleared(game.player.x, game.player.y)

    // Scan collision around us — discover new walkable cells
    const walkable = scanWalkable(game, game.player.x, game.player.y)
    const newCells = map.addWalkable(walkable)
    if (newCells > 0) consecutiveEmpty = 0 // discovered new territory

    // Kill anything nearby
    const hasMonsters = game.monsters.find((m: Monster) => atk.alive(m) && m.distance < KILL_RANGE)

    if (hasMonsters) {
      consecutiveEmpty = 0
      if (buffs.needsRefresh()) yield* buffs.refreshOne()

      const before = game.monsters.filter((m: Monster) => atk.alive(m)).length
      yield* atk.clear({ killRange: KILL_RANGE, maxCasts: 40, priority: ctx.priority })
      const after = game.monsters.filter((m: Monster) => atk.alive(m)).length
      totalKills += Math.max(0, before - after)

      yield* loot.lootGround()
      continue
    }

    // Find next uncleared cell
    let next = map.nearestUncleared(game.player.x, game.player.y)

    if (!next) {
      // All known cells cleared — explore outward to discover more of the dungeon.
      // Teleport in a spiral pattern to scan new regions beyond the initial radius.
      consecutiveEmpty++
      if (consecutiveEmpty > 15) {
        game.log(`${tag} all ${map.walkableCount} cells explored, no more territory found`)
        break
      }
      const angle = (step * 137.5) * Math.PI / 180
      const r = 30 + consecutiveEmpty * 8
      const ex = game.player.x + Math.round(Math.cos(angle) * r)
      const ey = game.player.y + Math.round(Math.sin(angle) * r)
      yield* move.moveTo(ex, ey)
      continue
    }

    consecutiveEmpty = 0

    // Find a walkable position near the target cell center
    // Just teleport there — D2's teleport snaps to nearest walkable tile.
    // Don't pre-check collision since the room might not be loaded yet.
    yield* move.moveTo(next.x, next.y)
  }

  game.log(`${tag} done (${map.clearedCount}/${map.walkableCount} cells, ~${totalKills} kills)`)
}
