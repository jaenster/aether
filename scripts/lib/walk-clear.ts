/**
 * Walk-clear system — ported from Ryuk's MoveTo.ts + clear.ts + Pather.ts
 *
 * Core pattern: walk node-by-node, call clear() after each node.
 * clear() fights all monsters in range, with backtrack when overwhelmed
 * and forward-track when target too far.
 */

import type { Game, Monster } from "diablo:game"
import { Line } from "diablo:game"
import { getUnitStat } from "diablo:native"

const BELT_LOCATION = 2 // ItemContainer.Belt value

const CLEAR_RANGE = 25       // base clear range in tiles (monsters visible at ~30, need margin)
const BACKTRACK_NODES = 5    // max nodes to backtrack
const FORWARD_TRACK_DIST = 15 // forward-track if closest monster > this
const JUKE_CHANCE = 0.07     // 7% random juke after each attack
const MAX_CASTS_PER_NODE = 200 // max total casts per node clearing round
const CASTS_PER_BURST = 50   // casts per atk.clear burst (fight until dead)
const SHAMAN_RANGE_MULT = 1.6 // shamans detected at 1.6x range

// Shaman classids (Fallen Shamans + Greater Mummies)
const SHAMAN_IDS = new Set([118, 119, 120, 121, 122, 212, 213, 214, 215, 216])
const FALLEN_IDS = new Set([113, 114, 115, 116, 117])

function dist(x1: number, y1: number, x2: number, y2: number) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2)
}

interface WalkNode { x: number; y: number }

interface ClearOpts {
  range?: number
  nodes?: WalkNode[]
  nodeIndex?: number
  killRange?: number
  maxCasts?: number
}

// ── clear() — fight all monsters in range ──────────────────────────

function getAttackableMonsters(game: Game, range: number, nodes?: WalkNode[], nodeIndex?: number): Monster[] {
  const px = game.player.x, py = game.player.y
  const result: Monster[] = []

  for (const m of game.monsters) {
    if (!m.isAttackable) continue
    const d = m.distance

    // In range of player
    if (d < range) { result.push(m); continue }

    // Shaman bonus: detect shamans at 1.6x range
    if (SHAMAN_IDS.has(m.classid) && d < range * SHAMAN_RANGE_MULT) {
      result.push(m)
      continue
    }

    // Near upcoming path nodes (next 5 nodes within 30 tiles)
    if (nodes && nodeIndex !== undefined) {
      const smallRange = range * 2 / 3
      for (let ni = nodeIndex; ni < Math.min(nodeIndex + 5, nodes.length); ni++) {
        const node = nodes[ni]!
        if (dist(node.x, node.y, px, py) > 30) break
        if (dist(m.x, m.y, node.x, node.y) < smallRange) {
          result.push(m)
          break
        }
      }
    }
  }
  return result
}

function sortMonsters(monsters: Monster[], px: number, py: number): void {
  // Shamans first, then specials, then by distance. Fallens last if shaman alive.
  const hasShamans = monsters.some(m => SHAMAN_IDS.has(m.classid))

  monsters.sort((a, b) => {
    const aShaman = SHAMAN_IDS.has(a.classid) ? 1 : 0
    const bShaman = SHAMAN_IDS.has(b.classid) ? 1 : 0
    if (aShaman !== bShaman) return bShaman - aShaman // shamans first

    // Deprioritize fallens when shamans exist
    if (hasShamans) {
      const aFallen = FALLEN_IDS.has(a.classid) ? 1 : 0
      const bFallen = FALLEN_IDS.has(b.classid) ? 1 : 0
      if (aFallen !== bFallen) return aFallen - bFallen // fallens last
    }

    return a.distance - b.distance // closest first
  })
}

/** Should we backtrack? Ryuk: pressure >= floor(4 * hp% + 1) */
function shouldBacktrack(game: Game): boolean {
  const hpPct = game.player.hp / game.player.maxHp
  const maxPressure = Math.floor(4 * hpPct) + 1

  let pressure = 0
  for (const m of game.monsters) {
    if (m.isAttackable && m.distance < 10) pressure++
  }
  for (const missile of game.missiles) {
    if (missile.distance < 10) pressure++
  }

  return pressure >= maxPressure
}

export interface AttackFn {
  clear(opts: { killRange: number, maxCasts: number }): Generator<void>
}

/**
 * clear() — fight all monsters in range, with backtrack/forward-track.
 * Ported from Ryuk's clear.ts.
 */
