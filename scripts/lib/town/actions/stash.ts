import { Urgency } from "../enums.js"
import { NpcFlags } from "../npc-flags.js"
import { ItemAction } from "../../item/types.js"
import type { TownAction, TownContext } from "../action.js"
import { findStash } from "../act-data.js"
import { itemToBuffer, bufferToStorage } from "../../packets.js"

function getKeepItems(ctx: TownContext) {
  return ctx.game.items.filter(i =>
    i.location === 0 && ctx.grading.evaluate(i) === ItemAction.Keep
  )
}

export const stashAction: TownAction = {
  type: 'stash',
  npcFlag: NpcFlags.STASH,
  dependencies: ['identify', 'sell'],

  check(ctx: TownContext): Urgency {
    const keepers = getKeepItems(ctx)
    if (keepers.length > 0) return Urgency.Needed
    // Unidentified items may become keepers after identification
    const hasUnids = ctx.game.items.find(i =>
      i.location === 0 && ctx.grading.evaluate(i) === ItemAction.Identify
    ) !== undefined
    if (hasUnids) return Urgency.Convenience
    return Urgency.Not
  },

  *run(ctx: TownContext, _npcClassid: number) {
    const keepers = getKeepItems(ctx)
    if (keepers.length === 0) return true

    const stash = findStash(ctx.game)
    if (!stash) {
      ctx.game.log(`[town:stash] stash object not found`)
      return false
    }

    ctx.game.log(`[town:stash] stashing ${keepers.length} items`)
    yield* ctx.move.walkTo(stash.x, stash.y)

    ctx.game.interact(stash)
    yield* ctx.game.delay(500)

    // TODO: find free stash positions — for now place at 0,0 and let the server find a spot
    for (const item of keepers) {
      ctx.game.log(`[town:stash] stashing ${item.name} (${item.code})`)
      ctx.game.sendPacket(itemToBuffer(item.unitId))
      yield* ctx.game.delay(200)
      ctx.game.sendPacket(bufferToStorage(item.unitId, 0, 0, 4))
      yield* ctx.game.delay(200)
    }

    ctx.game.log(`[town:stash] done`)
    return true
  },
}
