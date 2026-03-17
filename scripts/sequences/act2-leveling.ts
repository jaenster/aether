/**
 * Act 2 leveling — Radament, Horadric Staff, Arcane, Summoner, Duriel.
 */

import { type Game, Area } from "diablo:game"
import { moveTo, moveToExit } from "../lib/walk-clear.js"
import { killQuestBoss, interactQuestObject } from "../lib/quest-interact.js"
import { activateWaypoint } from "../lib/waypoint-interact.js"
import { healInTown } from "../lib/npc.js"
import { Movement } from "../services/movement.js"
import { Attack } from "../services/attack.js"
import { Pickit } from "../services/pickit.js"

const townAreas = new Set([Area.LutGholein])
const DURIEL = 211 // classid

export function* act2Leveling(game: Game, svc: any) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const pickit = svc.get(Pickit)

  if (townAreas.has(game.area) && game.player.hp < game.player.maxHp) {
    yield* healInTown(game)
  }

  // ── Lut Gholein (town) ──
  if (game.area === Area.LutGholein) {
    // Head out to Rocky Waste → Dry Hills → Far Oasis
    yield* moveToExit(game, atk, pickit, Area.RockyWaste)
    return
  }

  // ── Rocky Waste → Dry Hills → Far Oasis chain ──
  const a2Chain = [
    [Area.RockyWaste, Area.DryHills],
    [Area.DryHills, Area.FarOasis],
    [Area.FarOasis, Area.LostCity],
    [Area.LostCity, Area.ValleyofSnakes],
    [Area.ValleyofSnakes, Area.CanyonofMagic],
  ] as const

  for (const [from, to] of a2Chain) {
    if (game.area === from) {
      // Grab waypoints along the way
      if (from === Area.DryHills && !game.hasWaypoint(11)) yield* activateWaypoint(game, move)
      if (from === Area.FarOasis && !game.hasWaypoint(13)) yield* activateWaypoint(game, move)
      if (from === Area.LostCity && !game.hasWaypoint(14)) yield* activateWaypoint(game, move)

      yield* moveToExit(game, atk, pickit, to)
      return
    }
  }

  // ── Sewers (Radament) ──
  if (game.area === Area.A2SewersLvl1) {
    yield* moveToExit(game, atk, pickit, Area.A2SewersLvl2)
    return
  }
  if (game.area === Area.A2SewersLvl2) {
    if (!game.hasWaypoint(10)) yield* activateWaypoint(game, move)
    yield* moveToExit(game, atk, pickit, Area.A2SewersLvl3)
    return
  }
  if (game.area === Area.A2SewersLvl3) {
    // Kill Radament
    yield* interactQuestObject(game, atk, pickit, 2, 355) // Radament chest area
    return
  }

  // ── Palace → Arcane Sanctuary ──
  const palaceChain = [
    [Area.HaremLvl1, Area.HaremLvl2],
    [Area.HaremLvl2, Area.PalaceCellarLvl1],
    [Area.PalaceCellarLvl1, Area.PalaceCellarLvl2],
    [Area.PalaceCellarLvl2, Area.PalaceCellarLvl3],
  ] as const

  for (const [from, to] of palaceChain) {
    if (game.area === from) {
      if (from === Area.PalaceCellarLvl1 && !game.hasWaypoint(15)) yield* activateWaypoint(game, move)
      yield* moveToExit(game, atk, pickit, to)
      return
    }
  }

  if (game.area === Area.PalaceCellarLvl3) {
    // Portal to Arcane Sanctuary
    yield* interactQuestObject(game, atk, pickit, 2, 298) // portal object
    yield* game.waitForArea(Area.ArcaneSanctuary)
    return
  }

  if (game.area === Area.ArcaneSanctuary) {
    if (!game.hasWaypoint(16)) yield* activateWaypoint(game, move)
    // Find Summoner journal (preset 357), kill Summoner, use portal to Canyon
    yield* interactQuestObject(game, atk, pickit, 2, 357) // journal
    yield* game.delay(1000)
    // Portal should open to Canyon of Magi
    return
  }

  if (game.area === Area.CanyonofMagic) {
    if (!game.hasWaypoint(17)) yield* activateWaypoint(game, move)
    // Find correct tomb → Duriel's Lair
    // TODO: identify correct tomb from staff tomb level
    return
  }

  // ── Duriel's Lair ──
  if (game.area === Area.DurielsLair) {
    yield* killQuestBoss(game, atk, pickit, DURIEL)
    game.log('[a2] Duriel defeated! Talk to Tyrael.')
    // TODO: interact Tyrael, go to Act 3
    return
  }

  // ── Tal Rasha Tombs ──
  for (let t = Area.TalRashasTomb1; t <= Area.TalRashasTomb7; t++) {
    if (game.area === t) {
      // Clear tomb, look for Duriel's Lair entrance
      const exits = game.getExits()
      const lair = exits.find(e => e.area === Area.DurielsLair)
      if (lair) {
        yield* moveToExit(game, atk, pickit, Area.DurielsLair)
      } else {
        // Wrong tomb — clear it anyway for XP, then go back
        if (exits.length > 0) yield* moveTo(game, atk, pickit, exits[0]!.x, exits[0]!.y)
      }
      return
    }
  }

  // Fallback
  game.log('[a2] unknown area ' + game.area)
  game.exitGame()
}
