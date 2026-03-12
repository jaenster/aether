import { createService, type Game, PlayerMode } from "diablo:game"
import { Config } from "../config.js"
import { Movement } from "./movement.js"
import { monsterEffort, castingFrames, skillRange } from "../lib/game-data.js"

export const Attack = createService((game: Game, services) => {
  const cfg = services.get(Config)
  const move = services.get(Movement)

  function bestSkill(classid: number, minRange = 0): { skill: number, delay: number, range: number, frames: number } {
    const result = monsterEffort(classid, game.area, 0, 0, minRange)
    if (result.skill < 0) return { skill: -1, delay: 600, range: 3, frames: 15 }
    const frames = castingFrames(result.skill, game.player.charclass)
    return { skill: result.skill, delay: frames * 40, range: skillRange(result.skill), frames }
  }

  /** Select a skill and wait for it to take effect */
  function* preSelect(skill: number) {
    game.useSkill(skill, game.player.x, game.player.y)
    yield* game.delay(250)
  }

  /** Wait until the player can cast again */
  function* waitCastDone(maxFrames = 30) {
    yield // let the click be processed
    for (let f = 0; f < maxFrames; f++) {
      if (game.player.canCast) return
      yield
    }
  }

  return {
    *clearNearby() {
      let casts = 0
      let currentSkill = -1
      while (casts < cfg.maxAttacks) {
        const target = game.monsters.find(m => m.hp > 0 && m.mode !== 0 && m.mode !== 12 && m.distance < cfg.killRange)
        if (!target) return

        const best = bestSkill(target.classid)
        if (best.skill !== currentSkill) {
          yield* preSelect(best.skill)
          currentSkill = best.skill
        }
        if (target.distance > best.range) {
          yield* move.moveNear(target.x, target.y, best.range)
        }
        game.castSkill(target.x, target.y)
        casts++
        yield* waitCastDone()
      }
    },

    *kill(classid: number) {
      // Prefer ranged — try minRange=10 first, fall back to any skill
      let best = bestSkill(classid, 10)
      if (best.skill < 0) best = bestSkill(classid)
      let { skill, range, frames: castFrames } = best
      const effort = monsterEffort(classid, game.area, 0, 0, 0)
      game.log(`[atk] killing classid=${classid} skill=${skill} type=${effort.type} effort=${effort.effort|0} range=${range}`)

      yield* preSelect(skill)

      let casts = 0
      let lastHp = -1
      let staleCount = 0
      while (casts < cfg.maxAttacks) {
        const target = game.monsters.find(m => m.classid === classid && m.hp > 0 && m.mode !== 0 && m.mode !== 12)
        if (!target) {
          game.log(`[atk] target dead after ${casts} casts`)
          return
        }

        // Log every 5th cast to reduce spam
        if (casts % 5 === 0) {
          game.log(`[atk] cast=${casts} hp=${target.hp} dist=${target.distance|0} mMode=${target.mode}`)
        }

        // Detect immunity: hp unchanged for 10+ casts
        if (target.hp === lastHp) {
          staleCount++
          if (staleCount >= 10) {
            game.log(`[atk] hp stuck at ${target.hp} for ${staleCount} casts — likely immune, giving up`)
            return
          }
        } else {
          staleCount = 0
          lastHp = target.hp
        }

        if (target.distance > range) {
          yield* move.moveNear(target.x, target.y, range)
          yield* preSelect(skill)
        }

        game.castSkill(target.x, target.y)
        casts++
        yield* waitCastDone()
      }
      game.log(`[atk] max attacks (${cfg.maxAttacks}) reached, target still alive`)
    },
  }
})
