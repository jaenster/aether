/**
 * Waypoint interaction: find, walk to, activate, travel.
 * Cleanly handles the WP UI open/close cycle.
 */

import { type Game, UiFlags } from "diablo:game"
import { closeNPCInteract, getUIFlag } from "diablo:native"
import { walkTo } from "./walk-clear.js"
import { Movement } from "../services/movement.js"

/** Find the waypoint preset in the current area and walk to it */
export function* findAndWalkToWaypoint(game: Game, move: any): Generator<void, { x: number, y: number } | null> {
  const preset = move.findWaypointPreset()
  if (!preset) return null

  yield* walkTo(game, preset.x, preset.y)
  return preset
}

/** Activate (click) the waypoint, wait for UI, then close */
export function* activateWaypoint(game: Game, move: any): Generator<void, boolean> {
  const preset = yield* findAndWalkToWaypoint(game, move)
  if (!preset) {
    game.log('[wp] no waypoint in area ' + game.area)
    return false
  }

  // Find the actual WP unit near the preset
  const wpUnit = move.findWaypointUnit(preset.x, preset.y)
  if (!wpUnit) {
    game.log('[wp] waypoint unit not found near preset')
    return false
  }

  // Walk close
  if (wpUnit.distance > 5) {
    yield* walkTo(game, wpUnit.x, wpUnit.y)
  }

  // Interact
  game.interact(wpUnit)

  // Wait for WP UI to open (flag 0x14)
  for (let i = 0; i < 50; i++) {
    yield
    if (getUIFlag(0x14)) break
  }

  if (!getUIFlag(0x14)) {
    game.log('[wp] WP UI did not open')
    return false
  }

  // Close the WP menu (we just wanted to activate it)
  closeNPCInteract()
  yield* game.delay(200)

  game.log('[wp] waypoint activated in area ' + game.area)
  return true
}

/** Travel via waypoint to a destination area */
export function* travelWaypoint(game: Game, move: any, destArea: number): Generator<void, boolean> {
  const preset = yield* findAndWalkToWaypoint(game, move)
  if (!preset) return false

  const wpUnit = move.findWaypointUnit(preset.x, preset.y)
  if (!wpUnit) return false

  if (wpUnit.distance > 5) {
    yield* walkTo(game, wpUnit.x, wpUnit.y)
  }

  // Interact + travel
  game.interact(wpUnit)
  yield* game.delay(500)

  game.takeWaypoint(wpUnit.unitId, destArea)

  // Wait for area change
  if (yield* game.waitForArea(destArea, 200)) {
    game.log('[wp] traveled to area ' + destArea)
    return true
  }

  game.log('[wp] travel to area ' + destArea + ' failed')
  return false
}
