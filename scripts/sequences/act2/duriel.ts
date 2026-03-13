import { createScript, Area } from "diablo:game"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"
import { Town } from "../../services/town.js"

const DURIEL_CLASSID = 211
const ORIFICE_CLASSID = 152
const TYRAEL_CLASSID = 367
const PORTAL_TO_DURIEL = 100

/**
 * Duriel — enter Tal Rasha's tomb, place staff, fight Duriel.
 * After killing Duriel, talk to Tyrael to complete the quest.
 */
export const Duriel = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)
  const town = svc.get(Town)

  game.log('[duriel] starting')

  // Navigate to Canyon of Magi if not already in a tomb
  if (game.area < Area.TalRashasTomb1 || game.area > Area.TalRashasTomb7) {
    yield* move.useWaypoint(Area.CanyonofMagic)
  }

  // Find the correct tomb — the one with the Orifice preset
  for (let tombArea = Area.TalRashasTomb1; tombArea <= Area.TalRashasTomb7; tombArea++) {
    if (game.area !== tombArea) {
      if (game.area !== Area.CanyonofMagic) {
        // Back to canyon if we're in wrong tomb
        yield* move.takeExit(Area.CanyonofMagic)
      }
      yield* move.takeExit(tombArea)
    }

    const orifice = game.findPreset(2, ORIFICE_CLASSID)
    if (orifice) {
      game.log(`[duriel] found orifice in tomb ${tombArea}`)
      yield* move.moveTo(orifice.x, orifice.y)
      break
    }
  }

  // Interact with orifice to place staff and open portal
  const orificeUnit = game.objects.find(o => o.classid === ORIFICE_CLASSID)
  if (orificeUnit && orificeUnit.mode === 0) {
    game.log('[duriel] placing staff in orifice')
    game.interact(orificeUnit)
    yield* game.delay(2000)
  }

  // Enter Duriel's Lair through the portal
  const portal = game.objects.find(o => o.classid === PORTAL_TO_DURIEL)
  if (portal) {
    game.interact(portal)
    yield* game.waitForArea(Area.DurielsLair)
  }

  // Fight Duriel
  game.log('[duriel] engaging Duriel')

  const safeSpots = [
    { x: 22648, y: 15688 },
    { x: 22624, y: 15725 },
  ]

  for (let casts = 0; casts < 100; casts++) {
    const duriel = game.monsters.find(m => m.classid === DURIEL_CLASSID && atk.alive(m))
    if (!duriel) break

    // Kite away if too close
    if (duriel.distance < 7) {
      // Pick the safe spot furthest from Duriel
      const best = safeSpots
        .map(s => ({ ...s, d: Math.sqrt((duriel.x - s.x) ** 2 + (duriel.y - s.y) ** 2) }))
        .sort((a, b) => b.d - a.d)[0]!
      yield* move.teleportTo(best.x, best.y)
    }

    yield* atk.kill(duriel, { maxCasts: 5 })
  }

  game.log('[duriel] looting')
  yield* loot.lootGround()

  // Walk through the chamber to Tyrael
  game.log('[duriel] walking to Tyrael')
  yield* move.walkTo(22578, 15642)
  yield* move.walkTo(22576, 15591)

  const tyrael = game.objects.find(o => o.classid === TYRAEL_CLASSID)
  if (tyrael) {
    yield* move.walkTo(tyrael.x, tyrael.y)
    game.interact(tyrael)
    yield* game.delay(1000)
  }

  // Complete quest
  game.sendPacket(new Uint8Array([0x40]))
  yield* game.delay(500)

  game.log('[duriel] complete')
})
