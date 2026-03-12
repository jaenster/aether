import { createService, type Game, type Monster } from "diablo:game"
import { Config } from "../config.js"
import { Movement } from "./movement.js"
import { findBestAction, rankActions, skillRange } from "../lib/game-data.js"
import type { AttackOptions, Pos } from "../lib/attack-types.js"

function alive(m: Monster): boolean {
  return m.valid && m.hp > 0 && m.mode !== 0 && m.mode !== 12
}

export const Attack = createService((game: Game, services) => {
  const cfg = services.get(Config)
  const move = services.get(Movement)

  function casterPos(): Pos {
    return { x: game.player.x, y: game.player.y }
  }

  /** Default filter: alive and within range */
  function inRange(range: number): (m: Monster) => boolean {
    return (m: Monster) => alive(m) && m.distance < range
  }

  function* preSelect(skill: number) {
    game.useSkill(skill, game.player.x, game.player.y)
    yield
    for (let f = 0; f < 8; f++) {
      if (game.player.canCast) return
      yield
    }
  }

  function* waitCastDone(maxFrames = 30) {
    yield
    for (let f = 0; f < maxFrames; f++) {
      if (game.player.canCast) return
      yield
    }
  }

  function* applyDebuffs(opts: AttackOptions) {
    if (!opts.debuffs) return
    for (const d of opts.debuffs) {
      const range = skillRange(d.skillId)
      const targets = game.monsters.filter(m => alive(m) && m.distance < range)
      if (targets.length === 0) continue
      if (d.checkState && targets[0]!.getState(d.checkState)) continue

      game.log(`[atk] debuff skill=${d.skillId} on ${targets.length} targets`)
      yield* preSelect(d.skillId)
      game.castSkill(targets[0]!.x, targets[0]!.y)
      yield* waitCastDone()
    }
  }

  return {
    /**
     * Kill a specific monster. Evaluates the battlefield each cast to pick
     * the best skill + position, considering splash damage on nearby monsters.
     * monsterFilter controls which monsters are considered for AoE scoring.
     */
    *kill(target: Monster, opts?: AttackOptions) {
      const maxCasts = opts?.maxCasts ?? cfg.maxAttacks
      const killRange = opts?.killRange ?? cfg.killRange
      let currentSkill = -1
      let lastHp = -1
      let staleCount = 0

      if (opts?.debuffs) yield* applyDebuffs(opts)

      for (let casts = 0; casts < maxCasts; casts++) {
        if (!alive(target)) {
          game.log(`[atk] target dead after ${casts} casts`)
          return
        }
        if (opts?.shouldContinue && !opts.shouldContinue()) return

        const action = findBestAction(
          casterPos(),
          inRange(killRange),
          [...game.monsters],
          game.player.charclass,
          target,
          opts?.skillFilter,
        )

        if (!action) {
          game.log(`[atk] no viable skill for classid=${target.classid}`)
          return
        }

        if (casts % 5 === 0) {
          game.log(`[atk] cast=${casts} hp=${target.hp} skill=${action.skillId} hit=${action.monstersHit} dps=${action.dpsPerFrame|0}${action.needsReposition ? ' REPO' : ''}`)
        }

        // Stale detection — immune monster
        if (target.hp === lastHp) {
          if (++staleCount >= 10) {
            game.log(`[atk] hp stuck at ${target.hp} — immune, giving up`)
            return
          }
        } else {
          staleCount = 0
          lastHp = target.hp
        }

        if (action.needsReposition) {
          yield* move.teleportTo(action.casterPos.x, action.casterPos.y, 5)
        }

        if (action.skillId !== currentSkill) {
          yield* preSelect(action.skillId)
          currentSkill = action.skillId
        }

        if (target.distance > skillRange(action.skillId)) {
          yield* move.moveNear(target.x, target.y, skillRange(action.skillId))
        }

        game.castSkill(action.targetPos.x, action.targetPos.y)
        yield* waitCastDone()
      }

      if (alive(target)) {
        game.log(`[atk] max casts (${maxCasts}) reached, target still alive`)
      }
    },

    /**
     * Clear all monsters matching filter. Picks best action each cast
     * considering the entire visible group — targets clusters over individuals.
     */
    *clear(opts?: AttackOptions) {
      const maxCasts = opts?.maxCasts ?? cfg.maxAttacks
      const killRange = opts?.killRange ?? cfg.killRange
      const filter = inRange(killRange)
      let currentSkill = -1

      if (opts?.debuffs) yield* applyDebuffs(opts)

      for (let casts = 0; casts < maxCasts; casts++) {
        if (opts?.shouldContinue && !opts.shouldContinue()) return

        const action = findBestAction(
          casterPos(),
          filter,
          [...game.monsters],
          game.player.charclass,
          undefined,
          opts?.skillFilter,
        )

        if (!action) {
          game.log(`[atk] area clear after ${casts} casts`)
          return
        }

        if (casts % 10 === 0) {
          game.log(`[atk] clearing: hit=${action.monstersHit} skill=${action.skillId}`)
        }

        if (action.needsReposition) {
          yield* move.teleportTo(action.casterPos.x, action.casterPos.y, 5)
        }

        if (action.skillId !== currentSkill) {
          yield* preSelect(action.skillId)
          currentSkill = action.skillId
        }

        const d = Math.sqrt(
          (game.player.x - action.targetPos.x) ** 2 +
          (game.player.y - action.targetPos.y) ** 2
        )
        if (d > skillRange(action.skillId)) {
          yield* move.moveNear(action.targetPos.x, action.targetPos.y, skillRange(action.skillId))
        }

        game.castSkill(action.targetPos.x, action.targetPos.y)
        yield* waitCastDone()
      }
    },

    /** Expose for external evaluation (team coordination, etc.) */
    findBestAction(pos: Pos, filter: (m: Monster) => boolean, primary?: Monster, skillFilter?: (s: number) => boolean) {
      return findBestAction(pos, filter, [...game.monsters], game.player.charclass, primary, skillFilter)
    },

    alive,
  }
})
