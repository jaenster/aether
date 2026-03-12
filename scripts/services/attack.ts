import { createService, type Game } from "diablo:game"
import { Config } from "../config.js"
import { Movement } from "./movement.js"
import { monsterEffort, castingFrames, skillRange } from "../lib/game-data.js"

export const Attack = createService((game: Game, services) => {
  const cfg = services.get(Config)
  const move = services.get(Movement)

  function bestSkill(classid: number): { skill: number, delay: number, range: number } {
    const result = monsterEffort(classid, game.area)
    if (result.skill < 0) {
      return { skill: cfg.mainSkill, delay: cfg.castDelay, range: skillRange(cfg.mainSkill) }
    }
    const frames = castingFrames(result.skill, game.player.charclass)
    const delay = Math.max(200, frames * 40)
    return { skill: result.skill, delay, range: skillRange(result.skill) }
  }

  return {
    *clearNearby() {
      let casts = 0
      while (casts < cfg.maxAttacks) {
        const target = game.monsters.find(m => m.hp > 0 && m.distance < cfg.killRange)
        if (!target) return

        const { skill, delay, range } = bestSkill(target.classid)
        if (target.distance > range) {
          yield* move.moveNear(target.x, target.y, range)
        }
        game.useSkill(skill, target.x, target.y)
        casts++
        yield* game.delay(delay)
      }
    },

    *kill(classid: number) {
      const { skill, delay, range } = bestSkill(classid)
      game.log(`[atk] killing classid=${classid} skill=${skill} range=${range} delay=${delay}ms`)

      let casts = 0
      while (casts < cfg.maxAttacks) {
        const target = game.monsters.find(m => m.classid === classid && m.hp > 0)
        if (!target) return

        if (target.distance > range) {
          yield* move.moveNear(target.x, target.y, range)
        }
        game.useSkill(skill, target.x, target.y)
        casts++
        yield* game.delay(delay)
      }
    },
  }
})
