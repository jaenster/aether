import { createScript, Area } from "diablo:game"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"
import { Town } from "../../services/town.js"

const STAFF_CHEST_CLASSID = 356

/**
 * Staff — fetch the Incomplete Staff from Maggot Lair Lvl 3.
 */
export const Staff = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)
  const town = svc.get(Town)

  game.log('[staff] starting')

  yield* move.journeyTo(Area.MaggotLairLvl3)

  // Find the staff chest preset
  const preset = game.findPreset(2, STAFF_CHEST_CLASSID)
  if (preset) {
    yield* move.moveTo(preset.x, preset.y)
  }

  // Clear around chest
  yield* atk.clear({ killRange: 10, maxCasts: 15 })

  // Open chest
  const chest = game.objects.find(o => o.classid === STAFF_CHEST_CLASSID)
  if (chest) {
    game.interact(chest)
    yield* game.delay(500)
  }

  // Pick up the staff
  yield* loot.lootGround()

  yield* town.goToTown()
  game.log('[staff] complete')
})
