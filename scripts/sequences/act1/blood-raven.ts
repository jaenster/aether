import { createScript, Area } from "diablo:game"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"
import { Town } from "../../services/town.js"

const BLOOD_RAVEN_CLASSID = 805

/**
 * Blood Raven — kill Blood Raven in the Burial Grounds.
 * WP to Cold Plains, walk to Burial Grounds, find and kill Blood Raven.
 */
export const BloodRaven = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)
  const town = svc.get(Town)

  game.log('[blood-raven] starting')

  // Navigate to Burial Grounds via Cold Plains
  if (game.area !== Area.ColdPlains && game.area !== Area.BurialGrounds) {
    yield* move.useWaypoint(Area.ColdPlains)
  }
  if (game.area !== Area.BurialGrounds) {
    yield* move.takeExit(Area.BurialGrounds)
  }

  // Find Blood Raven preset and move there
  const preset = game.findPreset(1, BLOOD_RAVEN_CLASSID)
  if (preset) {
    yield* move.moveTo(preset.x, preset.y)
  }

  // Fight Blood Raven — she moves around, so track and attack
  game.log('[blood-raven] engaging')
  for (let attempts = 0; attempts < 50; attempts++) {
    const raven = game.monsters.find(m => m.classid === BLOOD_RAVEN_CLASSID && atk.alive(m))
    if (!raven) break

    // Clear nearby minions if crowded
    const nearby = game.monsters.filter(m =>
      m.classid !== BLOOD_RAVEN_CLASSID && atk.alive(m) && m.distance < 6
    )
    if (nearby.length > 3) {
      yield* atk.clear({ killRange: 6, maxCasts: 10 })
    }

    if (raven.distance > 6) {
      yield* move.moveNear(raven.x, raven.y, 5)
    }
    yield* atk.kill(raven, { maxCasts: 5 })
  }

  game.log('[blood-raven] looting')
  yield* loot.lootGround()

  game.log('[blood-raven] returning to town')
  yield* town.goToTown()
})
