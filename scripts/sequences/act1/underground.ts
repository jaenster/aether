import { createScript, Area } from "diablo:game"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"

/**
 * Underground Passage — transit from Stony Field to Dark Wood.
 * Minimal combat, just pass through.
 */
export const Underground = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)

  game.log('[underground] starting')

  if (game.area !== Area.StonyField) {
    yield* move.useWaypoint(Area.StonyField)
  }

  yield* move.takeExit(Area.UndergroundPassageLvl1)

  // Light clear on the way through
  yield* atk.clear({ killRange: 5, maxCasts: 10 })

  yield* move.takeExit(Area.DarkWood)

  game.log('[underground] arrived at Dark Wood')
})
