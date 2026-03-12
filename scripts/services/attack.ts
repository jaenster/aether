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

  /** Select a skill and wait for it to take effect */
  function* preSelect(skill: number) {
    game.useSkill(skill, game.player.x, game.player.y)
    yield* game.delay(250)
  }

  return {
    *clearNearby() {
      let casts = 0
      let currentSkill = -1
      while (casts < cfg.maxAttacks) {
        const target = game.monsters.find(m => m.hp > 0 && m.distance < cfg.killRange)
        if (!target) return

        const { skill, delay, range } = bestSkill(target.classid)
        if (skill !== currentSkill) {
          yield* preSelect(skill)
          currentSkill = skill
        }
        if (target.distance > range) {
          yield* move.moveNear(target.x, target.y, range)
        }
        game.castSkill(target.x, target.y)
        casts++
        yield* game.delay(delay)
      }
    },

    *kill(classid: number) {
      let { skill, delay, range } = bestSkill(classid)
      game.log(`[atk] killing classid=${classid} skill=${skill} range=${range} delay=${delay}ms`)

      // Pre-select the attack skill once
      yield* preSelect(skill)

      let casts = 0
      let stuckCount = 0
      let lastDist = Infinity

      while (casts < cfg.maxAttacks) {
        const target = game.monsters.find(m => m.classid === classid && m.hp > 0)
        if (!target) {
          game.log(`[atk] target dead after ${casts} casts`)
          return
        }

        if (casts % 5 === 0) {
          game.log(`[atk] cast=${casts} hp=${target.hp} dist=${target.distance|0}`)
        }

        if (target.distance > range) {
          yield* move.moveNear(target.x, target.y, range)

          if (target.distance >= lastDist - 2) {
            stuckCount++
            if (stuckCount >= 3 && range < 10) {
              const ranged = bestSkill(classid, 10)
              if (ranged.range > range) {
                game.log(`[atk] stuck at dist=${target.distance|0}, switching to ranged skill=${ranged.skill}`)
                skill = ranged.skill
                delay = ranged.delay
                range = ranged.range
                stuckCount = 0
                yield* preSelect(skill)
                continue
              }
            }
          } else {
            stuckCount = 0
          }
          lastDist = target.distance
        }

        game.castSkill(target.x, target.y)
        casts++
        yield* game.delay(delay)
      }
      game.log(`[atk] max attacks (${cfg.maxAttacks}) reached, target still alive`)
    },
  }
})
