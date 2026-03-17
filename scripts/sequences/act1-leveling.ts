/**
 * Act 1 leveling sequence — specific objectives per level range.
 * Uses walk-clear.ts for all navigation + combat.
 * This file contains ONLY sequencing logic — no walk/fight/loot mechanics.
 */

import { type Game, Area } from "diablo:game"
import { closeNPCInteract } from "diablo:native"
import { moveTo, moveToExit } from "../lib/walk-clear.js"
import { Movement } from "../services/movement.js"
import { Attack } from "../services/attack.js"
import { Pickit } from "../services/pickit.js"
import { Town } from "../services/town.js"

const townAreas = new Set([
  Area.RogueEncampment, Area.LutGholein, Area.KurastDocks,
  Area.PandemoniumFortress, Area.Harrogath,
])

/** Find a waypoint in current area and activate it */
function* activateWaypoint(game: Game, move: any) {
  const preset = move.findWaypointPreset()
  if (!preset) return false

  game.log('[a1] walking to waypoint')
  // Use raw walkTo — we're already in the right area, just need to reach it
  game.move(preset.x, preset.y)
  for (let t = 0; t < 100; t++) {
    yield
    if (t % 10 === 0) game.move(preset.x, preset.y)
    const dx = game.player.x - preset.x, dy = game.player.y - preset.y
    if (dx * dx + dy * dy < 49) break
  }

  const wpUnit = move.findWaypointUnit(preset.x, preset.y)
  if (wpUnit) {
    if (wpUnit.distance > 5) {
      game.move(wpUnit.x, wpUnit.y)
      yield* game.delay(400)
    }
    game.interact(wpUnit)
    yield* game.delay(800)
    closeNPCInteract()
    yield* game.delay(200)
    game.log('[a1] waypoint activated')
    return true
  }
  return false
}

/** Heal in town if needed */
function* healIfNeeded(game: Game, town: any) {
  if (townAreas.has(game.area) && game.player.hp < game.player.maxHp) {
    yield* town.heal()
  }
}

/**
 * Main Act 1 leveling entry point.
 * Called each game loop iteration — handles one "step" then returns.
 */
