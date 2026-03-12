import { createScript, Area } from "diablo:game"
import { Movement } from "../services/movement.js"
import { Attack } from "../services/attack.js"
import { Pickit } from "../services/pickit.js"

export const Mephisto = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)

  game.log('[mephisto] starting run')
  yield* move.journeyTo(Area.DuranceofHateLvl3)

  // Find Mephisto's preset position (classid 242, type 1 = monster)
  const mephPreset = game.findPreset(1, 242)
  if (!mephPreset) {
    game.log('[mephisto] could not find mephisto preset')
    return
  }
  game.log(`[mephisto] preset at ${mephPreset.x},${mephPreset.y}`)

  // Teleport near Mephisto
  yield* move.moveTo(mephPreset.x, mephPreset.y)

  const mephDist = Math.sqrt((game.player.x - mephPreset.x)**2 + (game.player.y - mephPreset.y)**2)
  game.log(`[mephisto] after tele: dist to preset=${mephDist|0}, player at ${game.player.x},${game.player.y}`)
  game.log('[mephisto] engaging mephisto')
  yield* atk.kill(242) // Mephisto

  game.log('[mephisto] looting')
  yield* loot.lootGround()

  game.log('[mephisto] run complete')
})
