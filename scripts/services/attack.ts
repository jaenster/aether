import { createService, type Game, type Monster, MonsterClassId } from "diablo:game"
import { Config } from "../config.js"
import { Movement } from "./movement.js"
import { findBestAction, rankActions, skillRange, splashRadius, unitResist, staticFieldEffective, preAttackAdvice, isNova, skillName, skillProjectileType } from "../lib/game-data.js"
import type { AttackOptions, Pos, CombatSnapshot, MonsterSnapshot, SpawnEvent } from "../lib/attack-types.js"
import { getUnitHP, getUnitMaxHP, getUnitMP, getDifficulty } from "diablo:native"
import { isAttackable, isSpecial, isShaman, isFallen } from "../lib/unit-extensions.js"
import { findBestPack, type PackInfo } from "../lib/pack-detection.js"
import { getLatestReport } from "../threads/threat-monitor.js"
import { Area } from "diablo:constants"

function alive(m: Monster): boolean {
  return m.isAttackable
}

let combatTick = 0

// Per-GID attack count tracking (from Ryuk Attack.ts)
const attackCounts = new Map<number, number>()
const ignoredGids = new Set<number>()
const ATTACK_CAP = 15   // skip non-unique after this many casts
const IGNORE_CAP = 50   // after this many failed casts, skip entirely
const THRONE_AREA = Area.ThroneofDestruction // 131, exempt from attack cap

/** Reset attack tracking (call on area change or new clear) */
function resetAttackTracking() {
  attackCounts.clear()
  ignoredGids.clear()
}

