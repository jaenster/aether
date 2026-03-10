import { createBot } from "diablo:game"
import { Movement } from "./services/movement.js"

// All waypoint preset classids
const waypointIds = [119, 145, 156, 157, 237, 238, 288, 323, 324, 398, 402, 429, 494, 496, 511, 539]

export default createBot('farmer', function*(game, services) {
  const move = services.get(Movement)

  while (true) {
    if (!game.inGame) { yield; continue }

    game.log(`[${game.me.charname}] area=${game.area} pos=${game.me.x},${game.me.y}`)

    // Find waypoint via preset
    let found = false
    for (const wpId of waypointIds) {
      const preset = game.findPreset(2, wpId)
      if (preset) {
        const dist = Math.sqrt((preset.x - game.me.x) ** 2 + (preset.y - game.me.y) ** 2)
        game.log(`  waypoint cls=${wpId} at ${preset.x},${preset.y} dist=${Math.floor(dist)}`)
        if (dist > 5) {
          game.log(`  walking to waypoint...`)
          yield* move.walkTo(preset.x, preset.y)
          game.log(`  arrived at ${game.me.x},${game.me.y}`)
        }

        // Find the actual waypoint object unit to interact with
        const wp = game.objects.find(o => o.classid === wpId)
        if (wp) {
          game.log(`  interacting with waypoint unit id=${wp.unitId} classid=${wp.classid}`)
          game.interact(wp)
        } else {
          game.log(`  waypoint object not found in units (not loaded yet?)`)
        }

        found = true
        break
      }
    }

    if (!found) game.log(`  no waypoint preset found`)

    yield* game.delay(3000)
  }
})
