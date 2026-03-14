import { Urgency } from "../enums.js"
import { NpcFlags } from "../npc-flags.js"
import type { TownAction, TownContext } from "../action.js"
import { npcBuy } from "../../packets.js"

function getTpTome(ctx: TownContext) {
  return ctx.game.items.find(i => i.location === 0 && i.code === 'tbk') ?? null
}

export const scrollAction: TownAction = {
  type: 'scroll',
  npcFlag: NpcFlags.SCROLL,

  check(ctx: TownContext): Urgency {
    const tome = getTpTome(ctx)
    if (!tome) return Urgency.Needed
    if (tome.quantity < 5) return Urgency.Needed
    if (tome.quantity < 15) return Urgency.Convenience
    return Urgency.Not
  },

  *run(ctx: TownContext, npcClassid: number) {
    const npc = ctx.game.npcs.find(n => n.classid === npcClassid)
    if (!npc) {
      ctx.game.log(`[town:scroll] NPC classid=${npcClassid} not found`)
      return false
    }

    const ok = yield* npc.openTrade()
    if (!ok) {
      ctx.game.log(`[town:scroll] trade failed`)
      yield* npc.close()
      return false
    }
    yield* ctx.game.delay(500)

    const shopItems = ctx.game.items.filter(i => i.location >= 4)
    let tome = getTpTome(ctx)

    // Buy tome if missing
    if (!tome) {
      const shopTome = shopItems.find(i => i.code === 'tbk')
      if (shopTome) {
        ctx.game.log(`[town:scroll] buying TP tome`)
        ctx.game.sendPacket(npcBuy(npc.unitId, shopTome.unitId, 0, 0))
        yield* ctx.game.delay(300)
        tome = getTpTome(ctx)
      }
    }

    // Fill scrolls
    if (tome && tome.quantity < 20) {
      const tpNeed = 20 - tome.quantity
      const tpScroll = shopItems.find(i => i.code === 'tsc')
      if (tpScroll) {
        ctx.game.log(`[town:scroll] buying ${tpNeed}x TP scrolls`)
        for (let i = 0; i < tpNeed; i++) {
          ctx.game.sendPacket(npcBuy(npc.unitId, tpScroll.unitId, 0, 0))
          yield* ctx.game.delay(150)
        }
      }
    }

    yield* npc.close()
    ctx.game.log(`[town:scroll] done`)
    return true
  },
}
