import { createScript, Area } from "diablo:game"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"
import { Town } from "../../services/town.js"

// Quest item classids
const KHALIM_EYE = 553
const KHALIM_HEART = 554
const KHALIM_BRAIN = 555
const KHALIM_FLAIL = 174
const KHALIM_WILL = 175

// Chest classids for quest items
const EYE_CHEST = 407
const HEART_CHEST = 405
const BRAIN_CHEST = 406

// Travincal objects
const COMPELLING_ORB = 404

/**
 * Khalim's Will — collect 3 body parts from dungeons, retrieve flail from
 * Travincal council, cube them together, use Khalim's Will to smash the Orb.
 *
 * Parts:
 *   Eye   → Spider Cavern (from Spider Forest)
 *   Heart → A3 Sewers Lvl 2 (from Kurast Bazaar)
 *   Brain → Flayer Dungeon Lvl 3 (from Flayer Jungle)
 */
export const KhalimsWill = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)
  const town = svc.get(Town)

  game.log('[khalim] starting')

  // Part 1: Eye — Spider Cavern
  if (!game.items.find(i => i.classid === KHALIM_EYE)) {
    game.log('[khalim] fetching eye from Spider Cavern')
    yield* move.journeyTo(Area.SpiderCavern)

    const eyePreset = game.findPreset(2, EYE_CHEST)
    if (eyePreset) {
      yield* move.moveTo(eyePreset.x, eyePreset.y)
      yield* atk.clear({ killRange: 10, maxCasts: 15 })
      const chest = game.objects.find(o => o.classid === EYE_CHEST)
      if (chest) {
        game.interact(chest)
        yield* game.delay(500)
      }
      yield* loot.lootGround()
    }
    yield* town.goToTown()
  }

  // Part 2: Heart — A3 Sewers Lvl 2
  if (!game.items.find(i => i.classid === KHALIM_HEART)) {
    game.log('[khalim] fetching heart from Sewers')
    yield* move.journeyTo(Area.A3SewersLvl2)

    const heartPreset = game.findPreset(2, HEART_CHEST)
    if (heartPreset) {
      yield* move.moveTo(heartPreset.x, heartPreset.y)
      yield* atk.clear({ killRange: 10, maxCasts: 15 })
      const chest = game.objects.find(o => o.classid === HEART_CHEST)
      if (chest) {
        game.interact(chest)
        yield* game.delay(500)
      }
      yield* loot.lootGround()
    }
    yield* town.goToTown()
  }

  // Part 3: Brain — Flayer Dungeon Lvl 3
  if (!game.items.find(i => i.classid === KHALIM_BRAIN)) {
    game.log('[khalim] fetching brain from Flayer Dungeon')
    yield* move.journeyTo(Area.FlayerDungeonLvl3)

    const brainPreset = game.findPreset(2, BRAIN_CHEST)
    if (brainPreset) {
      yield* move.moveTo(brainPreset.x, brainPreset.y)
      yield* atk.clear({ killRange: 10, maxCasts: 15 })
      const chest = game.objects.find(o => o.classid === BRAIN_CHEST)
      if (chest) {
        game.interact(chest)
        yield* game.delay(500)
      }
      yield* loot.lootGround()
    }
    yield* town.goToTown()
  }

  // Part 4: Kill council at Travincal for the flail
  if (!game.items.find(i => i.classid === KHALIM_FLAIL) && !game.items.find(i => i.classid === KHALIM_WILL)) {
    game.log('[khalim] killing Travincal council for flail')
    yield* move.useWaypoint(Area.Travincal)

    // Clear the council area
    yield* atk.clear({ killRange: 30, maxCasts: 60 })
    yield* loot.lootGround()
    yield* town.goToTown()
  }

  // Part 5: Cube everything together
  // (Transmute: eye + heart + brain + flail = Khalim's Will)
  // Note: actual cube interaction is engine-dependent
  game.log('[khalim] items collected — cube transmute needed')

  // Part 6: Smash the Compelling Orb
  if (game.items.find(i => i.classid === KHALIM_WILL)) {
    game.log('[khalim] smashing the Compelling Orb')
    yield* move.useWaypoint(Area.Travincal)

    const orb = game.objects.find(o => o.classid === COMPELLING_ORB)
    if (orb) {
      yield* move.moveTo(orb.x - 5, orb.y - 5)
      game.interact(orb)
      yield* game.delay(2000)
    }

    // Enter Durance of Hate
    yield* move.takeExit(Area.DuranceofHateLvl1)
    yield* move.takeExit(Area.DuranceofHateLvl2)

    // Get waypoint
    const wpPreset = move.findWaypointPreset()
    if (wpPreset) {
      yield* move.moveTo(wpPreset.x, wpPreset.y)
      const wpUnit = move.findWaypointUnit(wpPreset.x, wpPreset.y)
      if (wpUnit) {
        game.interact(wpUnit)
        yield* game.delay(500)
        game.log('[khalim] Durance Lvl 2 waypoint acquired')
      }
    }
  }

  game.log('[khalim] complete')
})
