import { createScript, Area } from "diablo:game"
import { Movement } from "../services/movement.js"
import { Attack } from "../services/attack.js"
import { Pickit } from "../services/pickit.js"

export const Andy = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)

  game.log('[andy] starting run')

  // Take waypoint to Catacombs 2, walk to level 3, then 4
  yield* move.takeExit(Area.CatacombsLvl3)
  yield* move.takeExit(Area.CatacombsLvl4)

  // Find and kill Andariel (classid 156)
  game.log('[andy] engaging andariel')
  yield* atk.kill(156)

  // Loot
  game.log('[andy] looting')
  yield* loot.lootGround()

  game.log('[andy] run complete')
})
