/**
 * Den of Evil — clear the den, then exit game.
 * Ryuk: journeyTo(DenOfEvil), clearLevel, goToTown.
 */

import { type Game, Area } from "diablo:game"
import { moveTo, moveToExit, clear } from "../../lib/walk-clear.js"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"
import { healInTown } from "../../lib/npc.js"
import { townAreas } from "./util.js"

export function* denOfEvil(game: Game, svc: any): Generator<void> {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const pickit = svc.get(Pickit)

  if (townAreas.has(game.area)) {
    yield* healInTown(game)
  }

  // Journey to Den of Evil
  yield* move.journeyTo(Area.DenofEvil)

  // Clear the entire level — keep moving and fighting until nothing left
  for (let pass = 0; pass < 20; pass++) {
    let foundMonsters = false
    for (const m of game.monsters) {
      if (m.isAttackable) { foundMonsters = true; break }
    }
    if (!foundMonsters) break

    // Find the closest attackable monster and move toward it
    let closest: any = null
    let closestDist = Infinity
    for (const m of game.monsters) {
      if (m.isAttackable && m.distance < closestDist) {
        closest = m; closestDist = m.distance
      }
    }
    if (closest) {
      yield* moveTo(game, atk, pickit, closest.x, closest.y)
    }
    yield* clear(game, atk, { range: 30, maxCasts: 500 })
    yield* pickit.lootGround()
  }

}
