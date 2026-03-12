import { createScript, Area } from "diablo:game"
import { Movement } from "../services/movement.js"
import { Attack } from "../services/attack.js"
import { Pickit } from "../services/pickit.js"
import { Supplies } from "../services/supplies.js"
import { isReviver } from "../lib/monster-data.js"

export const Baal = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)
  const supplies = svc.get(Supplies)

  yield* supplies.checkAndResupply()
  game.log('[baal] starting run')
  yield* move.journeyTo(Area.ThroneofDestruction)

  // Move to throne position
  yield* move.moveTo(15095, 5029)

  // Wait for and clear 5 waves
  game.log('[baal] clearing throne waves')
  for (let wave = 0; wave < 5; wave++) {
    // Wait for wave to spawn
    yield* game.delay(2000)

    // Only fight monsters within the throne room box, kill revivers first
    yield* atk.clear({
      spatialFilter: (m) => m.y < 5080 && m.x > 15070 && m.x < 15120,
      focusTarget: (monsters) => monsters.find(m => isReviver(m.classid)) || undefined,
      groupModifier: (target, nearby) => {
        // Boost urgency for revivers near dead monsters
        if (isReviver(target.classid)) {
          const deadNearby = nearby.filter(m => m.mode === 12 || m.hp <= 0).length
          if (deadNearby > 0) return 3.0
          return 2.0
        }
        return 1.0
      },
    })

    game.log(`[baal] wave ${wave + 1} cleared`)
  }

  // Enter Worldstone Chamber via portal (object classid 563)
  const portal = game.findPreset(2, 563)
  if (portal) {
    yield* move.moveTo(portal.x, portal.y)
    const portalUnit = game.objects.find(o => o.classid === 563)
    if (portalUnit) {
      game.interact(portalUnit)
      yield* game.waitForArea(Area.WorldstoneChamber)
    }
  }

  game.log('[baal] engaging baal')
  const baal = game.monsters.find(m => m.classid === 544 && atk.alive(m))
  if (baal) yield* atk.kill(baal)

  game.log('[baal] looting')
  yield* loot.lootGround()

  game.log('[baal] run complete')
})
