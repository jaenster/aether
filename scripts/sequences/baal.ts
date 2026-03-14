import { createScript, Area, type Monster } from "diablo:game"
import { Movement } from "../services/movement.js"
import { Attack } from "../services/attack.js"
import { Pickit } from "../services/pickit.js"
import { Supplies } from "../services/supplies.js"
import { isReviver } from "../lib/monster-data.js"

// Throne room bounds (generous box covering the full area)
const THRONE_BOX = { xMin: 15060, xMax: 15125, yMin: 4990, yMax: 5090 }
const THRONE_POS = { x: 15095, y: 5029 }

// Wave boss class IDs in order
const WAVE_BOSSES = [668, 669, 670, 671, 672] // Colenzo, Achmel, Bartuc, Ventar, Lister

function throneFilter(m: Monster): boolean {
  return m.x >= THRONE_BOX.xMin && m.x <= THRONE_BOX.xMax
      && m.y >= THRONE_BOX.yMin && m.y <= THRONE_BOX.yMax
}

export const Baal = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)
  const supplies = svc.get(Supplies)

  yield* supplies.checkAndResupply()
  game.log('[baal] starting run')
  yield* move.journeyTo(Area.ThroneofDestruction)

  yield* move.moveTo(THRONE_POS.x, THRONE_POS.y)

  game.log('[baal] clearing throne waves')
  for (let wave = 0; wave < 5; wave++) {
    // Wait for wave to appear (detect by boss classid or any new monsters)
    const bossId = WAVE_BOSSES[wave]!
    const spawned: unknown = yield* game.waitUntil(() => {
      return !!game.monsters.find(m => throneFilter(m) && atk.alive(m) && m.classid === bossId)
    }, 750)

    if (!spawned) {
      // Fallback: maybe wave already active, check for any monsters
      const hasMonsters = [...game.monsters].some(m => throneFilter(m) && atk.alive(m))
      if (!hasMonsters) {
        game.log(`[baal] wave ${wave + 1}: no boss detected, skipping`)
        continue
      }
    }

    game.log(`[baal] wave ${wave + 1} started`)

    // Clear the throne — loop until fully empty (handles revivers, stragglers)
    for (let attempt = 0; attempt < 5; attempt++) {
      yield* atk.clear({
        killRange: 40,
        spatialFilter: throneFilter,
        focusTarget: (monsters) => monsters.find(m => isReviver(m.classid)) || undefined,
        groupModifier: (target, nearby) => {
          if (isReviver(target.classid)) {
            const deadNearby = nearby.filter(m => m.mode === 12 || m.hp <= 0).length
            return deadNearby > 0 ? 3.0 : 2.0
          }
          return 1.0
        },
      })

      // Check if any alive monsters remain in the throne
      yield* game.delay(250)
      const remaining = game.monsters.filter(m => throneFilter(m) && atk.alive(m))
      if (remaining.length === 0) break

      game.log(`[baal] wave ${wave + 1}: ${remaining.length} stragglers, re-clearing`)
      // Move toward stragglers if they're far
      const straggler = remaining[0]!
      if (straggler.distance > 15) {
        yield* move.moveNear(straggler.x, straggler.y, 10)
      }
    }

    game.log(`[baal] wave ${wave + 1} cleared`)
    yield* loot.lootGround()
    // Return to throne position for next wave
    yield* move.moveTo(THRONE_POS.x, THRONE_POS.y)
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
  if (baal) yield* atk.kill(baal, { maxCasts: 200 })

  game.log('[baal] looting')
  yield* loot.lootGround()

  game.log('[baal] run complete')
})
