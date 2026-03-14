import { Urgency } from "../enums.js"
import { NpcFlags } from "../npc-flags.js"
import { ItemAction } from "../../item/types.js"
import type { TownAction, TownContext } from "../action.js"
import { findStash } from "../act-data.js"
import { itemToBuffer, bufferToStorage, clickButton } from "../../packets.js"

/** Max gold in stash (2.5M) */
const GOLD_BANK_MAX = 2_500_000
/** Stash gold when carrying more than this */
const GOLD_STASH_THRESHOLD = 100_000

function getKeepItems(ctx: TownContext) {
  return ctx.game.items.filter(i =>
    i.location === 0 && ctx.grading.evaluate(i) === ItemAction.Keep
  )
}

function shouldStashGold(ctx: TownContext): boolean {
  return ctx.game.player.gold >= GOLD_STASH_THRESHOLD
    && ctx.game.player.goldStash < GOLD_BANK_MAX
}

export const stashAction: TownAction = {
  type: 'stash',
  npcFlag: NpcFlags.STASH,
  dependencies: ['identify', 'sell'],

  check(ctx: TownContext): Urgency {
    const keepers = getKeepItems(ctx)
    if (keepers.length > 0) return Urgency.Needed
    if (shouldStashGold(ctx)) return Urgency.Needed
    // Unidentified items may become keepers after identification
    const hasUnids = ctx.game.items.find(i =>
      i.location === 0 && ctx.grading.evaluate(i) === ItemAction.Identify
    ) !== undefined
    if (hasUnids) return Urgency.Convenience
    return Urgency.Not
  },

  *run(ctx: TownContext, _npcClassid: number) {
    const keepers = getKeepItems(ctx)
    const needGold = shouldStashGold(ctx)
    if (keepers.length === 0 && !needGold) return true

    const stash = findStash(ctx.game)
    if (!stash) {
      ctx.game.log(`[town:stash] stash object not found`)
      return false
    }

    yield* ctx.move.walkTo(stash.x, stash.y)
    ctx.game.interact(stash)
    yield* ctx.game.delay(500)

    // Stash items
    for (const item of keepers) {
      ctx.game.log(`[town:stash] stashing ${item.name} (${item.code})`)
      ctx.game.sendPacket(itemToBuffer(item.unitId))
      yield* ctx.game.delay(200)
      ctx.game.sendPacket(bufferToStorage(item.unitId, 0, 0, 4))
      yield* ctx.game.delay(200)
    }

    // Stash gold
    if (needGold) {
      const amount = ctx.game.player.gold
      ctx.game.log(`[town:stash] stashing ${amount} gold`)
      ctx.game.sendPacket(clickButton(0x14, amount))
      yield* ctx.game.delay(300)
    }

    ctx.game.log(`[town:stash] done`)
    return true
  },
}
