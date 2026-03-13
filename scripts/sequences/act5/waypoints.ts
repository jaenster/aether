import { createScript, Area } from "diablo:game"
import { Movement } from "../../services/movement.js"
import { Town } from "../../services/town.js"

/**
 * Waypoint Getter Act 5 — acquire all Act 5 waypoints progressively.
 */
export const WaypointsAct5 = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const town = svc.get(Town)

  game.log('[waypoints-a5] starting')

  const wpAreas = [
    Area.FrigidHighlands,
    Area.ArreatPlateau,
    Area.CrystalizedPassage,
    Area.GlacialTrail,
    Area.FrozenTundra,
    Area.AncientsWay,
  ]

  for (const area of wpAreas) {
    game.log(`[waypoints-a5] getting waypoint for area ${area}`)

    yield* move.journeyTo(area)

    // Find and activate waypoint
    const wpPreset = move.findWaypointPreset()
    if (wpPreset) {
      yield* move.moveTo(wpPreset.x, wpPreset.y)
      const wpUnit = move.findWaypointUnit(wpPreset.x, wpPreset.y)
      if (wpUnit) {
        game.interact(wpUnit)
        yield* game.delay(500)
        game.log(`[waypoints-a5] waypoint acquired in area ${area}`)
      }
    }

    // Return to town for safety
    yield* town.goToTown()
    yield* town.doTownChores()
  }

  game.log('[waypoints-a5] complete')
})
