/**
 * Walk-clear system — ported from Ryuk's MoveTo.ts + clear.ts + Pather.ts
 *
 * Core pattern: walk node-by-node, call clear() after each node.
 * clear() fights all monsters in range, with backtrack when overwhelmed
 * and forward-track when target too far.
 */

import type { Game, Monster } from "diablo:game"
import { Line, ItemContainer } from "diablo:game"
import { getUnitStat } from "diablo:native"

const CLEAR_RANGE = 14       // base clear range in tiles
const BACKTRACK_NODES = 5    // max nodes to backtrack
const FORWARD_TRACK_DIST = 15 // forward-track if closest monster > this
const JUKE_CHANCE = 0.07     // 7% random juke after each attack
const MAX_CASTS_PER_MON = 50 // skip monster after this many casts
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
  const maxCasts = opts.maxCasts ?? MAX_CASTS_PER_MON

  let targets = getAttackableMonsters(game, range, opts.nodes, opts.nodeIndex)
  if (targets.length === 0) return

  sortMonsters(targets, game.player.x, game.player.y)

  // Fight loop
  let castCount = 0
  while (targets.length > 0 && castCount < maxCasts) {
    // Backtrack check
    if (shouldBacktrack(game) && opts.nodes && opts.nodeIndex !== undefined) {
      const btIdx = Math.max(0, opts.nodeIndex - BACKTRACK_NODES)
      const btNode = opts.nodes[btIdx]!
      game.log(`[clear] backtracking to node ${btIdx}`)
      game.move(btNode.x, btNode.y)
      yield* game.delay(500)
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

    // Attack
    yield* atk.clear({ killRange: range + 5, maxCasts: Math.min(8, maxCasts - castCount) })
    castCount += 8

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
export function* walkTo(game: Game, x: number, y: number, maxTicks = 60): Generator<void, boolean> {
  let nFail = 0

  while (dist(game.player.x, game.player.y, x, y) > 4) {
    // Stamina management: stat 80=stamina, stat 81=maxstamina (both shifted by 8)
    const stamina = getUnitStat(0, game.player.unitId, 80, 0) >> 8
    const maxStamina = getUnitStat(0, game.player.unitId, 81, 0) >> 8
    if (maxStamina > 0) {
      const pct = stamina / maxStamina
      if (pct < 0.15) {
        // Very low — switch to walk to recover
        // TODO: send walk/run toggle packet when available
      } else if (pct < 0.20) {
        // Drink stamina pot if available
        for (const item of game.items) {
          if (item.location === ItemContainer.Belt && item.code === 'vps') {
            game.clickItem(0, item.unitId)
            break
          }
        }
      }
    }

    game.move(x, y)

    let moved = false
    const startX = game.player.x, startY = game.player.y
    for (let t = 0; t < maxTicks; t++) {
      yield
      if (t % 10 === 0) game.move(x, y)

      const dx = game.player.x - x, dy = game.player.y - y
      if (dx * dx + dy * dy < 16) return true // arrived

      // Check if we actually moved
      if (dist(game.player.x, game.player.y, startX, startY) > 2) {
        moved = true
      }
    }

    if (!moved) {
      nFail++
      if (nFail >= 3) {
        game.log('[walk] stuck after 3 attempts')
        return false
      }

      // Perpendicular juke: try ±90° at distance 5
      const angle = Math.atan2(game.player.y - y, game.player.x - x)
      const offsets = [Math.PI / 2, -Math.PI / 2]
      const offset = offsets[nFail % 2]!
      const jx = Math.round(Math.cos(angle + offset) * 5 + game.player.x)
      const jy = Math.round(Math.sin(angle + offset) * 5 + game.player.y)

      game.log(`[walk] juke attempt ${nFail}: (${jx},${jy})`)
      game.move(jx, jy)
      yield* game.delay(400)
    } else {
      nFail = 0
    }
  }
  return true
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

  // Draw path on automap
  const lines: Line[] = []
  if (opts.drawPath !== false) {
    let px = game.player.x, py = game.player.y
    for (const wp of path) {
      lines.push(new Line({ x: px, y: py, x2: wp.x, y2: wp.y, color: 0x84, automap: true }))
      px = wp.x; py = wp.y
    }
  }

  for (let i = 0; i < path.length; i++) {
    if (!game.inGame) break
    if (game.player.hp <= 0 || game.player.mode === 0 || game.player.mode === 17) break

    const wp = path[i]!

    // Walk to this node
    const ok = yield* walkTo(game, wp.x, wp.y)
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

  // Interact with exit tile
  const tile = game.tiles.find(t => t.destArea === targetArea)
  if (tile) {
    game.interact(tile)
  } else {
    // Walk the last few tiles
    game.move(exit.x, exit.y)
    yield* game.delay(500)
  }

  if (yield* game.waitForArea(targetArea)) return true
  return game.area === targetArea
}
