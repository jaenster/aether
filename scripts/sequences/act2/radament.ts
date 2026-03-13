import { createScript, Area } from "diablo:game"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"
import { Town } from "../../services/town.js"

const RADAMENT_CLASSID = 229
const BOOK_OF_SKILL_CLASSID = 552

/**
 * Radament — kill Radament in Sewers Lvl 3, pick up Book of Skill.
 */
export const Radament = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)
  const town = svc.get(Town)

  game.log('[radament] starting')

  yield* move.useWaypoint(Area.A2SewersLvl2)
  yield* move.takeExit(Area.A2SewersLvl3)

  // Move to Radament's chest area (preset 355)
  const preset = game.findPreset(2, 355)
  if (preset) {
    yield* move.moveTo(preset.x, preset.y)
  }

  // Kill Radament
  const radament = game.monsters.find(m => m.classid === RADAMENT_CLASSID && atk.alive(m))
  if (radament) {
    game.log('[radament] engaging Radament')
    yield* atk.kill(radament)
  }

  game.log('[radament] looting')
  yield* loot.lootGround()

  // Pick up Book of Skill
  const book = game.items.find(i => i.classid === BOOK_OF_SKILL_CLASSID && i.location === 3)
  if (book) {
    game.log('[radament] picking up Book of Skill')
    game.clickMap(0, book.x, book.y)
    yield* game.delay(500)
  }

  yield* town.goToTown()
  game.log('[radament] complete')
})
