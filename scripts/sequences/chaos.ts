import { createScript, Area } from "diablo:game"
import { Movement } from "../services/movement.js"
import { Attack } from "../services/attack.js"
import { Pickit } from "../services/pickit.js"

export const Chaos = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)

  game.log('[chaos] starting run')

  // Navigate River of Flame → Chaos Sanctuary
  yield* move.takeExit(Area.ChaosSanctuary)

  // Clear seals — Grand Vizier (classid 256), Lord De Seis (classid 257), Infector (classid 258)
  game.log('[chaos] clearing seals')
  yield* atk.clearNearby()

  // Kill Diablo (classid 243)
  game.log('[chaos] engaging diablo')
  yield* atk.kill(243)

  // Loot
  game.log('[chaos] looting')
  yield* loot.lootGround()

  game.log('[chaos] run complete')
})
