import { createScript, Area } from "diablo:game"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"

const HORADRIC_CUBE_CLASSID = 549
const CUBE_CHEST_CLASSID = 354

/**
 * Cube — acquire the Horadric Cube from Halls of the Dead Lvl 3.
 */
export const Cube = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)

  game.log('[cube] starting')

  // Check if we already have the cube
  const existing = game.items.find(i => i.classid === HORADRIC_CUBE_CLASSID)
  if (existing) {
    game.log('[cube] already have Horadric Cube')
    return
  }

  yield* move.journeyTo(Area.HallsoftheDeadLvl3)

  // Find the cube chest
  const preset = game.findPreset(2, CUBE_CHEST_CLASSID)
  if (preset) {
    yield* move.moveTo(preset.x, preset.y)
  }

  yield* atk.clear({ killRange: 10, maxCasts: 15 })

  const chest = game.objects.find(o => o.classid === CUBE_CHEST_CLASSID)
  if (chest) {
    game.interact(chest)
    yield* game.delay(500)
  }

  yield* loot.lootGround()

  game.log('[cube] complete')
})
