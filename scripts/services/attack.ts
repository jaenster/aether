import { createService, type Game, type Monster } from "diablo:game"
import { Config } from "../config.js"
import { Movement } from "./movement.js"
import { findBestAction, rankActions, skillRange, unitResist, staticFieldEffective, preAttackAdvice } from "../lib/game-data.js"
import type { AttackOptions, Pos, CombatSnapshot, MonsterSnapshot, SpawnEvent } from "../lib/attack-types.js"
import { getUnitHP, getUnitMaxHP, getUnitMP, getDifficulty } from "diablo:native"

function alive(m: Monster): boolean {
  return m.valid && m.hp > 0 && m.mode !== 0 && m.mode !== 12
}

let combatTick = 0

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

  /** Compose inRange with spatial filter from options */
  function makeFilter(range: number, opts?: AttackOptions): (m: Monster) => boolean {
    const base = inRange(range)
    if (!opts?.spatialFilter) return base
    const spatial = opts.spatialFilter
    return (m: Monster) => base(m) && spatial(m)
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

  /** Select target from filtered list: focusTarget override → priority sort → closest */
  function selectTarget(monsters: Monster[], opts?: AttackOptions): Monster | undefined {
    if (monsters.length === 0) return undefined

    if (opts?.focusTarget) {
      const focus = opts.focusTarget(monsters)
      if (focus) return focus
    }

    if (opts?.priority) {
      const sorted = [...monsters].sort(opts.priority)
      return sorted[0]
    }

    // Default: closest
    let closest = monsters[0]!
    let closestDist = closest.distance
    for (let i = 1; i < monsters.length; i++) {
      const d = monsters[i]!.distance
      if (d < closestDist) {
        closest = monsters[i]!
        closestDist = d
      }
    }
    return closest
  }

  function recordSnapshot(
    monsters: Monster[],
    ranked: import("../lib/attack-types.js").ActionScore[],
    chosen: import("../lib/attack-types.js").ActionScore | null,
    filters: string[],
    primaryTarget?: Monster,
  ): CombatSnapshot {
    const pos = casterPos()
    return {
      tick: combatTick++,
      casterPos: pos,
      casterHp: getUnitHP(),
      casterMp: getUnitMP(),
      monsters: monsters.map(m => ({
        unitId: m.unitId,
        classid: m.classid,
        x: m.x,
        y: m.y,
        hp: m.hp,
        hpmax: m.hpmax,
        mode: m.mode,
        spectype: (m as Monster).spectype ?? 0,
        resists: {
          Physical: unitResist(m, "Physical"),
          Fire: unitResist(m, "Fire"),
          Lightning: unitResist(m, "Lightning"),
          Cold: unitResist(m, "Cold"),
          Poison: unitResist(m, "Poison"),
        },
        blocked: false, // filled in by caller if needed
        inFilter: true,
      })),
      rankedActions: ranked,
      chosen,
      filters,
      primaryTarget: primaryTarget ? { unitId: primaryTarget.unitId, classid: primaryTarget.classid, hp: primaryTarget.hp } : undefined,
    }
  }

  function emitSnapshot(snap: CombatSnapshot, opts?: AttackOptions) {
    if (!opts?.debugCombat) return
    if (typeof opts.debugCombat === 'function') {
      opts.debugCombat(snap)
    } else {
      game.log(`[combat] tick=${snap.tick} hp=${snap.casterHp} mp=${snap.casterMp} mons=${snap.monsters.length} chosen=${snap.chosen?.skillId ?? 'none'} dps=${(snap.chosen?.dpsPerFrame ?? 0) | 0}`)
    }
  }

  return {
    /**
     * Kill a specific monster. Evaluates the battlefield each cast to pick
     * the best skill + position, considering splash damage on nearby monsters.
     */
    *kill(target: Monster, opts?: AttackOptions) {
      const maxCasts = opts?.maxCasts ?? cfg.maxAttacks
      const killRange = opts?.killRange ?? cfg.killRange
      const filter = makeFilter(killRange, opts)
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

        const allMonsters = [...game.monsters]
        const action = findBestAction(
          casterPos(),
          filter,
          allMonsters,
          game.player.charclass,
          target,
          opts?.skillFilter,
          opts?.groupModifier,
        )

        if (!action) {
          game.log(`[atk] no viable skill for classid=${target.classid}`)
          return
        }

        if (opts?.debugCombat) {
          const ranked = rankActions(casterPos(), filter, allMonsters, game.player.charclass, target, opts?.skillFilter, 5, opts?.groupModifier)
          const filters: string[] = []
          if (opts.spatialFilter) filters.push('spatialFilter')
          if (opts.skillFilter) filters.push('skillFilter')
          if (opts.groupModifier) filters.push('groupModifier')
          emitSnapshot(recordSnapshot(allMonsters.filter(filter), ranked, action, filters, target), opts)
        }

        if (casts % 5 === 0) {
          game.log(`[atk] cast=${casts} hp=${target.hp}/${target.hpmax} skill=${action.skillId} hit=${action.monstersHit} dps=${action.dpsPerFrame|0} aim=${action.targetPos.x},${action.targetPos.y}${action.needsReposition ? ' REPO' : ''}`)
        }

        // Stale detection — immune monster or Static Field at floor
        // Use higher threshold for bosses
        const isBoss = target.isSuperUnique || target.classid === 243 /* Diablo */ || target.classid === 544 /* Baal */
        const staleThreshold = isBoss ? 30 : 10
        if (target.hp === lastHp) {
          if (++staleCount >= staleThreshold) {
            // If we're using Static Field and HP is at the floor, switch to damage skills
            if (action.skillId === 42 && !staticFieldEffective(target.hp, target.hpmax, getDifficulty())) {
              game.log(`[atk] static field at floor (hp=${target.hp}), switching to damage skills`)
              staleCount = 0
              // Add Static Field to skill filter to exclude it
              const origFilter = opts?.skillFilter
              const noStatic = (sk: number) => sk !== 42 && (!origFilter || origFilter(sk))
              opts = { ...opts, skillFilter: noStatic }
              continue
            }
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
     * Clear all monsters matching filter. Uses tactical options for targeting:
     * spatialFilter → priority sort → focusTarget override → groupModifier scoring.
     */
    *clear(opts?: AttackOptions) {
      const maxCasts = opts?.maxCasts ?? cfg.maxAttacks
      const killRange = opts?.killRange ?? cfg.killRange
      const filter = makeFilter(killRange, opts)
      let currentSkill = -1

      if (opts?.debuffs) yield* applyDebuffs(opts)

      for (let casts = 0; casts < maxCasts; casts++) {
        if (opts?.shouldContinue && !opts.shouldContinue()) return

        const allMonsters = [...game.monsters]
        const filtered = allMonsters.filter(filter)
        if (filtered.length === 0) {
          game.log(`[atk] area clear after ${casts} casts`)
          return
        }

        // Select primary target via tactical options
        const primary = selectTarget(filtered, opts)

        const action = findBestAction(
          casterPos(),
          filter,
          allMonsters,
          game.player.charclass,
          primary,
          opts?.skillFilter,
          opts?.groupModifier,
        )

        if (!action) {
          game.log(`[atk] area clear after ${casts} casts`)
          return
        }

        if (opts?.debugCombat) {
          const ranked = rankActions(casterPos(), filter, allMonsters, game.player.charclass, primary, opts?.skillFilter, 5, opts?.groupModifier)
          const filters: string[] = []
          if (opts.spatialFilter) filters.push('spatialFilter')
          if (opts.skillFilter) filters.push('skillFilter')
          if (opts.focusTarget) filters.push('focusTarget')
          if (opts.groupModifier) filters.push('groupModifier')
          if (opts.priority) filters.push('priority')
          emitSnapshot(recordSnapshot(filtered, ranked, action, filters, primary), opts)
        }

        if (casts % 10 === 0) {
          game.log(`[atk] clearing: hit=${action.monstersHit} skill=${action.skillId} mons=${filtered.length} aim=${action.targetPos.x},${action.targetPos.y}${action.needsReposition ? ' REPO' : ''}`)
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

    /**
     * Pre-attack a predicted spawn location. Casts a delayed skill (Meteor, Blizzard, etc.)
     * timed to land when the monster spawns.
     */
    *preAttack(event: SpawnEvent, opts?: { skillFilter?: (sk: number) => boolean }) {
      game.log(`[atk] preAttack classId=${event.classId} at ${event.pos.x},${event.pos.y} in ~${event.framesUntilSpawn}f`)
      let currentSkill = -1

      for (let f = event.framesUntilSpawn; f > 0; f--) {
        const advice = preAttackAdvice(casterPos(), { ...event, framesUntilSpawn: f }, game.player.charclass)

        if (advice.type === 'cast') {
          game.log(`[atk] preAttack firing skill=${advice.skill} at ${advice.x},${advice.y} f=${f}`)
          if (advice.skill !== currentSkill) {
            yield* preSelect(advice.skill)
            currentSkill = advice.skill
          }
          game.castSkill(advice.x, advice.y)
          yield* waitCastDone()
          return
        }

        if (advice.type === 'reposition') {
          yield* move.teleportTo(advice.x, advice.y, 5)
          continue
        }

        // wait — yield one frame
        yield
      }

      game.log(`[atk] preAttack: spawn window passed without casting`)
    },

    /** Expose for external evaluation (team coordination, etc.) */
    findBestAction(pos: Pos, filter: (m: Monster) => boolean, primary?: Monster, skillFilter?: (s: number) => boolean) {
      return findBestAction(pos, filter, [...game.monsters], game.player.charclass, primary, skillFilter)
    },

    alive,
  }
})
