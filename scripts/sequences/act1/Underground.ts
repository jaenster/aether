/**
 * Underground Passage — walk from Stony Field through Underground to Dark Wood,
 * grabbing waypoints along the way.
 * Ryuk: wp to StonyField (or ColdPlains), walk through Underground to DarkWood, grab DarkWood WP.
 */

import { type Game, Area } from "diablo:game"
import { moveToExit } from "../../lib/walk-clear.js"
import { activateWaypoint } from "../../lib/waypoint-interact.js"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"
import { healInTown } from "../../lib/npc.js"
import { haveWp, townAreas } from "./util.js"

export function* underground(game: Game, svc: any): Generator<void> {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const pickit = svc.get(Pickit)

  if (townAreas.has(game.area)) {
    yield* healInTown(game)
  }

  // Get to Stony Field
  if (game.area !== Area.StonyField) {
    if (haveWp(game, Area.StonyField)) {
      yield* move.useWaypoint(Area.StonyField)
    } else if (haveWp(game, Area.ColdPlains)) {
      yield* move.useWaypoint(Area.ColdPlains)
      if ((game.area as number) === Area.ColdPlains) {
        // Grab Stony Field WP on the way
        yield* moveToExit(game, atk, pickit, Area.StonyField)
        if ((game.area as number) === Area.StonyField && !haveWp(game, Area.StonyField)) {
          yield* activateWaypoint(game, move)
        }
      }
    } else {
      yield* move.journeyTo(Area.StonyField)
    }
  }


  const area = () => game.area as number

  // Stony Field -> Underground Passage L1 (narrow clear range, just pass through)
  yield* moveToExit(game, atk, pickit, Area.UndergroundPassageLvl1)

  // Underground Passage L1 -> Dark Wood
  if (area() === Area.UndergroundPassageLvl1) {
    yield* moveToExit(game, atk, pickit, Area.DarkWood)
  }

  // Grab Dark Wood waypoint
  if (area() === Area.DarkWood && !haveWp(game, Area.DarkWood)) {
    yield* activateWaypoint(game, move)
  }

}
