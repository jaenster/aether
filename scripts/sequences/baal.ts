import { createScript, Area } from "diablo:game"
import { Movement } from "../services/movement.js"
import { Attack } from "../services/attack.js"
import { Pickit } from "../services/pickit.js"

export const Baal = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)

  game.log('[baal] starting run')

  // WSK 2 → Throne of Destruction
  yield* move.takeExit(Area.WorldstoneLvl3)
  yield* move.takeExit(Area.ThroneofDestruction)

  // Clear throne waves
  game.log('[baal] clearing throne waves')
  for (let wave = 0; wave < 5; wave++) {
    yield* atk.clearNearby()
    yield* game.delay(3000)
  }

  // Enter worldstone chamber
  yield* move.takeExit(Area.WorldstoneChamber)

  // Kill Baal (classid 544)
  game.log('[baal] engaging baal')
  yield* atk.kill(544)

  // Loot
  game.log('[baal] looting')
  yield* loot.lootGround()

  game.log('[baal] run complete')
})
