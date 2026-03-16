import { unitGetState, unitGetMode, unitGetStat } from "diablo:native"
import { getBaseStat } from "./txt.js"
import type { Monster, Missile } from "diablo:game"

// Monster states
const STATE_CHILLED = 28
const STATE_FROZEN = 29

/** Check if a monster is chilled */
export function isChilled(unit: Monster): boolean {
  return unitGetState(1, unit.unitId, STATE_CHILLED)
}

/** Check if a monster is frozen */
export function isFrozen(unit: Monster): boolean {
  return unitGetState(1, unit.unitId, STATE_FROZEN)
}

/** Check if monster is in flight (mode 8) — Fetish, Willowisp, Bat */
export function isInFlight(unit: Monster): boolean {
  return unit.mode === 8
}

/** Check if monster is burrowed (mode 14) — Scarab, Maggot */
export function isBurrowed(unit: Monster): boolean {
  return unit.mode === 14
}

/** Check if monster is dead (mode 0 or 12) */
export function isDead(unit: Monster): boolean {
  return unit.mode === 0 || unit.mode === 12
}

// Spec type flags
const SPECTYPE_SUPERUNIQUE = 0x02
const SPECTYPE_CHAMPION = 0x04
const SPECTYPE_UNIQUE = 0x08
const SPECTYPE_MINION = 0x10

/** Check if monster is champion (blue name) */
export function isChampion(unit: Monster): boolean {
  return (unit.specType & SPECTYPE_CHAMPION) !== 0
}

/** Check if monster is unique/boss (gold name) */
export function isUnique(unit: Monster): boolean {
  return (unit.specType & SPECTYPE_UNIQUE) !== 0
}

/** Check if monster is a super unique (named boss) */
export function isSuperUnique(unit: Monster): boolean {
  return (unit.specType & SPECTYPE_SUPERUNIQUE) !== 0
}

/** Check if monster is a minion (follower of unique/champion) */
export function isMinion(unit: Monster): boolean {
  return (unit.specType & SPECTYPE_MINION) !== 0
}

/** Check if monster is any kind of special (champion/unique/superunique) */
export function isSpecial(unit: Monster): boolean {
  return (unit.specType & (SPECTYPE_CHAMPION | SPECTYPE_UNIQUE | SPECTYPE_SUPERUNIQUE)) !== 0
}

/** Get monster's current velocity, accounting for cold slow.
 *  Returns velocity in sub-tiles per frame (matching D2 MonsterData table values). */
export function currentVelocity(unit: Monster): number {
  // Base velocity from monstats
  const run = getBaseStat("monstats", unit.classid, "Run")
  const velocity = run > 0 ? run : getBaseStat("monstats", unit.classid, "Velocity")
  if (velocity <= 0) return 0

  // Apply cold slow malus
  if (isChilled(unit)) {
    // Cold slow reduces velocity. The malus is stored as a negative stat.
    // Effective velocity = velocity * (256 + malus) / 256
    // where malus is typically -128 (50% slow) to -256 (full freeze)
    const coldLength = unitGetStat(1, unit.unitId, 150, 0) // cold length/malus
    if (coldLength < 0) {
      const factor = Math.max(0, 256 + coldLength)
      return Math.floor(velocity * factor / 256)
    }
  }

  if (isFrozen(unit)) return 0

  return velocity
}

// Classids for flight-mode monsters
const FLIGHT_CLASSIDS = new Set([110, 111, 112, 113, 144, 608])

// Classids for burrowing monsters
const BURROW_CLASSIDS = new Set([68, 69, 70, 71, 72, 258, 259, 260, 261, 262, 263])

/** Check if monster is attackable (not in an invulnerable state) */
export function isAttackable(unit: Monster): boolean {
  if (isDead(unit)) return false
  // In-flight Fetish/Bat/Willowisp
  if (FLIGHT_CLASSIDS.has(unit.classid) && isInFlight(unit)) return false
  // Burrowed Scarab/Maggot
  if (BURROW_CLASSIDS.has(unit.classid) && isBurrowed(unit)) return false
  // neverCount stat = immune to attacks
  if (unitGetStat(1, unit.unitId, 172, 0) === 2) return false
  // Level 0 = not spawned yet (catapults etc)
  if (unitGetStat(1, unit.unitId, 12, 0) < 1) return false
  return true
}

/** Check if a missile will hit at position (x,y) based on AoE overlap */
export function missileHits(missile: Missile, x: number, y: number, radius = 2): boolean {
  const dx = missile.x - x
  const dy = missile.y - y
  return dx * dx + dy * dy <= radius * radius
}

// Shaman/resurrector classids (Fallen Shaman, Returned Shaman, etc.)
const SHAMAN_CLASSIDS = new Set([
  118, 119, 120, 121, 122, // Fallen Shamans
  212, 213, 214, 215, 216, // Greater Mummy (act 2 resurrector)
])

// Fallen classids (deprioritized when shaman nearby)
const FALLEN_CLASSIDS = new Set([
  113, 114, 115, 116, 117, // Fallen types
])

/** Check if monster is a shaman/resurrector */
export function isShaman(unit: Monster): boolean {
  return SHAMAN_CLASSIDS.has(unit.classid)
}

/** Check if monster is a Fallen (deprioritized when shaman alive) */
export function isFallen(unit: Monster): boolean {
  return FALLEN_CLASSIDS.has(unit.classid)
}
