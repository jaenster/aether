import { createService, type Game } from "diablo:game"
import { Config } from "../config.ts"

export const Pickit = createService((game: Game, services) => {
  const cfg = services.get(Config)

  return {
    *lootGround() {
      const items = game.items.filter(i =>
        i.location === 3 &&
        i.distance < cfg.pickRange &&
        i.quality >= cfg.pickMinQuality
      )

      for (const item of items) {
        game.log(`Picking up: ${item.name} (q=${item.quality})`)
        game.clickMap(0, item.x, item.y)
        yield* game.delay(300)
      }
    },
  }
})
