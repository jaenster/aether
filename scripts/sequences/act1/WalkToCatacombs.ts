/**
 * Walk from Black Marsh to Catacombs L2 — grab all waypoints along the way.
 * Ryuk: OuterCloister WP, JailLvl1 WP, InnerCloister WP, CatacombsLvl2 WP.
 * Then descend to CatacombsLvl4 for Andy.
 */

import { type Game, Area } from "diablo:game"
import { moveToExit } from "../../lib/walk-clear.js"
import { activateWaypoint } from "../../lib/waypoint-interact.js"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"
import { healInTown } from "../../lib/npc.js"
import { haveWp, townAreas } from "./util.js"

export function* walkToCatacombs(game: Game, svc: any): Generator<void> {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const pickit = svc.get(Pickit)

  if (townAreas.has(game.area)) {
    yield* healInTown(game)
  }

  // Outer Cloister WP
  if (!haveWp(game, Area.OuterCloister)) {
    yield* move.useWaypoint(Area.BlackMarsh)
    if (game.area === Area.BlackMarsh) {
      yield* moveToExit(game, atk, pickit, Area.TamoeHighland)
    }
    if (game.area === Area.TamoeHighland) {
      yield* moveToExit(game, atk, pickit, Area.MonasteryGate)
    }
    if (game.area === Area.MonasteryGate) {
      yield* moveToExit(game, atk, pickit, Area.OuterCloister)
    }
    if (game.area === Area.OuterCloister) {
      yield* activateWaypoint(game, move)
    }
  }

  // Jail Lvl 1 WP
  if (!haveWp(game, Area.JailLvl1)) {
    if (game.area !== Area.OuterCloister) {
      yield* move.useWaypoint(Area.OuterCloister)
    }
    if (game.area === Area.OuterCloister) {
      yield* moveToExit(game, atk, pickit, Area.Barracks)
    }
    if (game.area === Area.Barracks) {
      yield* moveToExit(game, atk, pickit, Area.JailLvl1)
    }
    if (game.area === Area.JailLvl1) {
      yield* activateWaypoint(game, move)
    }
  }

  // Inner Cloister WP
  if (!haveWp(game, Area.InnerCloister)) {
    if (game.area !== Area.JailLvl1) {
      yield* move.useWaypoint(Area.JailLvl1)
    }
    if (game.area === Area.JailLvl1) {
      yield* moveToExit(game, atk, pickit, Area.JailLvl2)
    }
    if (game.area === Area.JailLvl2) {
      yield* moveToExit(game, atk, pickit, Area.JailLvl3)
    }
    if (game.area === Area.JailLvl3) {
      yield* moveToExit(game, atk, pickit, Area.InnerCloister)
    }
    if (game.area === Area.InnerCloister) {
      yield* activateWaypoint(game, move)
    }
  }

  // Catacombs Lvl 2 WP
  if (!haveWp(game, Area.CatacombsLvl2)) {
    if (game.area !== Area.InnerCloister) {
      yield* move.useWaypoint(Area.InnerCloister)
    }
    if (game.area === Area.InnerCloister) {
      yield* moveToExit(game, atk, pickit, Area.Cathedral)
    }
    if (game.area === Area.Cathedral) {
      yield* moveToExit(game, atk, pickit, Area.CatacombsLvl1)
    }
    if (game.area === Area.CatacombsLvl1) {
      yield* moveToExit(game, atk, pickit, Area.CatacombsLvl2)
    }
    if (game.area === Area.CatacombsLvl2) {
      yield* activateWaypoint(game, move)
    }
  }

}
