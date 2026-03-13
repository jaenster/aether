import { createScript, Area } from "diablo:game"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"

/**
 * Eldritch — kill Eldritch the Rectifier and Shenk the Overseer
 * in the Frigid Highlands. Quick boss farming run.
 */
export const Eldritch = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)

  game.log('[eldritch] starting')

  yield* move.useWaypoint(Area.FrigidHighlands)

  // Eldritch is near the waypoint (around 3726, 5058)
  yield* move.moveTo(3726, 5058)

  game.log('[eldritch] clearing Eldritch area')
  yield* atk.clear({ killRange: 25, maxCasts: 30 })

  // Kill any remaining super uniques
  const boss = game.monsters.find(m => atk.alive(m) && m.isSuperUnique)
  if (boss) {
    yield* atk.kill(boss)
  }

  // Shenk is further down (around 3909, 5113)
  yield* move.moveTo(3909, 5113)

  game.log('[eldritch] clearing Shenk area')
  yield* atk.clear({ killRange: 25, maxCasts: 30 })

  const shenk = game.monsters.find(m => atk.alive(m) && m.isSuperUnique)
  if (shenk) {
    yield* atk.kill(shenk)
  }

  game.log('[eldritch] looting')
  yield* loot.lootGround()

  game.log('[eldritch] complete')
})
