import { createScript, Area } from "diablo:game"
import { Movement } from "../services/movement.js"
import { Attack } from "../services/attack.js"
import { Pickit } from "../services/pickit.js"

export const Mephisto = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)

  game.log('[mephisto] starting run')
  yield* move.journeyTo(Area.DuranceofHateLvl3)

  // Moat trick: lure Mephisto along the bridge to a safe casting position
  // These coordinates trace the bridge path where he can be attacked from across the moat
  const lurePath = [
    [17563, 8072], [17575, 8086], [17584, 8091], [17600, 8095], [17610, 8094]
  ]
  for (const [x, y] of lurePath) {
    yield* move.moveTo(x!, y!)
    yield* game.delay(500)
  }

  game.log('[mephisto] engaging mephisto')
  yield* atk.kill(242) // Mephisto

  game.log('[mephisto] looting')
  yield* loot.lootGround()

  game.log('[mephisto] run complete')
})
