/**
 * Act 3 leveling — Lam Esen, Khalim's Will, Travincal, Mephisto.
 */

import { type Game, Area } from "diablo:game"
import { moveTo, moveToExit } from "../lib/walk-clear.js"
import { killQuestBoss, interactQuestObject } from "../lib/quest-interact.js"
import { activateWaypoint } from "../lib/waypoint-interact.js"
import { healInTown } from "../lib/npc.js"
import { Movement } from "../services/movement.js"
import { Attack } from "../services/attack.js"
import { Pickit } from "../services/pickit.js"

const MEPHISTO = 242 // classid

export function* act3Leveling(game: Game, svc: any) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const pickit = svc.get(Pickit)

  if (game.area === Area.KurastDocks && game.player.hp < game.player.maxHp) {
    yield* healInTown(game)
  }

  // ── Town ──
  if (game.area === Area.KurastDocks) {
    yield* moveToExit(game, atk, pickit, Area.SpiderForest)
    return
  }

  // ── Jungle chain ──
  const jungleChain = [
    [Area.SpiderForest, Area.GreatMarsh],
    [Area.GreatMarsh, Area.FlayerJungle],
    [Area.FlayerJungle, Area.LowerKurast],
    [Area.LowerKurast, Area.KurastBazaar],
    [Area.KurastBazaar, Area.UpperKurast],
    [Area.UpperKurast, Area.KurastCauseway],
    [Area.KurastCauseway, Area.Travincal],
  ] as const

  for (const [from, to] of jungleChain) {
    if (game.area === from) {
      // Waypoints
      if (from === Area.SpiderForest && !game.hasWaypoint(19)) yield* activateWaypoint(game, move)
      if (from === Area.GreatMarsh && !game.hasWaypoint(20)) yield* activateWaypoint(game, move)
      if (from === Area.FlayerJungle && !game.hasWaypoint(21)) yield* activateWaypoint(game, move)
      if (from === Area.LowerKurast && !game.hasWaypoint(22)) yield* activateWaypoint(game, move)
      if (from === Area.KurastBazaar && !game.hasWaypoint(23)) yield* activateWaypoint(game, move)
      if (from === Area.UpperKurast && !game.hasWaypoint(24)) yield* activateWaypoint(game, move)
      if (from === Area.Travincal && !game.hasWaypoint(25)) yield* activateWaypoint(game, move)

      yield* moveToExit(game, atk, pickit, to)
      return
    }
  }

  // ── Travincal ──
  if (game.area === Area.Travincal) {
    if (!game.hasWaypoint(25)) yield* activateWaypoint(game, move)
    // Kill council members, interact with compelling orb
    yield* interactQuestObject(game, atk, pickit, 2, 404) // compelling orb
    yield* game.delay(1000)
    // Should open Durance of Hate entrance
    yield* moveToExit(game, atk, pickit, Area.DuranceofHateLvl1)
    return
  }

  // ── Durance of Hate ──
  if (game.area === Area.DuranceofHateLvl1) {
    yield* moveToExit(game, atk, pickit, Area.DuranceofHateLvl2)
    return
  }
  if (game.area === Area.DuranceofHateLvl2) {
    if (!game.hasWaypoint(26)) yield* activateWaypoint(game, move)
    yield* moveToExit(game, atk, pickit, Area.DuranceofHateLvl3)
    return
  }
  if (game.area === Area.DuranceofHateLvl3) {
    game.log('[a3] Mephisto fight!')
    yield* killQuestBoss(game, atk, pickit, MEPHISTO)
    game.log('[a3] Mephisto defeated!')
    // TODO: use portal to Act 4
    return
  }

  // ── Side dungeons (Lam Esen etc.) ──
  const sideDungeons = [
    Area.SpiderCave, Area.SpiderCavern,
    Area.SwampyPitLvl1, Area.SwampyPitLvl2, Area.SwampyPitLvl3,
    Area.FlayerDungeonLvl1, Area.FlayerDungeonLvl2, Area.FlayerDungeonLvl3,
    Area.RuinedTemple, Area.DisusedFane, Area.ForgottenReliquary,
    Area.ForgottenTemple, Area.RuinedFane, Area.DisusedReliquary,
  ]
  if (sideDungeons.includes(game.area)) {
    // Clear and exit back
    const exits = game.getExits()
    if (exits.length > 0) yield* moveTo(game, atk, pickit, exits[0]!.x, exits[0]!.y)
    return
  }

  game.log('[a3] unknown area ' + game.area)
  game.exitGame()
}
