import { createBot } from "diablo:game"
import { Attack } from "./services/attack.ts"
import { Pickit } from "./services/pickit.ts"
import { Movement } from "./services/movement.ts"
import { townAreas } from "./config.ts"

export default createBot('farmer', function*(game, services) {
  const attack = services.get(Attack)
  const pickit = services.get(Pickit)
  const move = services.get(Movement)

  while (true) {
    if (!game.inGame) {
      game.log('waiting for game...')
      yield* game.delay(1000)
      continue
    }

    const inTown = townAreas.has(game.area)
    const exits = game.getExits()
    game.log(`[${game.me.charname}] area=${game.area}${inTown ? " (town)" : ""} pos=${game.me.x},${game.me.y} exits=${exits.length}`)

    if (inTown) {
      const fieldExit = exits.find(e => !townAreas.has(e.area))
      if (fieldExit) {
        game.log(`  Heading to area ${fieldExit.area} at ${fieldExit.x},${fieldExit.y}`)
        yield* move.takeExit(fieldExit.area)
      } else {
        game.log(`  No field exits, available: ${exits.map(e => e.area).join(", ")}`)
      }
    } else {
      const nearby = game.monsters.filter(m => m.distance < 25 && m.hp > 0)
      if (nearby.length > 0) {
        game.log(`  Engaging ${nearby.length} monsters`)
        yield* attack.clearNearby()
      }
      yield* pickit.lootGround()
    }

    yield* game.delay(2000)
  }
})
