import { createScript, Area } from "diablo:game"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"

/**
 * Far Oasis — XP farming area for early Act 2 leveling (levels ~20-24).
 */
export const FarOasis = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)

  game.log('[far-oasis] starting')

  yield* move.useWaypoint(Area.FarOasis)

  // Clear the area
  game.log('[far-oasis] clearing')
  yield* atk.clear({ killRange: 30, maxCasts: 100 })
  yield* loot.lootGround()

  game.log('[far-oasis] complete')
})
