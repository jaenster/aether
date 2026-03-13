import { createScript, Area, type Monster } from "diablo:game"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"
import { Town } from "../../services/town.js"

const ALTAR_CLASSID = 546
const ANCIENT_CLASSIDS = [540, 541, 542] // Talic, Madawc, Korndrak
const STATUE_CLASSID = 475

/**
 * Ancients — fight the 3 Ancients at the Arreat Summit.
 * Activates the altar, then fights with safe-spot kiting.
 */
export const Ancients = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)
  const town = svc.get(Town)

  game.log('[ancients] starting')

  yield* move.journeyTo(Area.ArreatSummit)
  yield* move.moveTo(10048, 12634)

  // Activate the altar
  const altar = game.objects.find(o => o.classid === ALTAR_CLASSID)
  if (altar) {
    yield* move.moveTo(altar.x, altar.y)
    game.interact(altar)
    yield* game.delay(2000)
  }

  // Calculate safe spots in a circle around the altar
  const safeSpots: { x: number, y: number }[] = []
  for (let i = 0; i < 360; i += 10) {
    safeSpots.push({
      x: Math.round(10048 + 25 * Math.cos(i * Math.PI / 180)),
      y: Math.round(12634 + 25 * Math.sin(i * Math.PI / 180)),
    })
  }

  // Fight the ancients
  game.log('[ancients] fighting ancients')
  for (let round = 0; round < 200; round++) {
    // Check if all statues are back (fight over)
    const statues = game.objects.filter(o => o.classid === STATUE_CLASSID)
    if (statues.length >= 3) {
      game.log('[ancients] ancients defeated (statues returned)')
      break
    }

    const ancients = game.monsters.filter(m =>
      ANCIENT_CLASSIDS.includes(m.classid) && atk.alive(m)
    )

    if (ancients.length === 0) {
      game.log('[ancients] no living ancients found')
      break
    }

    // If an ancient is too close, kite to a safe spot
    const tooClose = ancients.filter(a => a.distance < 10)
    if (tooClose.length > 0) {
      // Pick the safe spot furthest from all ancients
      const best = safeSpots
        .map(s => ({
          ...s,
          totalDist: ancients.reduce((acc, a) =>
            acc + Math.sqrt((a.x - s.x) ** 2 + (a.y - s.y) ** 2), 0
          ),
        }))
        .sort((a, b) => b.totalDist - a.totalDist)[0]

      if (best) {
        yield* move.teleportTo(best.x, best.y)
      }
    }

    // Attack the nearest ancient
    const nearest = ancients.sort((a, b) => a.distance - b.distance)[0]!
    yield* atk.kill(nearest, { maxCasts: 3 })
  }

  game.log('[ancients] looting')
  yield* loot.lootGround()

  game.log('[ancients] complete')
})
