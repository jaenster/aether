/**
 * Cave L1 + L2 — walk-clear both levels for XP, then exit game.
 * Ryuk: wp to ColdPlains, enter CaveLvl1, clear in a triangle to CaveLvl2, clear L2, return.
 */

import { type Game, Area } from "diablo:game"
import { moveTo, moveToExit } from "../../lib/walk-clear.js"
import { activateWaypoint } from "../../lib/waypoint-interact.js"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"
import { healInTown } from "../../lib/npc.js"
import { haveWp, townAreas } from "./util.js"

export function* cave(game: Game, svc: any): Generator<void> {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const pickit = svc.get(Pickit)

  if (townAreas.has(game.area)) {
    yield* healInTown(game)
  }

  // Get to Cold Plains — walk if no waypoint
  if (game.area === Area.RogueEncampment) {
    yield* moveToExit(game, atk, pickit, Area.BloodMoor, { noClear: true })
  }
  if (game.area === Area.BloodMoor) {
    yield* moveToExit(game, atk, pickit, Area.ColdPlains)
  }
  if (game.area !== Area.ColdPlains && haveWp(game, Area.ColdPlains)) {
    yield* move.useWaypoint(Area.ColdPlains)
  }

  // Grab Cold Plains WP if we don't have it
  if (!haveWp(game, Area.ColdPlains)) {
    yield* activateWaypoint(game, move)
  }

  // Enter Cave L1
  if (game.area === Area.ColdPlains) {
    const ok: unknown = yield* moveToExit(game, atk, pickit, Area.CaveLvl1)
  }

  // Clear Cave L1 and descend to L2
  if (game.area === Area.CaveLvl1) {
    yield* moveToExit(game, atk, pickit, Area.CaveLvl2)
  }

  // Clear Cave L2 — walk to the exit back to L1 (covers the whole level)
  if (game.area === Area.CaveLvl2) {
    const exits = game.getExits()
    const back = exits.find(e => e.area === Area.CaveLvl1)
    if (back) {
      yield* moveTo(game, atk, pickit, back.x, back.y)
    }
  }

}
