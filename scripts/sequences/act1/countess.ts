import { createScript, Area } from "diablo:game"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"
import { Town } from "../../services/town.js"

const COUNTESS_CHEST_CLASSID = 580

/**
 * Countess — navigate through Tower Cellar levels 1-5, kill the Countess for runes.
 */
export const Countess = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)
  const town = svc.get(Town)

  game.log('[countess] starting')

  // Navigate through tower cellar levels
  yield* move.journeyTo(Area.TowerCellarLvl5)

  // Clear each level as we go through exits
  game.log('[countess] clearing Tower Cellar Lvl 5')
  yield* atk.clear({ killRange: 15, maxCasts: 20 })

  // Find the Countess via the super chest preset (classid 580)
  const chestPreset = game.findPreset(2, COUNTESS_CHEST_CLASSID)
  if (chestPreset) {
    yield* move.moveTo(chestPreset.x, chestPreset.y)
  }

  // Kill the Countess — she's a super unique in the room
  game.log('[countess] engaging Countess')
  yield* atk.clear({ killRange: 30, maxCasts: 40 })

  // Kill any remaining super uniques
  const boss = game.monsters.find(m => atk.alive(m) && m.isSuperUnique)
  if (boss) {
    yield* atk.kill(boss)
  }

  game.log('[countess] looting')
  yield* loot.lootGround()

  game.log('[countess] returning to town')
  yield* town.goToTown()
})
