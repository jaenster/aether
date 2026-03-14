import { Urgency } from "../enums.js"
import { NpcFlags } from "../npc-flags.js"
import type { TownAction, TownContext } from "../action.js"
import { npcBuy, npcSell } from "../../packets.js"

/** Minimum gold to start gambling */
const GAMBLE_START = 2_500_000
/** Stop gambling at this gold level */
const GAMBLE_STOP = 500_000

/** Classids of items worth gambling (circlets, rings, amulets, gloves, boots, belts) */
const GAMBLE_ITEMS = new Set([
  338,  // circlet
  420,  // tiara
  421,  // diadem
  522,  // ring
  520,  // amulet
  // Class-specific gambles can be added here
])

export const gambleAction: TownAction = {
  type: 'gamble',
  npcFlag: NpcFlags.GAMBLE,

  check(ctx: TownContext): Urgency {
    if (ctx.game.player.gold >= GAMBLE_START) return Urgency.Convenience
    return Urgency.Not
  },

  *run(ctx: TownContext, npcClassid: number) {
    const npc = ctx.game.npcs.find(n => n.classid === npcClassid && n.canGamble)
    if (!npc) {
      ctx.game.log(`[town:gamble] NPC classid=${npcClassid} not found`)
      return false
    }

    ctx.game.log(`[town:gamble] gambling at ${npc.name} (gold=${ctx.game.player.gold})`)
    const ok = yield* npc.openGamble()
    if (!ok) {
      ctx.game.log(`[town:gamble] gamble window failed`)
      yield* npc.close()
      return false
    }
    yield* ctx.game.delay(500)

    while (ctx.game.player.gold >= GAMBLE_STOP) {
      const shopItems = ctx.game.items.filter(i => i.location >= 4)
      const candidate = shopItems.find(i => GAMBLE_ITEMS.has(i.classid))
      if (!candidate) break

      ctx.game.sendPacket(npcBuy(npc.unitId, candidate.unitId, 0, 0))
      yield* ctx.game.delay(300)

      // Check the item we just bought (latest inventory item)
      const bought = ctx.game.items.find(i =>
        i.location === 0 && i.classid === candidate.classid
      )
      if (bought) {
        const action = ctx.grading.evaluate(bought)
        if (action <= 1) {
          // Keep or identify — don't sell back
          ctx.game.log(`[town:gamble] keeping ${bought.name} (${bought.code})`)
        } else {
          // Sell it back
          ctx.game.sendPacket(npcSell(npc.unitId, bought.unitId, 0, 0))
          yield* ctx.game.delay(200)
        }
      }
    }

    yield* npc.close()
    ctx.game.log(`[town:gamble] done (gold=${ctx.game.player.gold})`)
    return true
  },
}
