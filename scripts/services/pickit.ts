import { createService, type Game, ItemContainer } from "diablo:game"
import { Config } from "../config.js"
import { ItemGrading } from "../lib/item/evaluator.js"

export const Pickit = createService((game: Game, services) => {
  const cfg = services.get(Config)
  const grading = services.get(ItemGrading)

  return {
    *lootGround() {
      const items = game.items.filter(i =>
        i.location === ItemContainer.Ground &&
        i.distance < cfg.pickRange &&
        grading.shouldPickup(i)
      )

      for (const item of items) {
        game.log(`Picking up: ${item.name} (q=${item.quality})`)
        game.clickMap(0, item.x, item.y)
        yield* game.delay(300)
      }
    },
  }
})
