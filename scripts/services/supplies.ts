import { createService, type Game } from "diablo:game"
import { Town } from "./town.js"
import { Movement } from "./movement.js"
import { ItemGrading } from "../lib/item/evaluator.js"
import { ItemAction } from "../lib/item/types.js"
import {
  beltCodes, beltSlotMap,
  HP_POTS, MP_POTS, HP_POT_SET, MP_POT_SET,
} from "../lib/item-data.js"
import { npcBuy, npcSell } from "../lib/packets.js"

interface SupplyState {
  hpPots: number
  mpPots: number
  beltCapacity: number
  tpCount: number
  needsRepair: boolean
}

function getBeltSize(game: Game): number {
  const belt = game.items.find(i => i.location === 1 && beltCodes.has(i.code))
  if (!belt) return 4
  return beltSlotMap[belt.code] ?? 4
}

function checkSupplies(game: Game): SupplyState {
  const beltCapacity = getBeltSize(game)
  let hpPots = 0
  let mpPots = 0
  let tpCount = 0
  let needsRepair = false

  for (const item of game.items) {
    // Belt potions (location=2 when NOT in trade screen)
    if (item.location === 2) {
      if (HP_POT_SET.has(item.code)) hpPots++
      else if (MP_POT_SET.has(item.code)) mpPots++
    }
    // TP tome in inventory (location=0)
    if (item.location === 0 && item.code === 'tbk') {
      tpCount = item.quantity
    }
    // Equipped items (location=1) durability check
    if (item.location === 1 && item.maxdurability > 0) {
      const ratio = item.durability / item.maxdurability
      if (ratio < 0.3) needsRepair = true
    }
  }

  return { hpPots, mpPots, beltCapacity, tpCount, needsRepair }
}

export const Supplies = createService((game: Game, services) => {
  const town = services.get(Town)
  const move = services.get(Movement)
  const grading = services.get(ItemGrading)

  function needsResupply(): boolean {
    const s = checkSupplies(game)
    const hpTarget = Math.floor(s.beltCapacity * 3 / 4)
    const mpTarget = Math.floor(s.beltCapacity * 1 / 4)

    if (s.hpPots < Math.floor(hpTarget * 0.75)) return true
    if (s.mpPots < Math.floor(mpTarget * 0.75)) return true
    if (s.tpCount < 5) return true
    if (s.needsRepair) return true
    return false
  }

  return {
    checkSupplies(): SupplyState {
      return checkSupplies(game)
    },

    needsResupply,

    *resupply() {
      const state = checkSupplies(game)
      game.log(`[supplies] belt=${state.hpPots}hp/${state.mpPots}mp cap=${state.beltCapacity} tp=${state.tpCount} repair=${state.needsRepair}`)

      // 1. Go to town
      yield* town.goToTown()

      // 2. Heal
      yield* town.heal()

      // 3. Identify at Cain
      const toIdentify = game.items.filter(i =>
        i.location === 0 && grading.evaluate(i) === ItemAction.Identify
      )
      if (toIdentify.length > 0) {
        game.log(`[supplies] ${toIdentify.length} items need identification`)
        yield* town.identify()
      }

      // 4. Repair if needed
      if (state.needsRepair) {
        yield* town.repair()
      }

      // Snapshot belt item IDs before trade opens (belt and shop both use location=2)
      const beltIds = new Set(
        game.items.filter(i => i.location === 2).map(i => i.unitId)
      )

      // 5. Open trade with heal NPC (sells pots + scrolls in every act)
      const healNpc = game.npcs.find(n => n.canHeal)
      if (!healNpc) {
        game.log(`[supplies] no heal NPC found`)
        return
      }

      yield* move.walkTo(healNpc.x, healNpc.y)
      const ok = yield* healNpc.openTrade()
      if (!ok) {
        game.log(`[supplies] trade didn't open with ${healNpc.name}`)
        yield* healNpc.close()
        return
      }

      // 6. Sell junk
      const junk = game.items.filter(i =>
        i.location === 0 && grading.evaluate(i) === ItemAction.Sell
      )
      for (const item of junk) {
        game.log(`[supplies] selling ${item.name} (${item.code})`)
        game.sendPacket(npcSell(healNpc.unitId, item.unitId, 0, 0))
        yield* game.delay(200)
      }

      // 7. Buy potions to fill belt
      const hpTarget = Math.floor(state.beltCapacity * 3 / 4)
      const mpTarget = Math.floor(state.beltCapacity * 1 / 4)
      const hpNeed = Math.max(0, hpTarget - state.hpPots)
      const mpNeed = Math.max(0, mpTarget - state.mpPots)

      if (hpNeed > 0 || mpNeed > 0) {
        // Find best available potions in shop
        const shopItems = game.items.filter(i => i.location === 2 && !beltIds.has(i.unitId))

        if (hpNeed > 0) {
          const bestHpCode = [...HP_POTS].reverse().find(code =>
            shopItems.some(i => i.code === code)
          )
          if (bestHpCode) {
            const potItem = shopItems.find(i => i.code === bestHpCode)!
            game.log(`[supplies] buying ${hpNeed}x ${bestHpCode}`)
            for (let i = 0; i < hpNeed; i++) {
              game.sendPacket(npcBuy(healNpc.unitId, potItem.unitId, 0, 0))
              yield* game.delay(150)
            }
          }
        }

        if (mpNeed > 0) {
          const bestMpCode = [...MP_POTS].reverse().find(code =>
            shopItems.some(i => i.code === code)
          )
          if (bestMpCode) {
            const potItem = shopItems.find(i => i.code === bestMpCode)!
            game.log(`[supplies] buying ${mpNeed}x ${bestMpCode}`)
            for (let i = 0; i < mpNeed; i++) {
              game.sendPacket(npcBuy(healNpc.unitId, potItem.unitId, 0, 0))
              yield* game.delay(150)
            }
          }
        }
      }

      // 8. Buy TP scrolls if tome is low
      if (state.tpCount < 20) {
        const tpNeed = 20 - state.tpCount
        const shopItems = game.items.filter(i => i.location === 2 && !beltIds.has(i.unitId))
        const tpScroll = shopItems.find(i => i.code === 'tsc')
        if (tpScroll) {
          game.log(`[supplies] buying ${tpNeed}x TP scrolls`)
          for (let i = 0; i < tpNeed; i++) {
            game.sendPacket(npcBuy(healNpc.unitId, tpScroll.unitId, 0, 0))
            yield* game.delay(150)
          }
        }
      }

      // Close trade
      yield* healNpc.close()
      game.log(`[supplies] resupply complete`)
    },

    *checkAndResupply() {
      if (!needsResupply()) return
      yield* this.resupply()
    },
  }
})