export function* clear(
  game: Game,
  atk: AttackFn,
  opts: ClearOpts = {},
): Generator<void> {
  const range = opts.range ?? CLEAR_RANGE
  const maxCasts = opts.maxCasts ?? MAX_CASTS_PER_NODE

  game.log('[clear] getAttackable...')
  let targets = getAttackableMonsters(game, range, opts.nodes, opts.nodeIndex)
  game.log('[clear] targets=' + targets.length)
  if (targets.length === 0) return

  sortMonsters(targets, game.player.x, game.player.y)

  // Fight loop — keep attacking until no targets or cast budget exhausted
  let totalCasts = 0
  while (targets.length > 0 && totalCasts < maxCasts) {
    // Backtrack check — run away when overwhelmed
    if (shouldBacktrack(game) && opts.nodes && opts.nodeIndex !== undefined) {
      const btIdx = Math.max(0, opts.nodeIndex - BACKTRACK_NODES)
      const btNode = opts.nodes[btIdx]!
      game.log(`[clear] backtracking to node ${btIdx}`)
      // Actually walk back, not just a single click
      for (let t = 0; t < 30; t++) {
        game.move(btNode.x, btNode.y)
        yield
        if (dist(game.player.x, game.player.y, btNode.x, btNode.y) < 5) break
      }
      yield* game.delay(200)
    }

    // Forward track: if closest monster > 15 tiles, advance toward it
    if (targets[0]!.distance > FORWARD_TRACK_DIST) {
      const t = targets[0]!
      game.move(t.x, t.y)
      for (let w = 0; w < 15; w++) {
        yield
        if (t.distance < 10) break
      }
    }

    // Attack — give enough casts to kill a pack, not just 8
    const burst = Math.min(CASTS_PER_BURST, maxCasts - totalCasts)
    yield* atk.clear({ killRange: range + 5, maxCasts: burst })
    totalCasts += burst

    // Random juke (7% chance) — small dodge movement
    if (Math.random() < JUKE_CHANCE) {
      const jx = game.player.x + Math.round(Math.random() * 8 - 4)
      const jy = game.player.y + Math.round(Math.random() * 8 - 4)
      game.move(jx, jy)
      yield* game.delay(150)
    }

    // Re-scan targets
    targets = getAttackableMonsters(game, range, opts.nodes, opts.nodeIndex)
    sortMonsters(targets, game.player.x, game.player.y)
  }
}

// ── walkTo — single node walk with stuck detection ─────────────────

/**
 * Walk to a single point with stuck detection and perpendicular juke.
 * Ported from Ryuk's Pather.ts walkTo override.
 */
/**
 * Walk to a single point. Ported from Ryuk/kolbot Pather.walkTo.
 * 1. Click toward target
 * 2. Wait for walk/run mode to start (500ms timeout → stuck)
 * 3. On stuck: perpendicular juke ±90° at 5 tiles
 * 4. Wait for walk to finish (idle mode)
 * 5. Max 3 failures → give up
 *
 * Player modes: 0=Death, 1=Neutral, 2=Walk, 3=Run, 4=GetHit,
 *   5=TownNeutral, 6=TownWalk, 17=Dead
 */
export function* walkTo(game: Game, x: number, y: number, minDist = 4): Generator<void, boolean> {
  const WALK_MODES = new Set([2, 3, 6]) // Walk, Run, TownWalk
  const IDLE_MODES = new Set([1, 5])     // Neutral, TownNeutral
  let nFail = 0
  let attemptCount = 0

  while (dist(game.player.x, game.player.y, x, y) > minDist) {
    if (game.player.mode === 0 || game.player.mode === 17) return false // dead

    // Click toward target
    game.move(x, y)
    attemptCount++

    // Wait for walk mode to start (timeout = ~500ms = 20 frames at 25fps)
    let walkStarted = false
    for (let t = 0; t < 20; t++) {
      yield
      if (game.player.mode === 0 || game.player.mode === 17) return false
      if (WALK_MODES.has(game.player.mode)) { walkStarted = true; break }
    }

    if (!walkStarted) {
      // Didn't enter walk mode — stuck
      nFail++
      if (nFail >= 3) {
        game.log(`[walk] stuck 3x at (${game.player.x},${game.player.y}) target=(${x},${y})`)
        return false
      }

      // Perpendicular juke (Ryuk/kolbot pattern)
      const angle = Math.atan2(game.player.y - y, game.player.x - x)
      const angles = [Math.PI / 2, -Math.PI / 2]
      for (const off of angles) {
        const jx = Math.round(Math.cos(angle + off) * 5 + game.player.x)
        const jy = Math.round(Math.sin(angle + off) * 5 + game.player.y)
        // TODO: validSpot check when available
        game.move(jx, jy)
        // Wait for juke to complete (up to ~1s)
        for (let t = 0; t < 25; t++) {
          yield
          if (dist(game.player.x, game.player.y, jx, jy) <= 2) break
        }
        break // only try one direction per fail
      }
      continue
    }

    // Walk started — wait for it to finish (idle or close enough)
    for (let t = 0; t < 120; t++) { // ~5s max
      yield
      if (game.player.mode === 0 || game.player.mode === 17) return false
      if (dist(game.player.x, game.player.y, x, y) <= minDist) return true
      if (IDLE_MODES.has(game.player.mode)) break // stopped walking
    }

    if (attemptCount >= 3) return false
  }

  return !IDLE_MODES.has(0) && dist(game.player.x, game.player.y, x, y) <= minDist
}

