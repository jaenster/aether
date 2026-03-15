import type { Game, Monster } from "diablo:game"
import { CollisionMask } from "./collision.js"

/**
 * Room-based area clearing with door-boundary detection.
 *
 * Scans the collision grid around the player to identify "logical rooms"
 * (connected walkable regions separated by walls). Doors/narrow passages
 * are the edges between rooms. Explores via DFS on the room graph,
 * clearing monsters in each room before moving to the next.
 */

const WALL_MASK = CollisionMask.BLOCK_WALK | CollisionMask.BLOCK_MISSILE
const SCAN_RADIUS = 40          // tiles around player to scan per step
const MONSTER_RANGE = 40        // scan range for monsters
const MAX_EXPLORE_STEPS = 80    // safety cap
const MAX_EMPTY_ROOMS = 6       // bail after N consecutive empty rooms

interface ClearContext {
  game: Game
  move: { moveTo(x: number, y: number): Generator<void> }
  atk: { clear(opts: any): Generator<void>, alive(m: Monster): boolean }
  loot: { lootGround(): Generator<void> }
  buffs: { needsRefresh(): boolean, refreshOne(): Generator<void> }
  priority?: (a: Monster, b: Monster) => number
  tag: string
}

interface Room {
  cx: number  // center x (world coords)
  cy: number  // center y
  tiles: number  // walkable tile count
  visited: boolean
}

/**
 * Discover logical rooms from the collision grid near (wx, wy).
 * Returns rooms as connected walkable regions, with centers.
 */
function discoverRooms(game: Game, wx: number, wy: number): Room[] {
  const r = SCAN_RADIUS
  const x0 = wx - r, y0 = wy - r
  const size = r * 2
  const grid = game.getCollisionRect(x0, y0, size, size)
  if (grid.length === 0) return []

  // Flood-fill to find connected walkable regions
  const visited = new Uint8Array(size * size)
  const rooms: Room[] = []

  for (let sy = 0; sy < size; sy++) {
    for (let sx = 0; sx < size; sx++) {
      const idx = sy * size + sx
      if (visited[idx]) continue
      const flags = grid[idx]!
      if (flags === 0xFFFF || (flags & WALL_MASK)) continue

      // Flood-fill this walkable region
      const stack: number[] = [idx]
      let sumX = 0, sumY = 0, count = 0

      while (stack.length > 0) {
        const ci = stack.pop()!
        if (visited[ci]) continue
        visited[ci] = 1

        const cx = ci % size, cy = (ci / size) | 0
        sumX += cx
        sumY += cy
        count++

        // 4-connected neighbors
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = cx + dx, ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue
          const ni = ny * size + nx
          if (visited[ni]) continue
          const nf = grid[ni]!
          if (nf === 0xFFFF || (nf & WALL_MASK)) continue
          stack.push(ni)
        }
      }

      if (count < 4) continue // skip tiny fragments

      rooms.push({
        cx: x0 + (sumX / count) | 0,
        cy: y0 + (sumY / count) | 0,
        tiles: count,
        visited: false,
      })
    }
  }

  return rooms
}

/**
 * Clear an entire area using room discovery + nearest-unvisited traversal.
 *
 * 1. Discover rooms from collision grid around current position
 * 2. Clear monsters in current room
 * 3. Move to nearest unvisited room
 * 4. Re-discover rooms (reveals new areas after moving)
 * 5. Repeat until no unvisited rooms remain
 */
export function* clearArea(ctx: ClearContext) {
  const { game, move, atk, loot, buffs, tag } = ctx
  let emptyStreak = 0
  let totalKills = 0
  const globalVisited = new Set<string>()

  function markVisited(x: number, y: number) {
    // Mark a 20-tile radius area as visited
    const gx = Math.floor(x / 20), gy = Math.floor(y / 20)
    globalVisited.add(`${gx},${gy}`)
  }

  function isVisited(x: number, y: number): boolean {
    const gx = Math.floor(x / 20), gy = Math.floor(y / 20)
    return globalVisited.has(`${gx},${gy}`)
  }

  for (let step = 0; step < MAX_EXPLORE_STEPS; step++) {
    if (!game.inGame) break

    markVisited(game.player.x, game.player.y)

    // Kill anything nearby
    const hasMonsters = game.monsters.find((m: Monster) => atk.alive(m) && m.distance < MONSTER_RANGE)

    if (hasMonsters) {
      emptyStreak = 0
      if (buffs.needsRefresh()) yield* buffs.refreshOne()

      const before = game.monsters.filter((m: Monster) => atk.alive(m)).length
      yield* atk.clear({ killRange: 30, maxCasts: 30, priority: ctx.priority })
      const after = game.monsters.filter((m: Monster) => atk.alive(m)).length
      totalKills += Math.max(0, before - after)

      yield* loot.lootGround()
      continue // re-check for more monsters before exploring
    }

    emptyStreak++
    if (emptyStreak >= MAX_EMPTY_ROOMS) {
      game.log(`${tag} ${emptyStreak} empty rooms — area clear`)
      break
    }

    // Discover rooms around current position
    const rooms = discoverRooms(game, game.player.x, game.player.y)

    // Find nearest unvisited room
    let best: Room | null = null
    let bestDist = Infinity
    for (const room of rooms) {
      if (isVisited(room.cx, room.cy)) continue
      const dx = room.cx - game.player.x, dy = room.cy - game.player.y
      const d = dx * dx + dy * dy
      if (d < bestDist) {
        bestDist = d
        best = room
      }
    }

    if (!best) {
      // No unvisited rooms nearby — try a wider search by teleporting outward
      const angle = (step * 137.5) * Math.PI / 180
      const r = 30 + emptyStreak * 10
      const tx = game.player.x + Math.round(Math.cos(angle) * r)
      const ty = game.player.y + Math.round(Math.sin(angle) * r)
      yield* move.moveTo(tx, ty)
      continue
    }

    yield* move.moveTo(best.cx, best.cy)
  }

  game.log(`${tag} cleared (${globalVisited.size} zones, ~${totalKills} kills)`)
}
