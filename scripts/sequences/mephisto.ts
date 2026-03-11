import { createScript, Area } from "diablo:game"
import { Movement } from "../services/movement.js"
import { Attack } from "../services/attack.js"
import { Pickit } from "../services/pickit.js"

export const Mephisto = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)

  game.log('[mephisto] starting run')

  // Take waypoint to Durance of Hate 2
  yield* move.moveTo(25175, 5090) // typical wp location
  yield* move.takeExit(Area.DuranceofHateLvl3)

  // Find and kill Mephisto (classid 242)
  game.log('[mephisto] engaging mephisto')
  yield* atk.kill(242)

  // Loot
  game.log('[mephisto] looting')
  yield* loot.lootGround()

  game.log('[mephisto] run complete')
})
