import { createScript, Area } from "diablo:game"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"
import { Town } from "../../services/town.js"

const SUMMONER_CLASSID = 250
const JOURNAL_CLASSID = 357

/**
 * The Summoner — navigate through Arcane Sanctuary, kill The Summoner,
 * use the journal to open a portal to Canyon of Magi, get waypoint.
 */
export const Summoner = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)
  const town = svc.get(Town)

  game.log('[summoner] starting')

  if (game.area !== Area.ArcaneSanctuary) {
    yield* move.useWaypoint(Area.ArcaneSanctuary)
  }

  // Find the journal preset and navigate to it
  const preset = game.findPreset(2, JOURNAL_CLASSID)
  if (!preset) {
    game.log('[summoner] journal preset not found')
    return
  }

  yield* move.moveTo(preset.x, preset.y)

  // Kill The Summoner if present
  const summoner = game.monsters.find(m => m.classid === SUMMONER_CLASSID && atk.alive(m))
  if (summoner) {
    game.log('[summoner] engaging The Summoner')
    yield* atk.kill(summoner)
    yield* loot.lootGround()
  }

  // Interact with journal to open portal
  const journal = game.objects.find(o => o.classid === JOURNAL_CLASSID)
  if (journal) {
    game.log('[summoner] interacting with journal')
    yield* move.moveTo(journal.x, journal.y)
    game.interact(journal)
    yield* game.delay(1000)
  }

  // Use the red portal to Canyon of Magi
  yield* game.delay(500)

  // Try to get to Canyon of Magi through portal
  const portal = game.objects.find(o => o.classid === 298) // Red portal
  if (portal) {
    game.interact(portal)
    yield* game.waitForArea(Area.CanyonofMagic)
  }

  // Get waypoint in Canyon of Magi
  if (game.area === Area.CanyonofMagic) {
    const wpPreset = move.findWaypointPreset()
    if (wpPreset) {
      yield* move.moveTo(wpPreset.x, wpPreset.y)
      const wpUnit = move.findWaypointUnit(wpPreset.x, wpPreset.y)
      if (wpUnit) {
        game.interact(wpUnit)
        yield* game.delay(500)
        game.log('[summoner] waypoint acquired')
      }
    }
  }

  game.log('[summoner] complete')
})
