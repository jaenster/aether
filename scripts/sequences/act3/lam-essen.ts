import { createScript, Area } from "diablo:game"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"
import { Town } from "../../services/town.js"

const LAM_ESSEN_TOME_CLASSID = 193
const LAM_ESSEN_ITEM = 548

/**
 * Lam Essen's Tome — fetch the tome from the Ruined Temple.
 * Uses telekinesis from a safe distance if possible.
 */
export const LamEssen = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)
  const town = svc.get(Town)

  game.log('[lam-essen] starting')

  yield* move.journeyTo(Area.RuinedTemple)

  // Find the tome preset
  const preset = game.findPreset(2, LAM_ESSEN_TOME_CLASSID)
  if (preset) {
    yield* move.moveTo(preset.x, preset.y)
  }

  // Clear nearby threats
  yield* atk.clear({ killRange: 15, maxCasts: 15 })

  // Interact with the tome
  const tome = game.objects.find(o => o.classid === LAM_ESSEN_TOME_CLASSID)
  if (tome) {
    game.interact(tome)
    yield* game.delay(500)
  }

  // Pick up the book item
  yield* loot.lootGround()

  yield* town.goToTown()

  // Quest packet
  game.sendPacket(new Uint8Array([0x40]))
  yield* game.delay(500)

  game.log('[lam-essen] complete')
})
