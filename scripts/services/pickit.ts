import { createService, type Game, ItemContainer } from "diablo:game"
import { Config } from "../config.js"
import { ItemGrading } from "../lib/item/evaluator.js"

export const Pickit = createService((game: Game, services) => {
  const cfg = services.get(Config)
  const grading = services.get(ItemGrading)

  // Track items we failed to pick up — don't retry endlessly
  const failedItems = new Set<number>()
  let failedClearTick = 0

  return {
    *lootGround() {
      // Clear failed set periodically (every 500 frames = ~20s)
      if (game._frame - failedClearTick > 500) {
        failedItems.clear()
        failedClearTick = game._frame
      }

      const items = game.items.filter(i =>
        i.location === ItemContainer.Ground &&
        i.distance < cfg.pickRange &&
        !failedItems.has(i.unitId) &&
        grading.shouldPickup(i)
      )

      for (const item of items) {
        // Walk close first
        if (item.distance > 5) {
          game.move(item.x, item.y)
          yield* game.delay(300)
        }

        // Click to pick up (left click on ground item)
        game.clickMap(0, item.x, item.y)
        yield* game.delay(400)

        // Check if item was picked up (no longer on ground)
        const still = game.items.find(i => i.unitId === item.unitId && i.location === ItemContainer.Ground)
        if (still) {
          failedItems.add(item.unitId)
        }
      }
    },
  }
})
