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

  // Teleport to Mephisto
  yield* move.moveTo(mephPreset.x, mephPreset.y)
  yield* atk.kill(242)

  game.log('[mephisto] looting')
  yield* loot.lootGround()

  // Take red portal to Act 4
  const portal = game.objects.find(o => o.classid === 342)
    ?? game.objects.find(o => o.classid === 341)
  if (portal) {
    game.log(`[mephisto] red portal at ${portal.x},${portal.y}`)
    yield* move.moveTo(portal.x, portal.y)
    game.interact(portal)
    yield* game.waitForArea(Area.PandemoniumFortress)
  }

  game.log('[mephisto] run complete')
})
