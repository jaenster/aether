import { createService, type Game, ItemContainer } from "diablo:game"
import { Config } from "../config.js"
import { shouldPickup } from "../lib/item-eval.js"

export const Pickit = createService((game: Game, services) => {
  const cfg = services.get(Config)

  // Track items we failed to pick up — don't retry endlessly
  const failedItems = new Set<number>()
  let failedClearTick = 0

  return {
    *lootGround() {
      // Clear failed set periodically
      if (game._frame - failedClearTick > 500) {
        failedItems.clear()
        failedClearTick = game._frame
      }

      const items = game.items.filter(i =>
        i.location === ItemContainer.Ground &&
        i.distance < cfg.pickRange &&
        !failedItems.has(i.unitId) &&
        shouldPickup(i, game.charLevel, game.gold)
      )

      for (const item of items) {
        if (item.distance > 5) {
          game.move(item.x, item.y)
          yield* game.delay(300)
        }

        game.clickMap(0, item.x, item.y)
        yield* game.delay(400)

        // Mark as failed if still on ground
        const still = game.items.find(i => i.unitId === item.unitId && i.location === ItemContainer.Ground)
        if (still) failedItems.add(item.unitId)
      }
    },
  }
})
