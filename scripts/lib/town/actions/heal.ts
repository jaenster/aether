import { Urgency } from "../enums.js"
import { NpcFlags } from "../npc-flags.js"
import type { TownAction, TownContext } from "../action.js"

export const healAction: TownAction = {
  type: 'heal',
  npcFlag: NpcFlags.HEAL,

  check(ctx: TownContext): Urgency {
    const { hp, hpmax, mp, mpmax } = ctx.game.player
    if (hp >= hpmax && mp >= mpmax) return Urgency.Not

    const hpPct = hpmax > 0 ? hp / hpmax : 1
    const mpPct = mpmax > 0 ? mp / mpmax : 1
    const worst = Math.min(hpPct, mpPct)

    if (worst <= 0.75) return Urgency.Needed
    if (worst <= 0.90) return Urgency.Convenience
    return Urgency.Not
  },

  *run(ctx: TownContext, npcClassid: number) {
    const npc = ctx.game.npcs.find(n => n.classid === npcClassid && n.canHeal)
    if (!npc) {
      ctx.game.log(`[town:heal] NPC classid=${npcClassid} not found`)
      return false
    }

    ctx.game.log(`[town:heal] healing at ${npc.name} (hp=${ctx.game.player.hp}/${ctx.game.player.hpmax})`)
    yield* npc.heal()
    ctx.game.log(`[town:heal] done (hp=${ctx.game.player.hp}/${ctx.game.player.hpmax})`)
    return true
  },
}
