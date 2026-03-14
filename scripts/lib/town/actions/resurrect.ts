import { Urgency } from "../enums.js"
import { NpcFlags } from "../npc-flags.js"
import type { TownAction, TownContext } from "../action.js"

export const resurrectAction: TownAction = {
  type: 'resurrect',
  npcFlag: NpcFlags.RESURRECT,

  check(ctx: TownContext): Urgency {
    if (ctx.game.mercDead) return Urgency.Needed
    return Urgency.Not
  },

  *run(ctx: TownContext, npcClassid: number) {
    if (!ctx.game.mercDead) return true

    const npc = ctx.game.npcs.find(n => n.classid === npcClassid && n.canResurrect)
    if (!npc) {
      ctx.game.log(`[town:resurrect] no resurrect NPC found (classid=${npcClassid})`)
      return false
    }

    ctx.game.log(`[town:resurrect] resurrecting merc at ${npc.name}`)
    yield* npc.interact()
    yield* ctx.game.delay(500)

    // Try menu indices 0-4 to find the resurrect callback
    for (let idx = 0; idx < 5; idx++) {
      const ok = npc.menuSelect(idx)
      ctx.game.log(`[town:resurrect] menuSelect(${idx}) = ${ok}`)
      if (ok) {
        yield* ctx.game.delay(500)
        if (!ctx.game.mercDead) {
          ctx.game.log(`[town:resurrect] merc resurrected via menu index ${idx}`)
          break
        }
      }
    }

    if (ctx.game.mercDead) {
      ctx.game.log(`[town:resurrect] resurrect failed — merc still dead`)
    }

    yield* npc.close()
    return true
  },
}
