import { createService } from "diablo:game"
import { getBaseStat } from "../lib/txt.js"
import { Skill } from "diablo:constants"

/** Mana shift lookup: effectiveShift[manashift] / 256 */
const MANA_SHIFT = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]

/** Skill service — centralized casting, mana tracking, delay management.
 *  Absorbs Ryuk's Skill.cast/getManaCost/canCast logic. */
export const SkillService = createService(function (game, _svc) {
  // Mana cost cache: skillId → cost at current level
  const manaCostCache = new Map<number, { cost: number, level: number }>()
  let reservedMana = 0

  /** Calculate mana cost for a skill at the player's current effective level */
  function getManaCost(skillId: number): number {
    const level = game.player.getSkillLevel(skillId, 1) // effective level
    if (level <= 0) return 0

    const cached = manaCostCache.get(skillId)
    if (cached && cached.level === level) return cached.cost

    const baseMana = getBaseStat("skills", skillId, "mana")
    const lvlMana = getBaseStat("skills", skillId, "lvlmana")
    const manaShift = getBaseStat("skills", skillId, "manashift")
    const minMana = getBaseStat("skills", skillId, "minmana")

    const shift = MANA_SHIFT[manaShift] ?? 256
    const raw = (baseMana + lvlMana * (level - 1)) * shift / 256
    const cost = Math.max(raw >> 8, minMana)

    manaCostCache.set(skillId, { cost, level })
    return cost
  }

  /** Check if skill can be cast right now: mana, delay, mode checks */
  function canCast(skillId: number): boolean {
    // Mana check (respecting reservation)
    const cost = getManaCost(skillId)
    const mp = game.player.mp
    if (mp < cost + reservedMana) return false

    // Skill delay check (state 121 = general skill delay)
    if (game.player.getState(121)) return false

    // Town skill guard
    if (game.area < 136) {
      const isTownSkill = getBaseStat("skills", skillId, "InTown") !== 0
      if (!isTownSkill && isTown(game.area)) return false
    }

    return true
  }

  /** Cast a skill at coordinates. Handles select + cast + optional delay. */
  function* cast(skillId: number, x: number, y: number, usePacket = true): Generator<void> {
    if (!canCast(skillId)) return false

    // Select skill on right hand
    game.selectSkill(skillId)
    yield // one frame for skill switch

    if (usePacket) {
      game.castSkillPacket(x, y)
    } else {
      game.castSkill(x, y)
    }

    // Wait for cast delay if skill has one
    const castDelay = getBaseStat("skills", skillId, "delay")
    if (castDelay > 0) {
      // Wait up to delay frames for state 121 to clear
      for (let i = 0; i < Math.min(castDelay, 100); i++) {
        if (!game.player.getState(121)) break
        yield
      }
    }
    return true
  }

  /** Cast at a unit target (for seeking missiles, melee, etc.) */
  function* castAtUnit(skillId: number, unitType: number, unitId: number): Generator<void> {
    if (!canCast(skillId)) return false

    game.selectSkill(skillId)
    yield

    // Right-click on unit via clickMap (type 3 = right click)
    const { unitGetX, unitGetY } = require("diablo:native") as any
    const x = unitGetX(unitType, unitId)
    const y = unitGetY(unitType, unitId)
    game.castSkill(x, y)

    const castDelay = getBaseStat("skills", skillId, "delay")
    if (castDelay > 0) {
      for (let i = 0; i < Math.min(castDelay, 100); i++) {
        if (!game.player.getState(121)) break
        yield
      }
    }
    return true
  }

  /** Reserve mana for emergency skills (e.g. teleport escape) */
  function reserveMana(amount: number) {
    reservedMana = amount
  }

  /** Get available mana after reservation */
  function availableMana(): number {
    return Math.max(0, game.player.mp - reservedMana)
  }

  /** Clear mana cost cache (call on level-up or gear change) */
  function clearCache() {
    manaCostCache.clear()
  }

  /** Get skill range in tiles */
  function getRange(skillId: number): number {
    const range = getBaseStat("skills", skillId, "range")
    if (range === 0) return 1 // melee
    // For ranged skills, compute from missile velocity * range
    const missileId = getBaseStat("skills", skillId, "srvmissile")
    if (missileId > 0) {
      const vel = getBaseStat("missiles", missileId, "Vel")
      const mRange = getBaseStat("missiles", missileId, "Range")
      if (vel > 0 && mRange > 0) return Math.min(vel * mRange / 65536, 40)
    }
    return 20 // default ranged
  }

  return {
    getManaCost,
    canCast,
    cast,
    castAtUnit,
    reserveMana,
    availableMana,
    clearCache,
    getRange,
    get reserved() { return reservedMana },
  }
})

function isTown(area: number): boolean {
  return area === 1 || area === 40 || area === 75 || area === 103 || area === 109
}
