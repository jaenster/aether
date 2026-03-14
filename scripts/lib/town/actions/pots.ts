import { Urgency } from "../enums.js"
import { NpcFlags } from "../npc-flags.js"
import type { TownAction, TownContext } from "../action.js"
import {
  HP_POTS, MP_POTS, HP_POT_SET, MP_POT_SET,
  beltCodes, beltSlotMap,
} from "../../item-data.js"
import { npcBuy } from "../../packets.js"

/** Extra HP/MP pots to keep in inventory as buffer (0 = belt only) */
const HP_BUFFER = 0
const MP_BUFFER = 0

function getBeltSize(ctx: TownContext): number {
  const belt = ctx.game.items.find(i => i.location === 1 && beltCodes.has(i.code))
  if (!belt) return 4
  return beltSlotMap[belt.code] ?? 4
}

function countBeltPots(ctx: TownContext) {
  let hp = 0, mp = 0
  for (const item of ctx.game.items) {
    if (item.location === 2) {
      if (HP_POT_SET.has(item.code)) hp++
      else if (MP_POT_SET.has(item.code)) mp++
    }
  }
  return { hp, mp }
}

function countInventoryPots(ctx: TownContext) {
  let hp = 0, mp = 0
  for (const item of ctx.game.items) {
    if (item.location === 0) {
      if (HP_POT_SET.has(item.code)) hp++
      else if (MP_POT_SET.has(item.code)) mp++
    }
  }
  return { hp, mp }
}

export const potsAction: TownAction = {
  type: 'pots',
  npcFlag: NpcFlags.POTS,
  needsTrade: true,

  check(ctx: TownContext): Urgency {
    const capacity = getBeltSize(ctx)
    const belt = countBeltPots(ctx)
    const inv = countInventoryPots(ctx)
    const hpTarget = Math.floor(capacity * 3 / 4)
    const mpTarget = Math.floor(capacity * 1 / 4)

    if ((hpTarget > 0 && belt.hp === 0) || (mpTarget > 0 && belt.mp === 0)) return Urgency.Needed
    if (belt.hp < Math.floor(hpTarget * 0.66) || belt.mp < Math.floor(mpTarget * 0.66)) return Urgency.Needed
    if (inv.hp < HP_BUFFER || inv.mp < MP_BUFFER) return Urgency.Needed
    if (belt.hp < hpTarget || belt.mp < mpTarget) return Urgency.Convenience
    return Urgency.Not
  },

  *run(ctx: TownContext, npcClassid: number) {
    const npc = ctx.game.npcs.find(n => n.classid === npcClassid)
    if (!npc) return false

    const capacity = getBeltSize(ctx)
    const belt = countBeltPots(ctx)
    const inv = countInventoryPots(ctx)
    const hpTarget = Math.floor(capacity * 3 / 4)
    const mpTarget = Math.floor(capacity * 1 / 4)
    const hpNeed = Math.max(0, hpTarget - belt.hp) + Math.max(0, HP_BUFFER - inv.hp)
    const mpNeed = Math.max(0, mpTarget - belt.mp) + Math.max(0, MP_BUFFER - inv.mp)

    if (hpNeed === 0 && mpNeed === 0) return true

    ctx.game.log(`[town:pots] buying ${hpNeed}hp ${mpNeed}mp`)
    const shopItems = ctx.game.items.filter(i => i.location >= 4)

    if (hpNeed > 0) {
      const bestCode = [...HP_POTS].reverse().find(code =>
        shopItems.find(i => i.code === code) !== undefined
      )
      if (bestCode) {
        const pot = shopItems.find(i => i.code === bestCode)!
        for (let i = 0; i < hpNeed; i++) {
          ctx.game.sendPacket(npcBuy(npc.unitId, pot.unitId, 0, 0))
          yield* ctx.game.delay(150)
        }
      }
    }

    if (mpNeed > 0) {
      const bestCode = [...MP_POTS].reverse().find(code =>
        shopItems.find(i => i.code === code) !== undefined
      )
      if (bestCode) {
        const pot = shopItems.find(i => i.code === bestCode)!
        for (let i = 0; i < mpNeed; i++) {
          ctx.game.sendPacket(npcBuy(npc.unitId, pot.unitId, 0, 0))
          yield* ctx.game.delay(150)
        }
      }
    }

    return true
  },
}
