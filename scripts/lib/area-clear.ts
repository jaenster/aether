import type { Game, Monster } from "diablo:game"

/**
 * Grid-based area clearing with nearest-unvisited exploration.
 *
 * Divides the reachable area into cells, clears monsters at each cell,
 * then moves to the nearest unvisited cell. Efficiently covers dungeon
 * layouts without solving full TSP — uses greedy nearest-neighbor.
 */

const CELL_SIZE = 30           // tile size per grid cell
const MONSTER_SCAN_RANGE = 40  // how far to scan for monsters
const MAX_EXPLORE_STEPS = 100  // safety cap on exploration steps
const MAX_EMPTY_STREAK = 8     // bail after N consecutive empty cells

interface ClearContext {
  game: Game
  move: { moveTo(x: number, y: number): Generator<void> }
  atk: { clear(opts: any): Generator<void>, alive(m: Monster): boolean }
  loot: { lootGround(): Generator<void> }
  buffs: { needsRefresh(): boolean, refreshOne(): Generator<void> }
  priority?: (a: Monster, b: Monster) => number
  tag: string
}

/** Track visited cells using a Set of "cx,cy" keys */
class ExplorationGrid {
  private visited = new Set<string>()
  private frontier: { x: number, y: number }[] = []

  private key(x: number, y: number) { return `${x},${y}` }
  private cellOf(wx: number, wy: number) {
    return { x: Math.floor(wx / CELL_SIZE), y: Math.floor(wy / CELL_SIZE) }
  }

  /** Mark the cell at world coords as visited, expand frontier */
  visit(wx: number, wy: number) {
    const c = this.cellOf(wx, wy)
    const k = this.key(c.x, c.y)
    if (this.visited.has(k)) return
    this.visited.add(k)

    // Add neighbors to frontier
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]) {
      const nk = this.key(c.x + dx, c.y + dy)
      if (!this.visited.has(nk)) {
        this.frontier.push({ x: c.x + dx, y: c.y + dy })
      }
    }
  }

  /** Get the nearest unvisited frontier cell to world position (wx, wy) */
  nearestUnvisited(wx: number, wy: number): { x: number, y: number } | null {
    // Prune already-visited cells from frontier
    this.frontier = this.frontier.filter(c => !this.visited.has(this.key(c.x, c.y)))

    if (this.frontier.length === 0) return null

    let best: { x: number, y: number } | null = null
    let bestDist = Infinity
    for (const c of this.frontier) {
      const cx = c.x * CELL_SIZE + CELL_SIZE / 2
      const cy = c.y * CELL_SIZE + CELL_SIZE / 2
      const dx = cx - wx, dy = cy - wy
      const d = dx * dx + dy * dy
      if (d < bestDist) {
        bestDist = d
        best = c
      }
    }
    return best
  }

  get visitedCount() { return this.visited.size }
  get frontierCount() { return this.frontier.length }
}

/**
 * Clear an entire area by exploring grid cells and killing monsters.
 * Handles dungeon layouts (corridors, rooms) via nearest-frontier traversal.
 */
export function* clearArea(ctx: ClearContext) {
  const { game, move, atk, loot, buffs, tag } = ctx
  const grid = new ExplorationGrid()
  let emptyStreak = 0
  let totalKills = 0

  for (let step = 0; step < MAX_EXPLORE_STEPS; step++) {
    if (!game.inGame) break

    // Mark current position as visited
    grid.visit(game.player.x, game.player.y)

    // Scan for monsters
    const hasMonsters = game.monsters.find((m: Monster) => atk.alive(m) && m.distance < MONSTER_SCAN_RANGE)

    if (hasMonsters) {
      emptyStreak = 0
      if (buffs.needsRefresh()) yield* buffs.refreshOne()

      const before = game.monsters.filter((m: Monster) => atk.alive(m)).length
      yield* atk.clear({ killRange: CELL_SIZE, maxCasts: 30, priority: ctx.priority })
      const after = game.monsters.filter((m: Monster) => atk.alive(m)).length
      totalKills += Math.max(0, before - after)

      yield* loot.lootGround()
    } else {
      emptyStreak++
      if (emptyStreak >= MAX_EMPTY_STREAK) {
        game.log(`${tag} no monsters in ${emptyStreak} cells — area clear`)
        break
      }
    }

    // Find next cell to explore
    const next = grid.nearestUnvisited(game.player.x, game.player.y)
    if (!next) {
      game.log(`${tag} all reachable cells explored`)
      break
    }

    // Teleport to the center of the next cell
    const tx = next.x * CELL_SIZE + CELL_SIZE / 2
    const ty = next.y * CELL_SIZE + CELL_SIZE / 2
    yield* move.moveTo(tx, ty)
  }

  game.log(`${tag} cleared (${grid.visitedCount} cells, ~${totalKills} kills)`)
}
