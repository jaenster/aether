import { createScript, Area } from "diablo:game"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Town } from "../../services/town.js"

const FROZEN_ANYA_CLASSID = 558
const ANYA_PRESET_CLASSID = 460
const MALAH_CLASSID = 513

/**
 * Anya — rescue Anya from the Frozen River.
 * Navigate to Frozen River, find frozen Anya, interact to thaw her,
 * return to town to talk to Malah, then back to free her.
 */
export const Anya = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const town = svc.get(Town)

  game.log('[anya] starting')

  yield* move.journeyTo(Area.FrozenRiver)

  // Find Anya's preset location
  const preset = game.findPreset(2, ANYA_PRESET_CLASSID)
  if (!preset) {
    game.log('[anya] Anya preset not found')
    return
  }

  // Navigate to Anya, clearing threats on the way
  yield* move.moveTo(preset.x, preset.y)
  yield* atk.clear({ killRange: 20, maxCasts: 25 })

  // Interact with frozen Anya
  const anya = game.objects.find(o => o.classid === FROZEN_ANYA_CLASSID)
  if (anya) {
    game.log('[anya] interacting with frozen Anya')
    yield* move.moveTo(anya.x, anya.y)
    game.interact(anya)
    yield* game.delay(1000)
  }

  // Return to town to talk to Malah
  game.log('[anya] returning to talk to Malah')
  yield* town.goToTown()

  const malah = game.monsters.find(m => m.classid === MALAH_CLASSID)
  if (malah) {
    yield* move.walkTo(malah.x, malah.y)
    game.interact(malah)
    yield* game.delay(1000)
  }

  // Go back to Frozen River to complete the rescue
  // Use town portal if available
  yield* move.journeyTo(Area.FrozenRiver)

  // Interact with Anya again to free her
  const anya2 = game.objects.find(o => o.classid === FROZEN_ANYA_CLASSID)
  if (anya2) {
    game.log('[anya] freeing Anya')
    game.interact(anya2)
    yield* game.delay(1000)
  }

  yield* town.goToTown()

  game.log('[anya] complete')
})