// ── moveTo — walk a full path with clear at each node ──────────────

export interface MoveToOpts {
  clearRange?: number
  maxCastsPerNode?: number
  /** Skip clearing (just walk) */
  noClear?: boolean
  /** Draw path on automap */
  drawPath?: boolean
}

/**
 * moveTo — walk a path node by node, clearing after each.
 * Ported from Ryuk's MoveTo.ts.
 */
export function* moveTo(
  game: Game,
  atk: AttackFn,
  pickit: { lootGround(): Generator<void> },
  targetX: number,
  targetY: number,
  opts: MoveToOpts = {},
): Generator<void> {
  const path = game.findPath(targetX, targetY)
  if (path.length === 0) {
    game.log('[moveTo] no path to (' + targetX + ',' + targetY + ')')
    // Try walking directly
    yield* walkTo(game, targetX, targetY)
    return
  }

  const clearRange = opts.clearRange ?? CLEAR_RANGE
  game.log('[moveTo] ' + path.length + ' nodes to (' + targetX + ',' + targetY + ')')

  // Path drawing disabled for stability — native Line alloc/free triggers SM60 GC crashes
  const lines: Line[] = []

  for (let i = 0; i < path.length; i++) {
    if (!game.inGame) { game.log('[moveTo] abort: not in game'); break }
    // mode 0 = death, mode 17 = dead — only check mode, not hp (hp can read as 0 before stats load)
    if (game.player.mode === 0 || game.player.mode === 17) {
      game.log(`[moveTo] abort: dead (mode=${game.player.mode})`)
      break
    }

    const wp = path[i]!

    // Walk to this node
    game.log('[moveTo] walkTo node ' + i + '...')
    const ok = yield* walkTo(game, wp.x, wp.y)
    game.log('[moveTo] walkTo ' + (ok ? 'ok' : 'stuck'))
    if (lines[i]) lines[i]!.remove()

    if (!ok) {
      // Stuck — clear nearby and try next node
      game.log('[moveTo] stuck at node ' + i + ', clearing')
      yield* clear(game, atk, { range: 5 })
      continue
    }

    // Clear after each node (skip in town)
    if (!opts.noClear) {
      yield* clear(game, atk, {
        range: clearRange,
        nodes: path,
        nodeIndex: i,
      })

      // Pick up items after clearing
      yield* pickit.lootGround()
    }

    // Node skip: if no monsters near next few nodes, skip ahead (teleport-like speedup)
    if (i + 1 < path.length && !opts.noClear) {
      let skip = true
      for (const m of game.monsters) {
        if (m.isAttackable && m.distance < clearRange * 2) { skip = false; break }
      }
      if (skip && i + 2 < path.length) {
        if (lines[i + 1]) lines[i + 1]!.remove()
        i++ // skip one node
      }
    }
  }

  // Clean up path lines
  for (const l of lines) l.remove()
}

// ── moveToExit — walk to area exit and transition ──────────────────

export function* moveToExit(
  game: Game,
  atk: AttackFn,
  pickit: { lootGround(): Generator<void> },
  targetArea: number,
  opts: MoveToOpts = {},
): Generator<void, boolean> {
  const exits = game.getExits()
  const exit = exits.find(e => e.area === targetArea)
  if (!exit) {
    game.log('[moveToExit] no exit to area ' + targetArea)
    return false
  }

  yield* moveTo(game, atk, pickit, exit.x, exit.y, opts)

  // Walk the last few tiles toward exit (handles partial path failures)
  for (let attempt = 0; attempt < 10; attempt++) {
    if (game.area === targetArea) break

    // Try interacting with exit tile
    const tile = game.tiles.find(t => t.destArea === targetArea)
    if (tile) {
      if (tile.distance > 5) {
        game.move(tile.x, tile.y)
        yield* game.delay(300)
      }
      game.interact(tile)
      if (yield* game.waitForArea(targetArea, 50)) break
    }

    // Click toward exit coords
    game.move(exit.x, exit.y)
    yield* game.delay(400)
    if (game.area === targetArea) break
  }

  return game.area === targetArea
}
