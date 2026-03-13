import { createScript, Area, type Monster } from "diablo:game"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"

const BAAL_CLASSID = 544
const BAAL_THRONE_CLASSID = 543 // Baal sitting on throne
const PORTAL_CLASSID = 563

// Wave monster classids for identification
const WAVE_MONSTERS: Record<number, number> = {
  23: 1, 62: 1,    // Wave 1
  105: 2, 381: 2,  // Wave 2
  557: 3,           // Wave 3
  558: 4,           // Wave 4
  571: 5,           // Wave 5
}

/**
 * Baal — full Throne of Destruction wave clear and Baal boss fight.
 * Clears 5 waves of monsters in the throne room, then enters
 * the Worldstone Chamber to fight Baal.
 */
export const BaalRun = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)

  game.log('[baal] starting run')
  yield* move.journeyTo(Area.ThroneofDestruction)

  // Move to throne position
  yield* move.moveTo(15106, 5040)

  // Safe spots for kiting in the throne room
  const safeSpots: { x: number, y: number }[] = []
  for (let i = 0; i < 360; i += 15) {
    safeSpots.push({
      x: Math.round(15093 + 25 * Math.cos(i * Math.PI / 180)),
      y: Math.round(5029 + 25 * Math.sin(i * Math.PI / 180)),
    })
  }

  // Clear any initial monsters
  yield* clearThrone(game, move, atk, loot, safeSpots)

  // Wait for and clear 5 waves
  const throneRegion = { x1: 15070, y1: 5000, x2: 15120, y2: 5075 }

  for (let wave = 0; wave < 5; wave++) {
    game.log(`[baal] waiting for wave ${wave + 1}`)

    // Wait for wave to spawn
    const spawned: unknown = yield* game.waitUntil(() => {
      const monsters = game.monsters.filter(m =>
        atk.alive(m) &&
        m.x >= throneRegion.x1 && m.x <= throneRegion.x2 &&
        m.y >= throneRegion.y1 && m.y <= throneRegion.y2
      )
      return monsters.length > 0
    }, 200)

    if (!spawned) {
      // Baal may have left
      if (!game.monsters.find(m => m.classid === BAAL_THRONE_CLASSID)) {
        game.log('[baal] Baal has left the throne')
        break
      }
      continue
    }

    game.log(`[baal] clearing wave ${wave + 1}`)
    yield* clearThrone(game, move, atk, loot, safeSpots)

    // Return to throne position
    yield* move.moveTo(15106, 5040)
  }

  // Enter Worldstone Chamber via portal
  game.log('[baal] looking for portal')
  yield* move.moveTo(15090, 5008)
  yield* game.delay(3000)

  // Wait for Baal to leave
  yield* game.waitUntil(() => !game.monsters.find(m => m.classid === BAAL_THRONE_CLASSID), 200)

  const portal = game.objects.find(o => o.classid === PORTAL_CLASSID)
  if (portal) {
    yield* move.moveTo(portal.x, portal.y)
    game.interact(portal)
    yield* game.waitForArea(Area.WorldstoneChamber)
  }

  // Kill Baal
  game.log('[baal] engaging Baal')
  yield* move.moveTo(15134, 5923)

  const baal = game.monsters.find(m => m.classid === BAAL_CLASSID && atk.alive(m))
  if (baal) {
    yield* atk.kill(baal)
  }

  game.log('[baal] looting')
  yield* loot.lootGround()

  game.log('[baal] run complete')
})

function* clearThrone(
  game: any, move: any, atk: any, loot: any,
  safeSpots: { x: number, y: number }[]
) {
  const throneRegion = { x1: 15070, y1: 5000, x2: 15120, y2: 5075 }

  for (let round = 0; round < 100; round++) {
    const units = game.monsters.filter((m: Monster) =>
      atk.alive(m) &&
      m.x >= throneRegion.x1 && m.x <= throneRegion.x2 &&
      m.y >= throneRegion.y1 && m.y <= throneRegion.y2
    )

    if (units.length === 0) break

    // If monsters are too close, kite
    const tooClose = units.filter((m: Monster) => m.distance < 7)
    if (tooClose.length > 0) {
      const best = safeSpots
        .filter(s => {
          const d = Math.sqrt((game.player.x - s.x) ** 2 + (game.player.y - s.y) ** 2)
          return d > 30
        })
        .sort((a, b) => {
          const da = units.reduce((acc: number, m: Monster) =>
            acc + Math.sqrt((a.x - m.x) ** 2 + (a.y - m.y) ** 2), 0)
          const db = units.reduce((acc: number, m: Monster) =>
            acc + Math.sqrt((b.x - m.x) ** 2 + (b.y - m.y) ** 2), 0)
          return db - da
        })[0]

      if (best) {
        yield* move.teleportTo(best.x, best.y)
      }
    }

    yield* atk.clear({ killRange: 25, maxCasts: 5 })
  }

  yield* loot.lootGround()
}
