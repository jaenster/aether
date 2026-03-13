import { createScript, Area } from "diablo:game"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"

const IZUAL_CLASSID = 256

/**
 * Izual — find and kill Izual in the Plains of Despair.
 */
export const Izual = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)

  game.log('[izual] starting')

  yield* move.journeyTo(Area.PlainsofDespair)

  // Find Izual preset
  const preset = game.findPreset(1, IZUAL_CLASSID)
  if (preset) {
    yield* move.moveTo(preset.x, preset.y)
  }

  // Kill Izual
  const izual = game.monsters.find(m => m.classid === IZUAL_CLASSID && atk.alive(m))
  if (izual) {
    game.log('[izual] engaging Izual')
    yield* atk.kill(izual)
  }

  yield* loot.lootGround()

  game.log('[izual] complete')
})
