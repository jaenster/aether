import { Urgency } from "../enums.js"
import { NpcFlags } from "../npc-flags.js"
import type { TownAction, TownContext } from "../action.js"
import {
  HP_POTS, MP_POTS, HP_POT_SET, MP_POT_SET,
  beltCodes, beltSlotMap,
} from "../../item-data.js"
import { npcBuy } from "../../packets.js"

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

export const potsAction: TownAction = {
  type: 'pots',
  npcFlag: NpcFlags.POTS,

  check(ctx: TownContext): Urgency {
    const capacity = getBeltSize(ctx)
    const { hp, mp } = countBeltPots(ctx)
    const hpTarget = Math.floor(capacity * 3 / 4)
    const mpTarget = Math.floor(capacity * 1 / 4)

    // Completely out of a pot type we want
    if ((hpTarget > 0 && hp === 0) || (mpTarget > 0 && mp === 0)) return Urgency.Needed
    // Below 66% of target
    if (hp < Math.floor(hpTarget * 0.66) || mp < Math.floor(mpTarget * 0.66)) return Urgency.Needed
    // Any missing
    if (hp < hpTarget || mp < mpTarget) return Urgency.Convenience
    return Urgency.Not
  },

  *run(ctx: TownContext, npcClassid: number) {
    const npc = ctx.game.npcs.find(n => n.classid === npcClassid)
    if (!npc) {
      ctx.game.log(`[town:pots] NPC classid=${npcClassid} not found`)
      return false
    }

    const capacity = getBeltSize(ctx)
    const { hp, mp } = countBeltPots(ctx)
    const hpTarget = Math.floor(capacity * 3 / 4)
    const mpTarget = Math.floor(capacity * 1 / 4)
    const hpNeed = Math.max(0, hpTarget - hp)
    const mpNeed = Math.max(0, mpTarget - mp)

    if (hpNeed === 0 && mpNeed === 0) return true

    ctx.game.log(`[town:pots] need ${hpNeed}hp ${mpNeed}mp pots`)

    const ok = yield* npc.openTrade()
    if (!ok) {
      ctx.game.log(`[town:pots] trade failed`)
      yield* npc.close()
      return false
    }
    yield* ctx.game.delay(500)

    const shopItems = ctx.game.items.filter(i => i.location >= 4)

    if (hpNeed > 0) {
      const bestHpCode = [...HP_POTS].reverse().find(code =>
        shopItems.some(i => i.code === code)
      )
      if (bestHpCode) {
        const potItem = shopItems.find(i => i.code === bestHpCode)!
        ctx.game.log(`[town:pots] buying ${hpNeed}x ${bestHpCode}`)
        for (let i = 0; i < hpNeed; i++) {
          ctx.game.sendPacket(npcBuy(npc.unitId, potItem.unitId, 0, 0))
          yield* ctx.game.delay(150)
        }
      }
    }

    if (mpNeed > 0) {
      const bestMpCode = [...MP_POTS].reverse().find(code =>
        shopItems.some(i => i.code === code)
      )
      if (bestMpCode) {
        const potItem = shopItems.find(i => i.code === bestMpCode)!
        ctx.game.log(`[town:pots] buying ${mpNeed}x ${bestMpCode}`)
        for (let i = 0; i < mpNeed; i++) {
          ctx.game.sendPacket(npcBuy(npc.unitId, potItem.unitId, 0, 0))
          yield* ctx.game.delay(150)
        }
      }
    }

    yield* npc.close()
    ctx.game.log(`[town:pots] done`)
    return true
  },
}
