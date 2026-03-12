import { createScript, Area } from "diablo:game"
import { Movement } from "../services/movement.js"
import { Attack } from "../services/attack.js"
import { Pickit } from "../services/pickit.js"

export const Andy = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)

  game.log('[andy] starting run')
  yield* move.journeyTo(Area.CatacombsLvl4)

  // Move to Andariel's spawn area
  yield* move.moveTo(22549, 9520)

  game.log('[andy] engaging andariel')
  const andy = game.monsters.find(m => m.classid === 156 && atk.alive(m))
  if (andy) yield* atk.kill(andy)

  game.log('[andy] looting')
  yield* loot.lootGround()

  game.log('[andy] run complete')
})
