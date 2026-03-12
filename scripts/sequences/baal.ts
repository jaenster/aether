import { createScript, Area } from "diablo:game"
import { Movement } from "../services/movement.js"
import { Attack } from "../services/attack.js"
import { Pickit } from "../services/pickit.js"

export const Baal = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)

  game.log('[baal] starting run')
  yield* move.journeyTo(Area.ThroneofDestruction)

  // Move to throne position
  yield* move.moveTo(15095, 5029)

  // Wait for and clear 5 waves
  // Waves spawn monsters with y < 5080 near the throne
  game.log('[baal] clearing throne waves')
  for (let wave = 0; wave < 5; wave++) {
    // Wait for wave to spawn
    yield* game.delay(2000)
    yield* atk.clearNearby()
    game.log(`[baal] wave ${wave + 1} cleared`)
  }

  // Enter Worldstone Chamber via portal (object classid 563)
  const portal = game.findPreset(2, 563)
  if (portal) {
    yield* move.moveTo(portal.x, portal.y)
    const portalUnit = game.objects.find(o => o.classid === 563)
    if (portalUnit) {
      game.interact(portalUnit)
      for (let i = 0; i < 150; i++) {
        yield
        if (game.area === Area.WorldstoneChamber) break
      }
    }
  }

  game.log('[baal] engaging baal')
  yield* atk.kill(544) // Baal

  game.log('[baal] looting')
  yield* loot.lootGround()

  game.log('[baal] run complete')
})
