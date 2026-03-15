import { createScript, Area, type Monster } from "diablo:game"
import { Movement } from "../services/movement.js"
import { Attack } from "../services/attack.js"
import { Pickit } from "../services/pickit.js"
import { Buffs } from "../services/buffs.js"
import { Supplies } from "../services/supplies.js"
import { clearArea } from "../lib/area-clear.js"

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

  yield* move.journeyTo(Area.PitLvl1)
  if (game.area !== Area.PitLvl1) {
    game.log('[pits] failed to reach Pit Level 1')
    return
  }
  yield* buffs.refreshAll()

  game.log('[pits] clearing Pit Level 1')
  yield* clearArea({ game, move, atk, loot, buffs, priority, tag: '[pits:L1]' })

  // Descend to level 2
  game.log('[pits] descending to Pit Level 2')
  yield* findAndTakeExit(game, move, Area.PitLvl2)

  if (game.area === Area.PitLvl2) {
    yield* buffs.refreshAll()
    game.log('[pits] clearing Pit Level 2')
    yield* clearArea({ game, move, atk, loot, buffs, priority, tag: '[pits:L2]' })
  }

  game.log('[pits] run complete')
})

function* findAndTakeExit(game: any, move: any, targetArea: number) {
  const took: unknown = yield* move.takeExit(targetArea)
  if (took || game.area === targetArea) return

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
