import { createScript, Area } from "diablo:game"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"
import { Town } from "../../services/town.js"

const ANYA_CLASSID = 512

/**
 * Pindleskin — enter Nihlathak's Temple via Anya's portal, kill Pindleskin.
 * Quick boss farming run.
 */
export const Pindleskin = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)
  const town = svc.get(Town)

  game.log('[pindleskin] starting')

  yield* town.goToTown()

  // Walk to Anya and use her portal to Nihlathak's Temple
  const anya = game.objects.find(o => o.classid === ANYA_CLASSID)
  if (anya) {
    yield* move.walkTo(anya.x, anya.y)
  }

  // Use the portal near Anya to Nihlathak's Temple (area 121)
  const portal = game.objects.find(o => o.classid === 60 || o.name?.includes('Portal'))
  if (portal) {
    game.interact(portal)
    yield* game.waitForArea(Area.NihlathaksTemple)
  }

  // Move to Pindleskin's location
  yield* move.moveTo(10059, 13246)

  // Kill Pindleskin (a super unique)
  game.log('[pindleskin] engaging')
  const boss = game.monsters.find(m => atk.alive(m) && m.isSuperUnique)
  if (boss) {
    yield* atk.kill(boss)
  }

  // Clear remaining
  yield* atk.clear({ killRange: 15, maxCasts: 20 })

  game.log('[pindleskin] looting')
  yield* loot.lootGround()

  yield* town.goToTown()
  game.log('[pindleskin] complete')
})
