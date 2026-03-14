import { Urgency } from "../enums.js"
import { NpcFlags } from "../npc-flags.js"
import { ItemAction } from "../../item/types.js"
import type { TownAction, TownContext } from "../action.js"
import { npcSell } from "../../packets.js"

function getSellableItems(ctx: TownContext) {
  return ctx.game.items.filter(i =>
    i.location === 0 && ctx.grading.evaluate(i) === ItemAction.Sell
  )
}

export const sellAction: TownAction = {
  type: 'sell',
  npcFlag: NpcFlags.TRADE,
  needsTrade: true,

  get dependencies() {
    return ['identify']
  },

  check(ctx: TownContext): Urgency {
    const junk = getSellableItems(ctx)
    if (junk.length > 0) return Urgency.Needed
    const hasUnids = ctx.game.items.find(i =>
      i.location === 0 && ctx.grading.evaluate(i) === ItemAction.Identify
    ) !== undefined
    if (hasUnids) return Urgency.Convenience
    return Urgency.Not
  },

  *run(ctx: TownContext, npcClassid: number) {
    const junk = getSellableItems(ctx)
    if (junk.length === 0) return true

    const npc = ctx.game.npcs.find(n => n.classid === npcClassid && n.canTrade)
    if (!npc) return false

    ctx.game.log(`[town:sell] selling ${junk.length} items`)
    for (const item of junk) {
      ctx.game.sendPacket(npcSell(npc.unitId, item.unitId, 0, 0))
      yield* ctx.game.delay(200)
    }

    return true
  },
}
