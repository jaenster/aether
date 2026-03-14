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

export const AncientTunnels = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)
  const buffs = svc.get(Buffs)
  const supplies = svc.get(Supplies)

  yield* supplies.checkAndResupply()

  game.log('[at] starting Ancient Tunnels run')
  yield* move.journeyTo(Area.AncientTunnels)
  yield* buffs.refreshAll()

  game.log('[at] clearing')
  let emptyTeleports = 0

  for (let step = 0; step < 50 && emptyTeleports < 10; step++) {
    const nearby = game.monsters.find((m: Monster) => atk.alive(m) && m.distance < 40)

    if (nearby) {
      emptyTeleports = 0
      if (buffs.needsRefresh()) yield* buffs.refreshOne()

      yield* atk.clear({ killRange: CLEAR_RANGE, maxCasts: 30, priority })
      yield* loot.lootGround()
    } else {
      emptyTeleports++
      const angle = (step * 137.5) * Math.PI / 180
      const r = 25 + emptyTeleports * 5
      yield* move.moveTo(
        game.player.x + Math.round(Math.cos(angle) * r),
        game.player.y + Math.round(Math.sin(angle) * r),
      )
    }
  }

  game.log('[at] run complete')
})
