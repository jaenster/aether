import { createScript, Area } from "diablo:game"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"
import { Town } from "../../services/town.js"

const VIPER_CHEST_CLASSID = 149
const VIPER_AMULET_CLASSID = 521

/**
 * Amulet — fetch the Viper Amulet from Claw Viper Temple Lvl 2.
 */
export const Amulet = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)
  const town = svc.get(Town)

  game.log('[amulet] starting')

  yield* move.journeyTo(Area.ClawViperTempleLvl2)

  // Move to the chest location
  yield* move.moveTo(15044, 14045)

  // Clear monsters around the chest
  yield* atk.clear({ killRange: 15, maxCasts: 20 })

  // Find and open the viper chest
  const chest = game.objects.find(o => o.classid === VIPER_CHEST_CLASSID)
  if (chest) {
    yield* move.moveTo(chest.x, chest.y)
    game.interact(chest)
    yield* game.delay(500)
  }

  // Pick up the amulet
  yield* loot.lootGround()

  yield* town.goToTown()

  // Quest completion packet
  game.sendPacket(new Uint8Array([0x40]))

  game.log('[amulet] complete')
})
