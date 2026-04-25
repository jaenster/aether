/**
 * Andy (Andariel) — wp to CatacombsLvl2, descend to Lvl4, kill Andariel, exit.
 * Ryuk: wp CatacombsLvl2, walk through Lvl3+Lvl4, kill Andy at 22549,9520, goToTown.
 */

import { type Game, Area } from "diablo:game"
import { moveTo, moveToExit, clear } from "../../lib/walk-clear.js"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"
import { healInTown } from "../../lib/npc.js"
import { haveWp, townAreas, ANDARIEL } from "./util.js"

export function* andy(game: Game, svc: any): Generator<void> {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const pickit = svc.get(Pickit)

  if (townAreas.has(game.area)) {
    yield* healInTown(game)
  }

  // Get to Catacombs Lvl 4
  if (game.area !== Area.CatacombsLvl4) {
    if (game.area !== Area.CatacombsLvl2 && game.area !== Area.CatacombsLvl3) {
      yield* move.useWaypoint(Area.CatacombsLvl2)
    }
    if (game.area === Area.CatacombsLvl2) {
      yield* moveToExit(game, atk, pickit, Area.CatacombsLvl3)
    }
    if (game.area === Area.CatacombsLvl3) {
      yield* moveToExit(game, atk, pickit, Area.CatacombsLvl4)
    }
  }


  // Move to Andy's known location and fight
  yield* moveTo(game, atk, pickit, 22549, 9520)

  // Keep fighting until Andariel is dead
  for (let i = 0; i < 50; i++) {
    const andyUnit = game.monsters.find(m => m.classid === ANDARIEL && m.isAttackable)
    if (!andyUnit) break
    yield* clear(game, atk, { range: 25, maxCasts: 20 })
    yield
    if (game.player.mode === 0 || game.player.mode === 17) break
  }

  yield* pickit.lootGround()
}
