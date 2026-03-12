import { createService, type Game } from "diablo:game"
import { Config } from "../config.js"
import { Movement } from "./movement.js"
import { monsterEffort, castingFrames, skillRange } from "../lib/game-data.js"

export const Attack = createService((game: Game, services) => {
  const cfg = services.get(Config)
  const move = services.get(Movement)

  function bestSkill(classid: number, minRange = 0): { skill: number, delay: number, range: number } {
    const result = monsterEffort(classid, game.area, 0, 0, minRange)
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
      let { skill, delay, range } = bestSkill(classid)
      game.log(`[atk] killing classid=${classid} skill=${skill} range=${range} delay=${delay}ms`)

      let casts = 0
      let stuckCount = 0
      let lastDist = Infinity

      while (casts < cfg.maxAttacks) {
        const target = game.monsters.find(m => m.classid === classid && m.hp > 0)
        if (!target) return

        if (target.distance > range) {
          yield* move.moveNear(target.x, target.y, range)

          // Detect stuck: if distance didn't improve, we might be blocked (moat etc)
          if (target.distance >= lastDist - 2) {
            stuckCount++
            if (stuckCount >= 3 && range < 10) {
              // Switch to ranged skill
              const ranged = bestSkill(classid, 10)
              if (ranged.range > range) {
                game.log(`[atk] stuck at dist=${target.distance|0}, switching to ranged skill=${ranged.skill}`)
                skill = ranged.skill
                delay = ranged.delay
                range = ranged.range
                stuckCount = 0
                continue
              }
            }
          } else {
            stuckCount = 0
          }
          lastDist = target.distance
        }

        game.useSkill(skill, target.x, target.y)
        casts++
        yield* game.delay(delay)
      }
    },
  }
})
