/**
 * Act 4 leveling — Izual, Chaos Sanctuary, Diablo.
 */

import { type Game, Area } from "diablo:game"
import { moveTo, moveToExit } from "../lib/walk-clear.js"
import { killQuestBoss } from "../lib/quest-interact.js"
import { activateWaypoint } from "../lib/waypoint-interact.js"
import { healInTown } from "../lib/npc.js"
import { Movement } from "../services/movement.js"
import { Attack } from "../services/attack.js"
import { Pickit } from "../services/pickit.js"

const IZUAL = 256   // classid
const DIABLO = 243  // classid

export function* act4Leveling(game: Game, svc: any) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const pickit = svc.get(Pickit)

  if (game.area === Area.PandemoniumFortress && game.player.hp < game.player.maxHp) {
    yield* healInTown(game)
  }

  // ── Town ──
  if (game.area === Area.PandemoniumFortress) {
    yield* moveToExit(game, atk, pickit, Area.OuterSteppes)
    return
  }

  // ── Outer Steppes → Plains of Despair (Izual) ──
  if (game.area === Area.OuterSteppes) {
    yield* moveToExit(game, atk, pickit, Area.PlainsofDespair)
    return
  }

  if (game.area === Area.PlainsofDespair) {
    // Kill Izual
    game.log('[a4] hunting Izual')
    yield* killQuestBoss(game, atk, pickit, IZUAL)
    yield* moveToExit(game, atk, pickit, Area.CityoftheDamned)
    return
  }

  // ── City of the Damned → River of Flame ──
  if (game.area === Area.CityoftheDamned) {
    if (!game.hasWaypoint(28)) yield* activateWaypoint(game, move)
    yield* moveToExit(game, atk, pickit, Area.RiverofFlame)
    return
  }

  if (game.area === Area.RiverofFlame) {
    if (!game.hasWaypoint(29)) yield* activateWaypoint(game, move)
    yield* moveToExit(game, atk, pickit, Area.ChaosSanctuary)
    return
  }

  // ── Chaos Sanctuary → Diablo ──
  if (game.area === Area.ChaosSanctuary) {
    game.log('[a4] Chaos Sanctuary — clearing to Diablo')
    // Walk toward the pentagram center (roughly 7790, 5290)
    yield* moveTo(game, atk, pickit, 7790, 5290)

    // TODO: proper seal sequence (Viz, De Seis, Infector)
    // For now just clear the area and kill Diablo when he spawns
    yield* killQuestBoss(game, atk, pickit, DIABLO)
    game.log('[a4] Diablo defeated!')
    // TODO: talk to Tyrael, portal to Act 5
    return
  }

  game.log('[a4] unknown area ' + game.area)
  game.exitGame()
}
