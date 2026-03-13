import { createScript, Area } from "diablo:game"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Town } from "../../services/town.js"

const DOOR_CLASSID = 434
const QUALKEHK_CLASSID = 515

/**
 * Rescue Barbarians — free barbarian prisoners in the Frigid Highlands
 * by destroying cage doors. Talk to Qual-Kehk to complete the quest.
 */
export const RescueBarbs = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const town = svc.get(Town)

  game.log('[rescue-barbs] starting')

  yield* move.useWaypoint(Area.FrigidHighlands)

  // Find barbarian cage preset positions (classid 473)
  // There are 3 cage locations scattered around
  // Attack doors at each location to free the barbs
  yield* atk.clear({ killRange: 15, maxCasts: 20 })

  // Find and destroy all cage doors
  for (let pass = 0; pass < 3; pass++) {
    const doors = game.monsters.filter(m => m.classid === DOOR_CLASSID && atk.alive(m))
    if (doors.length === 0) break

    for (const door of doors) {
      yield* move.moveNear(door.x, door.y, 5)
      yield* atk.kill(door, { maxCasts: 20 })
      yield* game.delay(500)
    }
  }

  yield* game.delay(2000)

  // Return to town and talk to Qual-Kehk
  yield* town.goToTown()

  const qualKehk = game.objects.find(o => o.classid === QUALKEHK_CLASSID)
  if (qualKehk) {
    yield* move.walkTo(qualKehk.x, qualKehk.y)
    game.interact(qualKehk)
    yield* game.delay(1000)
  }

  // Quest packet
  game.sendPacket(new Uint8Array([0x40]))
  yield* game.delay(500)

  game.log('[rescue-barbs] complete')
})
