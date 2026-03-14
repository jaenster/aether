import { Urgency } from "../enums.js"
import { NpcFlags } from "../npc-flags.js"
import { ItemAction } from "../../item/types.js"
import type { TownAction, TownContext } from "../action.js"

function getUnidentified(ctx: TownContext) {
  return ctx.game.items.filter(i =>
    i.location === 0 && ctx.grading.evaluate(i) === ItemAction.Identify
  )
}

export const identifyAction: TownAction = {
  type: 'identify',
  npcFlag: NpcFlags.CAIN_ID,

  check(ctx: TownContext): Urgency {
    const unids = getUnidentified(ctx)
    if (unids.length > 0) return Urgency.Needed
    return Urgency.Not
  },

  *run(ctx: TownContext, npcClassid: number) {
    const unids = getUnidentified(ctx)
    if (unids.length === 0) return true

    const npc = ctx.game.npcs.find(n => n.classid === npcClassid && n.canIdentify)
    if (!npc) {
      ctx.game.log(`[town:identify] Cain classid=${npcClassid} not found`)
      return false
    }

    ctx.game.log(`[town:identify] identifying ${unids.length} items at ${npc.name}`)
    yield* npc.interact()
    yield* ctx.game.delay(1000)
    yield* npc.close()
    ctx.game.log(`[town:identify] done`)
    return true
  },
}
