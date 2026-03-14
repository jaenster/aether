import { Urgency } from "../enums.js"
import { NpcFlags } from "../npc-flags.js"
import type { TownAction, TownContext } from "../action.js"

// Known merc classid ranges — mercs are monsters with these classids
const mercClassIds = new Set([
  // Act 1 Rogue
  271, 272,
  // Act 2 Guard
  338, 339, 340, 341, 342, 343, 344, 345, 346, 347, 348, 349, 350, 351, 352, 353, 354, 355, 356, 357, 358, 359,
  // Act 3 Iron Wolf
  359, 360, 361,
  // Act 5 Barb
  560, 561,
])

function isMercDead(ctx: TownContext): boolean {
  // If we have no merc at all, nothing to resurrect
  // Check if we have a dead merc by seeing if any monster with merc classid has mode 12 (dead)
  // TODO: more reliable merc detection — check player stat for merc existence
  for (const mon of ctx.game.monsters) {
    if (mercClassIds.has(mon.classid) && mon.mode === 12) {
      return true
    }
  }
  return false
}

export const resurrectAction: TownAction = {
  type: 'resurrect',
  npcFlag: NpcFlags.RESURRECT,

  check(ctx: TownContext): Urgency {
    if (isMercDead(ctx)) return Urgency.Needed
    return Urgency.Not
  },

  *run(ctx: TownContext, npcClassid: number) {
    const npc = ctx.game.npcs.find(n => n.classid === npcClassid && n.canResurrect)
    if (!npc) {
      ctx.game.log(`[town:resurrect] NPC classid=${npcClassid} not found`)
      return false
    }

    ctx.game.log(`[town:resurrect] resurrecting merc at ${npc.name}`)
    yield* npc.interact()
    yield* ctx.game.delay(300)

    // TODO: select the resurrect dialog option via npcMenuSelect
    // For now, Tyrael/Kashya/etc. auto-resurrect on interact in some versions
    yield* npc.close()
    ctx.game.log(`[town:resurrect] done`)
    return true
  },
}
