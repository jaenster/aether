import { createScript, Area } from "diablo:game"
import { Movement } from "../../services/movement.js"

/**
 * Walk from Black Marsh to Catacombs — unlock waypoints along the route.
 * Black Marsh → Tamoe Highland → Monastery Gate → Outer Cloister → Barracks →
 * Jail Lvl 1 → ... → Inner Cloister → Cathedral → Catacombs Lvl 1 → Catacombs Lvl 2 (WP)
 */
export const WalkToCatacombs = createScript(function*(game, svc) {
  const move = svc.get(Movement)

  game.log('[walk-to-catacombs] starting')

  if (game.area !== Area.BlackMarsh) {
    yield* move.useWaypoint(Area.BlackMarsh)
  }

  const route = [
    Area.TamoeHighland,
    Area.MonasteryGate,
    Area.OuterCloister,
    Area.Barracks,
    Area.JailLvl1,
    Area.JailLvl2,
    Area.JailLvl3,
    Area.InnerCloister,
    Area.Cathedral,
    Area.CatacombsLvl1,
    Area.CatacombsLvl2,
  ]

  for (const area of route) {
    game.log(`[walk-to-catacombs] → area ${area}`)
    yield* move.takeExit(area)

    // Pick up waypoints when available
    const wpPreset = move.findWaypointPreset()
    if (wpPreset) {
      yield* move.moveTo(wpPreset.x, wpPreset.y)
      const wpUnit = move.findWaypointUnit(wpPreset.x, wpPreset.y)
      if (wpUnit) {
        game.interact(wpUnit)
        yield* game.delay(500)
        game.log(`[walk-to-catacombs] waypoint acquired in area ${area}`)
      }
    }
  }

  game.log('[walk-to-catacombs] complete — at Catacombs Lvl 2')
})
