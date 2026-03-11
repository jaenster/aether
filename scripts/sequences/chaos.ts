import { createScript, Area } from "diablo:game"
import { Movement } from "../services/movement.js"
import { Attack } from "../services/attack.js"
import { Pickit } from "../services/pickit.js"

export const Chaos = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)

  game.log('[chaos] starting run')
  yield* move.journeyTo(Area.ChaosSanctuary)

  // Move to the Chaos star (pentagram center)
  yield* move.moveTo(7791, 5293)

  // Open seals and kill seal bosses
  // Vizier seal (classids 395, 396)
  const vizier = game.findPreset(2, 395)
  if (vizier) {
    game.log('[chaos] vizier seal')
    yield* move.moveTo(vizier.x, vizier.y)
    yield* atk.clearNearby()
  }

  // De Seis seal (classid 394)
  const deseis = game.findPreset(2, 394)
  if (deseis) {
    game.log('[chaos] de seis seal')
    yield* move.moveTo(deseis.x, deseis.y)
    yield* atk.clearNearby()
  }

  // Infector seal (classids 392, 393)
  const infector = game.findPreset(2, 392)
  if (infector) {
    game.log('[chaos] infector seal')
    yield* move.moveTo(infector.x, infector.y)
    yield* atk.clearNearby()
  }

  // Return to star and kill Diablo
  yield* move.moveTo(7791, 5293)
  game.log('[chaos] engaging diablo')
  yield* atk.kill(243) // Diablo

  game.log('[chaos] looting')
  yield* loot.lootGround()

  game.log('[chaos] run complete')
})
