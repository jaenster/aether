import { type Game, type Monster, Area, Line } from "diablo:game"
import { closeNPCInteract } from "diablo:native"
import { Movement } from "../services/movement.js"
import { Attack } from "../services/attack.js"
import { Pickit } from "../services/pickit.js"
import { Town } from "../services/town.js"

const townAreas = new Set([Area.RogueEncampment, Area.LutGholein, Area.KurastDocks, Area.PandemoniumFortress, Area.Harrogath])

/**
 * Walk node-by-node, killing everything nearby along the way.
 * This is the core walk-clear loop — replaces the old "scenic route".
 */
const _townAreas = new Set([Area.RogueEncampment, Area.LutGholein, Area.KurastDocks, Area.PandemoniumFortress, Area.Harrogath])

function* walkAndClear(game: Game, atk: ReturnType<typeof Attack['factory']>, pickit: ReturnType<typeof Pickit['factory']>, targetX: number, targetY: number) {
  const path = game.findPath(targetX, targetY)
  if (path.length === 0) {
    game.log('[walk] no path to ' + targetX + ',' + targetY)
    game.move(targetX, targetY)
    yield* game.delay(1000)
    return
  }

  game.log('[walk] ' + path.length + ' nodes to (' + targetX + ',' + targetY + ')')

  // Draw path on automap
  const pathLines: Line[] = []
  let prevX = game.player.x, prevY = game.player.y
  for (const wp of path) {
    pathLines.push(new Line({ x: prevX, y: prevY, x2: wp.x, y2: wp.y, color: 0x84, automap: true }))
    prevX = wp.x; prevY = wp.y
  }

  for (let i = 0; i < path.length; i++) {
    if (!game.inGame) return
    if (game.player.hp <= 0 || game.player.mode === 0 || game.player.mode === 17) return
    const wp = path[i]!

    // Walk toward this node
    game.move(wp.x, wp.y)

    for (let t = 0; t < 50; t++) {
      yield
      if (t % 8 === 0) game.move(wp.x, wp.y)

      // Arrived?
      const dx = game.player.x - wp.x, dy = game.player.y - wp.y
      if (dx * dx + dy * dy < 25) break

      // Dead?
      if (game.player.hp <= 0 || game.player.mode === 0 || game.player.mode === 17) return

      // Monster nearby? Walk toward it and fight (skip in town)
      if (!_townAreas.has(game.area)) {
        for (const m of game.monsters) {
          if (m.isAttackable && m.distance < 25) {
            if (m.distance > 8) {
              game.move(m.x, m.y)
              for (let w = 0; w < 10; w++) {
                yield
                if (m.distance < 8) break
              }
            }
            yield* atk.clear({ killRange: 25, maxCasts: 8 })
            yield* pickit.lootGround()
            break
          }
        }
      }
    }

    // At node: actively seek monsters (skip in town)
    if (_townAreas.has(game.area)) continue
    for (let seek = 0; seek < 3; seek++) {
      let nearest: Monster | null = null
      let nearDist = Infinity
      for (const m of game.monsters) {
        if (m.isAttackable && m.distance < nearDist) { nearDist = m.distance; nearest = m }
      }
      if (!nearest || nearDist > 35) break // nothing visible

      // Walk toward the monster
      if (nearDist > 8) {
        game.move(nearest.x, nearest.y)
        for (let w = 0; w < 25; w++) {
          yield
          if (w % 6 === 0) game.move(nearest.x, nearest.y)
          if (nearest.distance < 8) break
          if (game.player.hp <= 0) return
        }
      }

      // Fight everything nearby
      yield* atk.clear({ killRange: 25, maxCasts: 12 })
      yield* pickit.lootGround()
    }

    // Mark this path segment as done
    if (pathLines[i]) pathLines[i]!.remove()
  }

  // Clean up remaining lines
  for (const l of pathLines) l.remove()
}

/**
 * Walk through an area exit into the target area, clearing along the way.
 */
function* walkToArea(game: Game, move: any, atk: any, pickit: any, targetArea: number) {
  const exits = game.getExits()
  const exit = exits.find(e => e.area === targetArea)
  if (!exit) {
    game.log('[walk] no exit to area ' + targetArea)
    return false
  }
  yield* walkAndClear(game, atk, pickit, exit.x, exit.y)

  // Now interact with the exit tile
  const tile = game.tiles.find(t => t.destArea === targetArea)
  if (tile) {
    game.interact(tile)
  } else {
    // Walk the last few tiles to trigger area change
    game.move(exit.x, exit.y)
    yield* game.delay(500)
  }

  if (yield* game.waitForArea(targetArea)) return true
  return game.area === targetArea
}

