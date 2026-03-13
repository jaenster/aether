import { createScript, Area } from "diablo:game"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"
import { Town } from "../../services/town.js"

/**
 * Cave — clear Cold Plains Cave Lvl 1 & 2 for early XP.
 */
export const Cave = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)
  const town = svc.get(Town)

  game.log('[cave] starting')

  // Navigate to Cave Lvl 1
  if (game.area !== Area.ColdPlains) {
    yield* move.useWaypoint(Area.ColdPlains)
  }
  yield* move.takeExit(Area.CaveLvl1)

  game.log('[cave] clearing Cave Lvl 1')
  yield* atk.clear({ killRange: 30, maxCasts: 50 })
  yield* loot.lootGround()

  // Move to Cave Lvl 2
  yield* move.takeExit(Area.CaveLvl2)

  game.log('[cave] clearing Cave Lvl 2')
  yield* atk.clear({ killRange: 30, maxCasts: 50 })
  yield* loot.lootGround()

  game.log('[cave] returning to town')
  yield* town.goToTown()

  game.log('[cave] complete')
})
