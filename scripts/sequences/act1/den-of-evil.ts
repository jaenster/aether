import { createScript, Area } from "diablo:game"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"
import { Town } from "../../services/town.js"

/**
 * Den of Evil — first quest in Act 1.
 * Navigate to the Den, clear all monsters, complete the quest.
 */
export const DenOfEvil = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)
  const town = svc.get(Town)

  game.log('[den-of-evil] starting')

  yield* move.journeyTo(Area.DenofEvil)

  // Clear the entire level
  game.log('[den-of-evil] clearing level')
  yield* atk.clear({ killRange: 40, maxCasts: 200 })

  // Quest completion packet
  game.sendPacket(new Uint8Array([0x40]))

  game.log('[den-of-evil] quest complete')
  yield* town.goToTown()
})