/**
 * Walk to waypoint in current area and activate it.
 */
function* grabWaypoint(game: Game, move: any, atk: any, pickit: any) {
  const wp = move.findWaypointPreset()
  if (!wp) return false

  game.log('[walk] heading to waypoint at ' + wp.x + ',' + wp.y)
  yield* walkAndClear(game, atk, pickit, wp.x, wp.y)

  // Find and interact with WP unit
  const wpUnit = move.findWaypointUnit(wp.x, wp.y)
  if (wpUnit) {
    // Walk close to WP first
    if (wpUnit.distance > 5) {
      game.move(wpUnit.x, wpUnit.y)
      yield* game.delay(500)
    }
    game.interact(wpUnit)
    yield* game.delay(1000)
    // Close WP menu
    closeNPCInteract()
    yield* game.delay(300)
    game.log('[walk] waypoint activated')
    return true
  }
  return false
}

/**
 * Act 1 leveling sequence — specific objectives per level range.
 * Returns a generator that walks, kills, and progresses through Act 1.
 */
export function* act1Leveling(game: Game, svc: any) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const pickit = svc.get(Pickit)
  const town = svc.get(Town)

  const level = game.charLevel

  // ── Level 1-7: Blood Moor → Cold Plains (grab WP) → Cave grinding ──
  if (level < 8) {
    if (townAreas.has(game.area)) {
      if (game.player.hp < game.player.maxHp) yield* town.heal()
    }

    // Walk to Blood Moor if in town
    if (game.area === Area.RogueEncampment) {
      game.log('[a1] walking to Blood Moor')
      const ok = yield* walkToArea(game, move, atk, pickit, Area.BloodMoor)
      if (!ok) return
    }

    // Clear Blood Moor toward Cold Plains
    if (game.area === Area.BloodMoor) {
      game.log('[a1] clearing Blood Moor → Cold Plains')
      const ok = yield* walkToArea(game, move, atk, pickit, Area.ColdPlains)
      if (!ok) return
    }

    // In Cold Plains: grab WP if needed, then clear toward Cave or Stony Field
    if (game.area === Area.ColdPlains) {
      if (!game.hasWaypoint(1)) {
        game.log('[a1] grabbing Cold Plains waypoint')
        yield* grabWaypoint(game, move, atk, pickit)
      }

      // Head to Cave Level 1 for grinding
      game.log('[a1] heading to Cave')
      const ok = yield* walkToArea(game, move, atk, pickit, Area.CaveLvl1)
      if (!ok) {
        // No cave found — just clear Cold Plains toward Stony Field
        game.log('[a1] cave not found, clearing toward Stony Field')
        yield* walkToArea(game, move, atk, pickit, Area.StonyField)
      }
    }

    // Clear Cave Level 1
    if (game.area === Area.CaveLvl1) {
      game.log('[a1] clearing Cave Level 1')
      yield* walkToArea(game, move, atk, pickit, Area.CaveLvl2)
    }

    // Clear Cave Level 2 — find farthest exit and walk to it
    if (game.area === Area.CaveLvl2) {
      game.log('[a1] clearing Cave Level 2')
      const exits = game.getExits()
      if (exits.length > 0) {
        yield* walkAndClear(game, atk, pickit, exits[0]!.x, exits[0]!.y)
      }
    }

    return
  }

  // (Level 4-7 merged into the block above)

  // ── Level 8+: Stony Field, Dark Wood, etc. ──
  if (level < 15) {
    if (townAreas.has(game.area)) {
      if (game.player.hp < game.player.maxHp) yield* town.heal()
    }

    // Walk through Cold Plains → Stony Field
    if (game.area === Area.RogueEncampment || game.area === Area.ColdPlains) {
      if (game.area === Area.RogueEncampment) {
        yield* move.useWaypoint(Area.ColdPlains)
      }
      game.log('[a1] heading to Stony Field')
      yield* walkToArea(game, move, atk, pickit, Area.StonyField)
    }

    // Clear Stony Field and grab WP
    if (game.area === Area.StonyField) {
      game.log('[a1] clearing Stony Field')
      yield* grabWaypoint(game, move, atk, pickit)
    }

    return
  }
}
