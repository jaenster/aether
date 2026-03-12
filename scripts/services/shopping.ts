import { createService, type Game, type NPC, UiFlags } from "diablo:game"
import { Config } from "../config.js"
import { Town } from "./town.js"
import { findNpc, NpcService, type NpcInfo } from "../lib/npcs.js"
import { npcBuy } from "../lib/packets.js"

export interface ShopFilter {
  /** Item code to look for (e.g. "amu", "rin", "wnd") */
  code?: string
  /** Minimum quality (4=magic, 5=set, 6=rare) */
  minQuality?: number
  /** Custom filter — return true to buy */
  filter?: (item: { classid: number, code: string, quality: number, name: string, unitId: number }) => boolean
}

export const Shopping = createService((game: Game, services) => {
  const cfg = services.get(Config)
  const town = services.get(Town)

  return {
    /**
     * Shop at an NPC repeatedly, refreshing inventory by closing/reopening trade.
     * Calls `onItem` for each interesting item found; buy by returning true.
     */
    *shopAt(npcInfo: NpcInfo, filters: ShopFilter[], maxCycles = 100) {
      game.log(`[shop] starting at ${npcInfo.name}, ${maxCycles} cycles`)

      for (let cycle = 0; cycle < maxCycles; cycle++) {
        const npcUnit: NPC | null = yield* town.openTrade((n: NPC) => n.classid === npcInfo.classid)
        if (!npcUnit) {
          game.log(`[shop] failed to open trade, retrying...`)
          yield* game.delay(500)
          continue
        }

        // Scan shop items
        for (const item of game.items) {
          // Shop items have location 2 (in NPC's inventory)
          if (item.location !== 2) continue

          for (const f of filters) {
            let match = true
            if (f.code && item.code !== f.code) match = false
            if (f.minQuality && item.quality < f.minQuality) match = false
            if (f.filter && !f.filter(item)) match = false

            if (match) {
              game.log(`[shop] FOUND: ${item.name} (${item.code}) q=${item.quality} id=${item.unitId}`)
              // Buy it — cost 0 lets the server calculate
              game.sendPacket(npcBuy(npcUnit.unitId, item.unitId, 0, 0))
              yield* game.delay(300)
            }
          }
        }

        // Close and reopen to refresh inventory
        yield* npcUnit.close()
        yield* game.delay(200)

        // Log progress periodically
        if ((cycle + 1) % 25 === 0) {
          game.log(`[shop] cycle ${cycle + 1}/${maxCycles}`)
        }
      }

      game.log(`[shop] finished ${maxCycles} cycles`)
    },

    /** Convenience: shop for items at the appropriate NPC for current town. */
    *shopTrade(filters: ShopFilter[], maxCycles = 100) {
      const npc = findNpc(game.area, NpcService.Trade)
      if (!npc) {
        game.log(`[shop] no trade NPC in area ${game.area}`)
        return
      }
      yield* this.shopAt(npc, filters, maxCycles)
    },

    /** Shop at gamble NPC. */
    *shopGamble(filters: ShopFilter[], maxCycles = 100) {
      const npc = findNpc(game.area, NpcService.Gamble)
      if (!npc) {
        game.log(`[shop] no gamble NPC in area ${game.area}`)
        return
      }
      yield* this.shopAt(npc, filters, maxCycles)
    },
  }
})
