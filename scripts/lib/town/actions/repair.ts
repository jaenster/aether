import { ItemContainer } from "diablo:game"
import { Urgency } from "../enums.js"
import { NpcFlags } from "../npc-flags.js"
import type { TownAction, TownContext } from "../action.js"

export const repairAction: TownAction = {
  type: 'repair',
  npcFlag: NpcFlags.REPAIR,

  check(ctx: TownContext): Urgency {
    let worstRatio = 1.0

    for (const item of ctx.game.items) {
      if (item.location === ItemContainer.Equipped && item.maxdurability > 0) {
        const ratio = item.durability / item.maxdurability
        if (ratio < worstRatio) worstRatio = ratio
      }
    }

    if (worstRatio < 0.30) return Urgency.Needed
    if (worstRatio < 0.50) return Urgency.Convenience
    return Urgency.Not
  },

  *run(ctx: TownContext, npcClassid: number) {
    const npc = ctx.game.npcs.find(n => n.classid === npcClassid && n.canRepair)
    if (!npc) {
      ctx.game.log(`[town:repair] NPC classid=${npcClassid} not found`)
      return false
    }

    ctx.game.log(`[town:repair] repairing at ${npc.name}`)
    yield* npc.repair()
    ctx.game.log(`[town:repair] done`)
    return true
  },
}
