import { ItemContainer } from "diablo:game"
import { Urgency } from "../enums.js"
import { NpcFlags } from "../npc-flags.js"
import type { TownAction, TownContext } from "../action.js"
import { npcBuy } from "../../packets.js"

function getKeyCount(ctx: TownContext): number {
  // Check inventory, cube, and stash
  const keys = ctx.game.items.find(i => i.location === ItemContainer.Inventory && i.code === 'key')
    ?? ctx.game.items.find(i => i.location === ItemContainer.Cube && i.code === 'key')
    ?? ctx.game.items.find(i => i.location === ItemContainer.Stash && i.code === 'key')
  return keys ? keys.quantity : 0
}

export const keysAction: TownAction = {
  type: 'keys',
  npcFlag: NpcFlags.KEYS,
  needsTrade: true,

  check(ctx: TownContext): Urgency {
    const count = getKeyCount(ctx)
    if (count < 6) return Urgency.Convenience
    return Urgency.Not
  },

  *run(ctx: TownContext, npcClassid: number) {
    const npc = ctx.game.npcs.find(n => n.classid === npcClassid)
    if (!npc) return false

    const shopKey = ctx.game.items.find(i => i.location === ItemContainer.Vendor && i.code === 'key')
    if (shopKey) {
      ctx.game.log(`[town:keys] buying keys`)
      ctx.game.sendPacket(npcBuy(npc.unitId, shopKey.unitId, 0, 0))
      yield* ctx.game.delay(300)
    }

    return true
  },
}