export function* act1Leveling(game: Game, svc: any) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const pickit = svc.get(Pickit)
  const town = svc.get(Town)

  const level = game.charLevel

  // Always heal first if in town
  yield* healIfNeeded(game, town)

  // ── In town: walk to Blood Moor ──
  if (game.area === Area.RogueEncampment) {
    game.log('[a1] leaving town → Blood Moor')
    const ok = yield* moveToExit(game, atk, pickit, Area.BloodMoor, { noClear: true })
    if (!ok) {
      game.log('[a1] failed to reach Blood Moor')
      yield* game.delay(2000)
    }
    return
  }

  // ── Blood Moor (area 2) ──
  if (game.area === Area.BloodMoor) {
    if (level < 3) {
      // Level 1-2: clear Blood Moor toward Cold Plains
      game.log('[a1] clearing Blood Moor (level ' + level + ')')
      const exits = game.getExits()
      const cpExit = exits.find(e => e.area === Area.ColdPlains)
      if (cpExit) {
        yield* moveTo(game, atk, pickit, cpExit.x, cpExit.y)
      }
      return
    }

    // Level 3+: proceed to Cold Plains
    game.log('[a1] heading to Cold Plains')
    yield* moveToExit(game, atk, pickit, Area.ColdPlains)
    return
  }

  // ── Cold Plains (area 3) ──
  if (game.area === Area.ColdPlains) {
    // Grab waypoint if we don't have it
    if (!game.hasWaypoint(1)) {
      yield* activateWaypoint(game, move)
    }

    if (level < 6) {
      // Clear toward Cave entrance
      game.log('[a1] heading to Cave (level ' + level + ')')
      const ok = yield* moveToExit(game, atk, pickit, Area.CaveLvl1)
      if (!ok) {
        // No cave found — clear toward Stony Field instead
        game.log('[a1] no cave exit, heading to Stony Field')
        yield* moveToExit(game, atk, pickit, Area.StonyField)
      }
      return
    }

    // Level 6+: head to Stony Field
    game.log('[a1] heading to Stony Field')
    yield* moveToExit(game, atk, pickit, Area.StonyField)
    return
  }

  // ── Cave Level 1 (area 9) ──
  if (game.area === Area.CaveLvl1) {
    game.log('[a1] clearing Cave Level 1')
    yield* moveToExit(game, atk, pickit, Area.CaveLvl2)
    return
  }

  // ── Cave Level 2 (area 13) ──
  if (game.area === Area.CaveLvl2) {
    game.log('[a1] clearing Cave Level 2')
    // Clear toward exit back to L1
    const exits = game.getExits()
    if (exits.length > 0) {
      yield* moveTo(game, atk, pickit, exits[0]!.x, exits[0]!.y)
    }
    return
  }

  // ── Stony Field (area 4) ──
  if (game.area === Area.StonyField) {
    if (!game.hasWaypoint(2)) {
      game.log('[a1] grabbing Stony Field waypoint')
      yield* activateWaypoint(game, move)
    }
    // Clear Stony Field toward Dark Wood
    game.log('[a1] clearing Stony Field')
    yield* moveToExit(game, atk, pickit, Area.DarkWood)
    return
  }

  // ── Dark Wood (area 5) ──
  if (game.area === Area.DarkWood) {
    if (!game.hasWaypoint(3)) {
      game.log('[a1] grabbing Dark Wood waypoint')
      yield* activateWaypoint(game, move)
    }
    game.log('[a1] clearing Dark Wood')
    yield* moveToExit(game, atk, pickit, Area.BlackMarsh)
    return
  }

  // ── Black Marsh (area 6) ──
  if (game.area === Area.BlackMarsh) {
    if (!game.hasWaypoint(4)) {
      game.log('[a1] grabbing Black Marsh waypoint')
      yield* activateWaypoint(game, move)
    }
    game.log('[a1] clearing Black Marsh')
    yield* moveToExit(game, atk, pickit, Area.TamoeHighland)
    return
  }

  // ── Tamoe Highland → Monastery → Barracks → Jail → Catacombs ──
  if (game.area === Area.TamoeHighland) {
    game.log('[a1] clearing Tamoe Highland')
    yield* moveToExit(game, atk, pickit, Area.MonasteryGate)
    return
  }

  if (game.area === Area.MonasteryGate) {
    yield* moveToExit(game, atk, pickit, Area.OuterCloister, { noClear: true })
    return
  }

  if (game.area === Area.OuterCloister) {
    if (!game.hasWaypoint(5)) {
      yield* activateWaypoint(game, move)
    }
    yield* moveToExit(game, atk, pickit, Area.Barracks)
    return
  }

  // Barracks → Jail → Inner Cloister → Cathedral → Catacombs
  const linearAreas = [
    [Area.Barracks, Area.JailLvl1],
    [Area.JailLvl1, Area.JailLvl2],
    [Area.JailLvl2, Area.JailLvl3],
    [Area.JailLvl3, Area.InnerCloister],
    [Area.InnerCloister, Area.Cathedral],
    [Area.Cathedral, Area.CatacombsLvl1],
    [Area.CatacombsLvl1, Area.CatacombsLvl2],
    [Area.CatacombsLvl2, Area.CatacombsLvl3],
    [Area.CatacombsLvl3, Area.CatacombsLvl4],
  ] as const

  for (const [from, to] of linearAreas) {
    if (game.area === from) {
      // Grab Jail L1 WP (index 6) and Catacombs L2 WP (index 8)
      if (from === Area.JailLvl1 && !game.hasWaypoint(6)) yield* activateWaypoint(game, move)
      if (from === Area.CatacombsLvl2 && !game.hasWaypoint(8)) yield* activateWaypoint(game, move)
      game.log('[a1] clearing ' + from + ' → ' + to)
      yield* moveToExit(game, atk, pickit, to)
      return
    }
  }

  // ── Catacombs Level 4 (Andy) ──
  if (game.area === Area.CatacombsLvl4) {
    game.log('[a1] Andy fight!')
    // Just clear the area — Andy is somewhere in here
    const exits = game.getExits()
    if (exits.length > 0) {
      yield* moveTo(game, atk, pickit, exits[0]!.x, exits[0]!.y)
    }
    // TODO: check quest completion and proceed to Act 2
    return
  }

  // ── Fallback: unknown area, try to go back to town ──
  game.log('[a1] unknown area ' + game.area + ', going to town')
  try {
    yield* town.goToTown()
  } catch {
    game.exitGame()
  }
}
