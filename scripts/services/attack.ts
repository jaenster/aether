import { createService, type Game } from "diablo:game"
import { Config } from "../config.js"

export const Attack = createService((game: Game, services) => {
  const cfg = services.get(Config)

  return {
    *clearNearby() {
      let attempts = 0
      while (attempts < cfg.maxAttacks) {
        const target = game.monsters.find(m => m.hp > 0 && m.distance < cfg.killRange)
        if (!target) return
        game.useSkill(cfg.mainSkill, target.x, target.y)
        attempts++
        yield* game.delay(cfg.castDelay)
      }
    },

    *kill(classid: number) {
      let attempts = 0
      while (attempts < cfg.maxAttacks) {
        const target = game.monsters.find(m => m.classid === classid && m.hp > 0)
        if (!target) return
        game.useSkill(cfg.mainSkill, target.x, target.y)
        attempts++
        yield* game.delay(cfg.castDelay)
      }
    },
  }
})
