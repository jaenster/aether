/**
 * Countess — wp to BlackMarsh, descend tower cellar levels, kill Countess, exit.
 * Ryuk: DarkWood -> BlackMarsh WP, walk tower cellars 1-5, kill Countess at chest preset.
 */

import { type Game, Area } from "diablo:game"
import { moveTo, moveToExit, clear } from "../../lib/walk-clear.js"
import { activateWaypoint } from "../../lib/waypoint-interact.js"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"
import { healInTown } from "../../lib/npc.js"
import { haveWp, townAreas, COUNTESS_CHEST } from "./util.js"

export function* countess(game: Game, svc: any): Generator<void> {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const pickit = svc.get(Pickit)

  if (townAreas.has(game.area)) {
    yield* healInTown(game)
  }

  // Get to Black Marsh — grab WP along the way if needed
  if (!haveWp(game, Area.BlackMarsh)) {
    // Walk from Dark Wood to Black Marsh
    if (haveWp(game, Area.DarkWood)) {
      yield* move.useWaypoint(Area.DarkWood)
    } else {
      yield* move.journeyTo(Area.DarkWood)
    }
    if (game.area === Area.DarkWood) {
      yield* moveToExit(game, atk, pickit, Area.BlackMarsh)
    }
    if (game.area === Area.BlackMarsh) {
      yield* activateWaypoint(game, move)
    }
  }

  if (game.area !== Area.BlackMarsh) {
    yield* move.useWaypoint(Area.BlackMarsh)
  }


  const area = () => game.area as number

  // Black Marsh -> Forgotten Tower
  yield* moveToExit(game, atk, pickit, Area.ForgottenTower)

  // Forgotten Tower -> Tower Cellar L1
  if (area() === Area.ForgottenTower) {
    yield* moveToExit(game, atk, pickit, Area.TowerCellarLvl1)
  }

  // Descend through cellar levels
  const cellarPath = [
    Area.TowerCellarLvl2,
    Area.TowerCellarLvl3,
    Area.TowerCellarLvl4,
    Area.TowerCellarLvl5,
  ]

  for (const nextLevel of cellarPath) {
    if (area() === nextLevel - 1) {
      yield* moveToExit(game, atk, pickit, nextLevel)
    }
  }

  // Kill Countess — she's near the super chest preset
  if (area() === Area.TowerCellarLvl5) {
    const poi = game.findPreset(2, COUNTESS_CHEST)
    if (poi) {
      yield* moveTo(game, atk, pickit, poi.x, poi.y)
      yield* clear(game, atk, { range: 25, maxCasts: 200 })
      yield* pickit.lootGround()
    }
  }

}
