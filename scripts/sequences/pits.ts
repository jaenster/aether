import { createScript, Area, type Monster } from "diablo:game"
import { Movement } from "../services/movement.js"
import { Attack } from "../services/attack.js"
import { Pickit } from "../services/pickit.js"
import { Buffs } from "../services/buffs.js"
import { Supplies } from "../services/supplies.js"

const CLEAR_RANGE = 30

const priority = (a: Monster, b: Monster) => {
  if (a.isSuperUnique !== b.isSuperUnique) return a.isSuperUnique ? -1 : 1
  if (a.isUnique !== b.isUnique) return a.isUnique ? -1 : 1
  if (a.isChampion !== b.isChampion) return a.isChampion ? -1 : 1
  return a.distance - b.distance
}

export const Pits = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)
  const buffs = svc.get(Buffs)
  const supplies = svc.get(Supplies)

  yield* supplies.checkAndResupply()

  game.log('[pits] starting run')

  // WP to Black Marsh, then walk through Tamoe Highland to Pit
  // (journeyTo handles the full chain automatically)
  yield* move.journeyTo(Area.PitLvl1)

  if (game.area !== Area.PitLvl1) {
    game.log('[pits] failed to reach Pit Level 1')
    return
  }
  yield* buffs.refreshAll()

  game.log('[pits] clearing Pit Level 1')
  yield* clearDungeon(game, move, atk, loot, buffs, '[pits]')

  game.log('[pits] descending to Pit Level 2')
  yield* findAndTakeExit(game, move, Area.PitLvl2)

  if (game.area === Area.PitLvl2) {
    game.log('[pits] clearing Pit Level 2')
    yield* clearDungeon(game, move, atk, loot, buffs, '[pits]')
  }

  game.log('[pits] run complete')
})

function* findAndTakeExit(game: any, move: any, targetArea: number) {
  // Try direct exit first
  const took: unknown = yield* move.takeExit(targetArea)
  if (took || game.area === targetArea) return

  // Teleport around searching for the exit tile
  game.log(`[pits] searching for exit to area ${targetArea}`)
  const cx = game.player.x, cy = game.player.y
  const offsets = [[30, 0], [-30, 0], [0, 30], [0, -30], [30, 30], [-30, -30],
    [50, 0], [-50, 0], [0, 50], [0, -50], [40, 40], [-40, -40]]
  for (const [dx, dy] of offsets) {
    yield* move.moveTo(cx + dx, cy + dy)
    const t: unknown = yield* move.takeExit(targetArea)
    if (t || game.area === targetArea) return
  }
  game.log('[pits] exit not found')
}

function* clearDungeon(game: any, move: any, atk: any, loot: any, buffs: any, tag: string) {
  let emptyTeleports = 0

  for (let step = 0; step < 50 && emptyTeleports < 10; step++) {
    // One scan per step
    const nearby = game.monsters.find((m: Monster) => atk.alive(m) && m.distance < 40)

    if (nearby) {
      emptyTeleports = 0
      if (buffs.needsRefresh()) yield* buffs.refreshOne()

      yield* atk.clear({ killRange: CLEAR_RANGE, maxCasts: 30, priority })
      yield* loot.lootGround()
    } else {
      emptyTeleports++
      // Explore in golden angle spiral from current position
      const angle = (step * 137.5) * Math.PI / 180
      const r = 25 + emptyTeleports * 5
      yield* move.moveTo(
        game.player.x + Math.round(Math.cos(angle) * r),
        game.player.y + Math.round(Math.sin(angle) * r),
      )
    }
  }

  game.log(`${tag} level cleared`)
}