export const Attack = createService((game: Game, services) => {
  const cfg = services.get(Config)
  const move = services.get(Movement)

  function casterPos(): Pos {
    return { x: game.player.x, y: game.player.y }
  }

  /** Default filter: alive, within range, and has line of sight from player */
  function inRange(range: number): (m: Monster) => boolean {
    return (m: Monster) => {
      if (!alive(m) || m.distance >= range) return false
      // Skip LoS check for very close monsters (melee range) — always reachable
      if (m.distance < 5) return true
      return game.hasLineOfSight(game.player.x, game.player.y, m.x, m.y)
    }
  }

  /** Compose inRange with spatial filter from options */
  function makeFilter(range: number, opts?: AttackOptions): (m: Monster) => boolean {
    const base = inRange(range)
    if (!opts?.spatialFilter) return base
    const spatial = opts.spatialFilter
    return (m: Monster) => base(m) && spatial(m)
  }

  function* preSelect(skill: number) {
    game.selectSkill(skill)
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

      game.log(`[atk] debuff ${skillName(d.skillId)} on ${targets.length} targets`)
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
      game.log(`[combat] tick=${snap.tick} hp=${snap.casterHp} mp=${snap.casterMp} mons=${snap.monsters.length} chosen=${snap.chosen ? skillName(snap.chosen.skillId) : 'none'} dps=${(snap.chosen?.dpsPerFrame ?? 0) | 0}`)
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
          game.log(`[atk] cast=${casts} hp=${target.hp}/${target.hpmax} ${skillName(action.skillId)} hit=${action.monstersHit} dps=${action.dpsPerFrame|0} aim=${action.targetPos.x},${action.targetPos.y}${action.needsReposition ? ' REPO' : ''}`)
        }

        // Stale detection — immune monster or Static Field at floor
        // Use higher threshold for bosses
        const isBoss = target.isSuperUnique || target.classid === MonsterClassId.Diablo || target.classid === MonsterClassId.BaalClone
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
            // Try excluding the current skill — maybe another element works
            if (action) {
              const blockedSkill = action.skillId
              const origFilter = opts?.skillFilter
              const noBlocked = (sk: number) => sk !== blockedSkill && (!origFilter || origFilter(sk))
              const retry = findBestAction(casterPos(), filter, allMonsters, game.player.charclass, target, noBlocked, opts?.groupModifier)
              if (retry && retry.dpsPerFrame > 0) {
                game.log(`[atk] switching from ${skillName(blockedSkill)} to ${skillName(retry.skillId)} (immune)`)
                opts = { ...opts, skillFilter: noBlocked }
                staleCount = 0
                continue
              }
            }
            game.log(`[atk] hp stuck at ${target.hp} — immune, giving up`)
            return
          }
        } else {
          staleCount = 0
          lastHp = target.hp
        }

        if (action.needsReposition) {
          game.log(`[atk] repo ${game.player.x},${game.player.y} → ${action.casterPos.x},${action.casterPos.y}`)
          yield* move.teleportTo(action.casterPos.x, action.casterPos.y, 5)
          currentSkill = -1 // teleportTo changed right skill to teleport
        }

        if (isNova(action.skillId)) {
          const novaR = splashRadius(action.skillId) || 5
          if (target.distance > novaR) {
            game.log(`[atk] closing to nova range ${novaR} (dist=${target.distance|0}) → ${target.x},${target.y}`)
            yield* move.moveNear(target.x, target.y, novaR)
            currentSkill = -1 // moveNear may teleport
          }
        } else if (target.distance > skillRange(action.skillId)) {
          game.log(`[atk] closing to range ${skillRange(action.skillId)} (dist=${target.distance|0}) → ${target.x},${target.y}`)
          yield* move.moveNear(target.x, target.y, skillRange(action.skillId))
          currentSkill = -1 // moveNear may teleport
        }

        const projType = skillProjectileType(action.skillId)
        if (projType !== 'ground_aoe' && !game.hasLineOfSight(game.player.x, game.player.y, action.targetPos.x, action.targetPos.y)) {
          // No LoS after positioning — teleport closer to target and retry
          yield* move.moveNear(target.x, target.y, 3)
          currentSkill = -1
          continue
        }

        if (action.skillId !== currentSkill) {
          yield* preSelect(action.skillId)
          currentSkill = action.skillId
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

      game.log(`[atk] clear: range=${killRange} maxCasts=${maxCasts} monsters=${[...game.monsters].length}`)

      let repoFails = 0 // track consecutive failed repositions
      for (let casts = 0; casts < maxCasts; casts++) {
        if (opts?.shouldContinue && !opts.shouldContinue()) return

        const allMonsters = [...game.monsters]
        const filtered = allMonsters.filter(filter)
        if (filtered.length === 0) {
          game.log(`[atk] area clear after ${casts} casts (${allMonsters.length} total mons, 0 matched filter)`)
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
          game.log(`[atk] no action found (${filtered.length} mons, cast ${casts}), area clear`)
          return
        }

        if (casts === 0 && primary) {
          const fr = unitResist(primary, "Fire"), lr = unitResist(primary, "Lightning"), cr = unitResist(primary, "Cold"), pr = unitResist(primary, "Physical")
          game.log(`[atk] target classid=${primary.classid} res F=${fr} L=${lr} C=${cr} P=${pr} → ${skillName(action.skillId)} dps=${action.dpsPerFrame|0}`)
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

        // Skip REPO if previous repositions failed (position didn't change)
        const shouldRepo = action.needsReposition && repoFails < 2

        if (casts % 10 === 0 || shouldRepo) {
          game.log(`[atk] clearing: hit=${action.monstersHit} ${skillName(action.skillId)} mons=${filtered.length} aim=${action.targetPos.x},${action.targetPos.y} me=${game.player.x},${game.player.y}${shouldRepo ? ` REPO→${action.casterPos.x},${action.casterPos.y}` : ''}`)
        }

        if (shouldRepo) {
          game.log(`[atk] repo ${game.player.x},${game.player.y} → ${action.casterPos.x},${action.casterPos.y}`)
          const prevX = game.player.x, prevY = game.player.y
          yield* move.teleportTo(action.casterPos.x, action.casterPos.y, 5)
          currentSkill = -1 // teleportTo changed right skill
          const moved = Math.abs(game.player.x - prevX) + Math.abs(game.player.y - prevY)
          if (moved < 3) {
            repoFails++
          } else {
            repoFails = 0
          }
        } else if (!action.needsReposition) {
          repoFails = 0
        }

        if (isNova(action.skillId)) {
          const novaR = splashRadius(action.skillId) || 5
          const d = Math.sqrt(
            (game.player.x - action.targetPos.x) ** 2 +
            (game.player.y - action.targetPos.y) ** 2
          )
          if (d > novaR) {
            game.log(`[atk] closing to nova range ${novaR} (dist=${d|0}) → ${action.targetPos.x},${action.targetPos.y}`)
            yield* move.moveNear(action.targetPos.x, action.targetPos.y, novaR)
            currentSkill = -1
          }
        } else {
          const d = Math.sqrt(
            (game.player.x - action.targetPos.x) ** 2 +
            (game.player.y - action.targetPos.y) ** 2
          )
          if (d > skillRange(action.skillId)) {
            game.log(`[atk] closing to range ${skillRange(action.skillId)} (dist=${d|0}) → ${action.targetPos.x},${action.targetPos.y}`)
            yield* move.moveNear(action.targetPos.x, action.targetPos.y, skillRange(action.skillId))
            currentSkill = -1
          }
        }

        if (action.skillId !== currentSkill) {
          yield* preSelect(action.skillId)
          currentSkill = action.skillId
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
          game.log(`[atk] preAttack firing ${skillName(advice.skill)} at ${advice.x},${advice.y} f=${f}`)
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

    // ── Ryuk-ported additions ──────────────────────────────────────

    /** Reset per-monster attack counters (call on new area/clear) */
    resetTracking: resetAttackTracking,

    /** Check if a monster should be skipped due to attack count cap.
     *  Non-unique monsters get skipped after 15 casts (except Throne of Baal).
     *  Any monster is ignored entirely after 50 failed casts. */
    shouldSkip(m: Monster): boolean {
      if (ignoredGids.has(m.unitId)) return true
      const count = attackCounts.get(m.unitId) ?? 0
      if (count >= IGNORE_CAP) {
        ignoredGids.add(m.unitId)
        return true
      }
      // Non-special monsters get capped (except in Throne of Baal)
      if (count >= ATTACK_CAP && !isSpecial(m) && game.area !== THRONE_AREA) {
        return true
      }
      return false
    },

    /** Track a cast against a monster GID */
    trackCast(gid: number) {
      attackCounts.set(gid, (attackCounts.get(gid) ?? 0) + 1)
    },

    /** Evaluate if we should retreat based on pressure.
     *  From Ryuk: pressure = attackable + missiles in 10 tiles.
     *  Retreat when pressure > floor(4 * HP%) + 1 */
    shouldRetreat(): boolean {
      const report = getLatestReport()
      if (!report) return false
      if (report.action === 'retreat' || report.action === 'chicken') return true

      const hpPct = game.player.hp / game.player.maxHp
      const maxPressure = Math.floor(4 * hpPct) + 1

      // Count nearby threats
      let pressure = 0
      for (const m of game.monsters) {
        if (!alive(m) || m.distance > 10) continue
        pressure++
      }
      // Count nearby missiles
      for (const missile of game.missiles) {
        if (missile.distance <= 10) pressure++
      }

      return pressure > maxPressure
    },

    /** Find best pack to attack using clustering + threat scoring.
     *  Shamans get 1.6x kill range, Fallens deprioritized. */
    findPack(killRange = 25): PackInfo | null {
      return findBestPack(game.monsters, game.player.x, game.player.y, killRange)
    },

    /**
     * Clear with pressure-based retreat integration.
     * Monitors threat each cast — retreats if overwhelmed, advances if safe.
     * Wraps the existing clear() with tactical retreat/advance logic.
     */
    *clearWithPressure(opts?: AttackOptions) {
      resetAttackTracking()
      const maxCasts = opts?.maxCasts ?? cfg.maxAttacks
      const killRange = opts?.killRange ?? cfg.killRange

      // Add attack tracking to spatial filter
      const origFilter = opts?.spatialFilter
      const trackingFilter = (m: Monster) => {
        if (this.shouldSkip(m)) return false
        return origFilter ? origFilter(m) : true
      }

      for (let cast = 0; cast < maxCasts; cast++) {
        // Check pressure — retreat if overwhelmed
        if (this.shouldRetreat()) {
          game.log(`[atk] pressure retreat!`)
          // Backtrack: move away from nearest monster
          const nearest = game.monsters.find(m => alive(m) && m.distance < 15)
          if (nearest) {
            const dx = game.player.x - nearest.x
            const dy = game.player.y - nearest.y
            const d = Math.max(1, Math.sqrt(dx * dx + dy * dy))
            const retreatX = Math.round(game.player.x + dx / d * 15)
            const retreatY = Math.round(game.player.y + dy / d * 15)
            yield* move.teleportTo(retreatX, retreatY, 5)
          }
          yield // one frame cooldown
          continue
        }

        // Find best target pack
        const pack = this.findPack(killRange)
        if (!pack || pack.members.length === 0) {
          game.log(`[atk] no packs within range`)
          return
        }

        // Use existing clear logic with pack targeting
        const clearOpts: AttackOptions = {
          ...opts,
          spatialFilter: trackingFilter,
          maxCasts: Math.min(5, maxCasts - cast), // mini-bursts
          killRange,
          focusTarget: (monsters) => {
            // Prioritize shamans, then specials, then closest in pack
            const shamans = pack.members.filter(m => alive(m) && isShaman(m))
            if (shamans.length > 0) return shamans[0]
            const specials = pack.members.filter(m => alive(m) && isSpecial(m))
            if (specials.length > 0) return specials[0]
            return pack.members.find(m => alive(m))
          },
        }

        yield* this.clear(clearOpts)
        cast += (clearOpts.maxCasts ?? 5) // account for the burst we just did
      }
    },
  }
})
