import { createScript, Area } from "diablo:game"
import { Movement } from "../services/movement.js"
import { Attack } from "../services/attack.js"
import { Pickit } from "../services/pickit.js"
import { Supplies } from "../services/supplies.js"

// Fixed positions in Durance of Hate Level 3
const BRIDGE_TRIGGER = { x: 17590, y: 8068 }
const PORTAL_POS = { x: 17601, y: 8070 }

export const Mephisto = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)
  const supplies = svc.get(Supplies)

  yield* supplies.checkAndResupply()
  game.log('[mephisto] starting run')
  yield* move.journeyTo(Area.DuranceofHateLvl3)

  // Activate the bridge by teleporting to the trigger spot and waiting
  yield* move.moveTo(BRIDGE_TRIGGER.x, BRIDGE_TRIGGER.y)
  for (let i = 0; i < 20; i++) yield // ~0.8s for bridge activation to start

  // Find and kill Mephisto (bridge rises during the fight)
  const meph = game.monsters.find(m => m.classid === 242 && atk.alive(m))
  if (meph) {
    yield* move.moveTo(meph.x, meph.y)
    yield* atk.kill(meph)
  }

  game.log('[mephisto] looting')
  yield* loot.lootGround()

  // Teleport to the red portal and use it
  // The bridge has had enough time to rise during the fight + loot
  yield* move.moveTo(PORTAL_POS.x, PORTAL_POS.y)

  const portal = game.objects.find(o => o.classid === 342 && o.mode === 1)
  if (portal) {
    game.log(`[mephisto] using portal id=${portal.unitId}`)
    game.interact(portal)
    yield* game.waitForArea(Area.PandemoniumFortress)
  } else {
    game.log('[mephisto] portal not found or not active')
  }

  game.log('[mephisto] run complete')
})
