import { type Monster, MonsterMode, MonsterSpecType } from "diablo:game"
import { getUnitStat, getDifficulty, getUnitHP, getUnitMaxHP, getUnitMP, getUnitMaxMP } from "diablo:native"
import { Stat } from "diablo:constants"
import { getBaseStat } from "./txt.js"
import { monsterEffort, monsterMaxHP } from "./game-data.js"
import { isReviver } from "./monster-data.js"

// ── Element mapping ──────────────────────────────────────────────────
const elTypeNames = ["", "Fire", "Lightning", "Magic", "Cold", "Poison"]

// ── Player stat tables ───────────────────────────────────────────────
const playerResistStat: Record<string, number> = {
  Physical: Stat.DamageResist, Magic: Stat.MagicResist,
  Fire: Stat.FireResist, Lightning: Stat.LightResist,
  Cold: Stat.ColdResist, Poison: Stat.PoisonResist,
}
const playerMaxResistStat: Record<string, number> = {
  Magic: Stat.MaxMagicResist, Fire: Stat.MaxFireResist,
  Lightning: Stat.MaxLightResist, Cold: Stat.MaxColdResist, Poison: Stat.MaxPoisonResist,
}
const playerAbsorbPctStat: Record<string, number> = {
  Fire: Stat.AbsorbFirePercent, Lightning: Stat.AbsorbLightPercent,
  Cold: Stat.AbsorbColdPercent, Magic: Stat.AbsorbMagicPercent,
}
const playerAbsorbFlatStat: Record<string, number> = {
  Fire: Stat.AbsorbFire, Lightning: Stat.AbsorbLight,
  Cold: Stat.AbsorbCold, Magic: Stat.AbsorbMagic,
}

// ── Enchant IDs ──────────────────────────────────────────────────────
const ENCH = {
  EXTRA_STRONG: 5, EXTRA_FAST: 6, CURSED: 8,
  LIGHTNING: 17, COLD: 18, FIRE: 19,
  MULTISHOT: 25, SPECTRAL: 28,
  CONVICTION: 30, FANATICISM: 31,
  HOLY_FIRE: 33, HOLY_FREEZE: 34, HOLY_SHOCK: 35,
  MANA_BURN: 37,
} as const

// ── Known dangerous classids ─────────────────────────────────────────
// Stygian Dolls — explode on death for massive damage
const deathExplosion = new Set([145, 216, 400, 657, 660, 690])
// Gloams — instant lightning (118=Gloam, 120=BurningSoul, 121=BlackSoul + hell variants)
const gloamClassids = new Set([118, 120, 121, 639, 640, 641])
// Oblivion Knights — IM / Lower Resist / Bone Spirit (312=base, 701-702=Chaos variants)
// NOTE: 310=DoomKnight, 311=AbyssKnight are melee, NOT Oblivion Knights
const oblKnightClassids = new Set([312, 701, 702])
// Vipers — bugged poison cloud (73=Tomb, 74=Claw, 76=Pit + variants)
const viperClassids = new Set([73, 74, 76, 594, 595, 597])
// Souls / Burning Souls (gloam subtype, hit harder)
const soulClassids = new Set([120, 121, 640, 641])

// Known extra elemental damage for monsters whose skill damage can't be read from txt
// Per-difficulty estimates: [Normal, Nightmare, Hell]
const knownExtraDamage: Record<number, { element: string, avgDmg: [number, number, number] }[]> = {
  // Diablo (cls=243) — fire nova, lightning hose, cold touch
  243: [
    { element: "Fire", avgDmg: [30, 100, 200] },
    { element: "Lightning", avgDmg: [40, 150, 300] },
    { element: "Cold", avgDmg: [20, 75, 150] },
  ],
  // Baal (cls=544)
  544: [
    { element: "Cold", avgDmg: [35, 120, 250] },
    { element: "Fire", avgDmg: [30, 100, 200] },
    { element: "Lightning", avgDmg: [30, 100, 200] },
  ],
  // Oblivion Knights (312=base, 701-702=Chaos) — Bone Spirit
  312: [{ element: "Magic", avgDmg: [0, 80, 200] }],
  701: [{ element: "Magic", avgDmg: [0, 80, 200] }],
  702: [{ element: "Magic", avgDmg: [0, 80, 200] }],
  // Gloams/Souls — instant lightning
  118: [{ element: "Lightning", avgDmg: [30, 120, 250] }],
  120: [{ element: "Lightning", avgDmg: [40, 160, 350] }],
  121: [{ element: "Lightning", avgDmg: [45, 175, 375] }],
  639: [{ element: "Lightning", avgDmg: [30, 120, 250] }],
  640: [{ element: "Lightning", avgDmg: [45, 175, 375] }],
  641: [{ element: "Lightning", avgDmg: [50, 190, 400] }],
}

// ── State IDs ────────────────────────────────────────────────────────
const STATE_FROZEN = 1
const STATE_CHILLED = 28
const STATE_DECREPIFY = 60
const STATE_LOWERRESIST = 61
const STATE_AMPDAM = 10
const STATE_IRONMAIDEN = 56

// ═══════════════════════════════════════════════════════════════════════
// STATIC PROFILE — per classid+difficulty, cached
// ═══════════════════════════════════════════════════════════════════════

export interface ElementDamage {
  element: string
  rawDmg: number
  effectiveDmg: number
}

export interface MonsterProfile {
  classid: number
  isRanged: boolean
  isMelee: boolean
  baseDamage: ElementDamage[]
  /** ColdEffect: 0-100, how susceptible to cold slow (0=immune, 100=full effect) */
  coldSusceptibility: number
  innateFlags: string[]
  /** Base attack speed tier */
  baseAps: number
  /** Does this monster revive others? */
  isReviver: boolean
  /** Average pack size from txt */
  avgPackSize: number
  /** Base AC (defense) */
  defense: number
  /** Base HP for current difficulty */
  baseHp: number
}

const profileCache = new Map<number, MonsterProfile>()
let profileCacheDiff = -1

function getProfile(classid: number): MonsterProfile {
  const diff = getDifficulty()
  if (diff !== profileCacheDiff) {
    profileCache.clear()
    profileCacheDiff = diff
  }
  const cached = profileCache.get(classid)
  if (cached) return cached

  const baseDamage: ElementDamage[] = []

  // A1 physical
  const a1Min = diffField("A1MinD", classid, diff)
  const a1Max = diffField("A1MaxD", classid, diff)
  if (a1Min > 0 || a1Max > 0) {
    baseDamage.push({ element: "Physical", rawDmg: (a1Min + a1Max) / 2, effectiveDmg: 0 })
  }

  // A2 physical (take max of A1/A2, they alternate)
  const a2Min = diffField("A2MinD", classid, diff)
  const a2Max = diffField("A2MaxD", classid, diff)
  if (a2Min > 0 || a2Max > 0) {
    const a2Avg = (a2Min + a2Max) / 2
    const phys = baseDamage.find(e => e.element === "Physical")
    if (phys) phys.rawDmg = Math.max(phys.rawDmg, a2Avg)
    else baseDamage.push({ element: "Physical", rawDmg: a2Avg, effectiveDmg: 0 })
  }

  // S1 damage — element comes from El*Mode=4 (S1 attack), NOT from Skill1
  const s1Min = diffField("S1MinD", classid, diff)
  const s1Max = diffField("S1MaxD", classid, diff)
  if (s1Min > 0 || s1Max > 0) {
    let s1Element = "Physical"
    for (let i = 1; i <= 3; i++) {
      const mode = getBaseStat("monstats", classid, `El${i}Mode`)
      if (mode === 4) {
        const et = getBaseStat("monstats", classid, `El${i}Type`)
        if (et > 0 && et < elTypeNames.length) s1Element = elTypeNames[et]!
        break
      }
    }
    addOrMergeDamage(baseDamage, s1Element, (s1Min + s1Max) / 2)
  }

  // Elemental overlays on attacks (El1/El2/El3)
  for (let i = 1; i <= 3; i++) {
    const elType = getBaseStat("monstats", classid, `El${i}Type`)
    if (elType <= 0 || elType >= elTypeNames.length) continue
    const pct = diffField3(`El${i}Pct`, classid, diff)
    if (pct <= 0) continue
    const elMin = diffField(`El${i}MinD`, classid, diff)
    const elMax = diffField(`El${i}MaxD`, classid, diff)
    if (elMin <= 0 && elMax <= 0) continue
    addOrMergeDamage(baseDamage, elTypeNames[elType]!, (elMin + elMax) / 2)
  }

  // Monster skills (Skill1-8) — look up missile for elemental damage
  for (let si = 1; si <= 8; si++) {
    const skillId = getBaseStat("monstats", classid, `Skill${si}`)
    if (skillId <= 0) continue

    // Find the missile this skill fires (srvmissilea is used by most monster skills)
    let misId = getBaseStat("skills", skillId, "srvmissile")
    if (misId <= 0) misId = getBaseStat("skills", skillId, "srvmissilea")
    if (misId <= 0 || misId > 567) continue

    const eType = getBaseStat("missiles", misId, "EType")
    if (eType <= 0 || eType >= elTypeNames.length) continue

    const eMin = getBaseStat("missiles", misId, "EMin")
    const eMax = getBaseStat("missiles", misId, "EMax")
    if (eMin <= 0 && eMax <= 0) continue

    // Missile EMin/EMax are the actual base damage values from missiles.txt
    // Use as-is — no arbitrary scaling
    const missileDmg = (eMin + eMax) / 2

    // Monsters alternate between melee and skills; weight skill damage
    const skillWeight = baseDamage.length > 0 ? 0.5 : 1.0
    addOrMergeDamage(baseDamage, elTypeNames[eType]!, missileDmg * skillWeight)
  }

  // Known extra damage overrides for monsters with complex skill-based attacks
  const extras = knownExtraDamage[classid]
  if (extras) {
    for (const { element, avgDmg } of extras) {
      const dmg = avgDmg[diff] ?? avgDmg[0]!
      if (dmg > 0) addOrMergeDamage(baseDamage, element, dmg)
    }
  }

  // Ranged detection
  const missA1 = getBaseStat("monstats", classid, "MissA1")
  const missA2 = getBaseStat("monstats", classid, "MissA2")
  const missS1 = getBaseStat("monstats", classid, "MissS1")
  const isRanged = missA1 > 0 || missA2 > 0 || missS1 > 0

  // ColdEffect
  const coldSusceptibility = diffField3("ColdEffect", classid, diff)

  // Innate danger flags
  const innateFlags: string[] = []
  if (deathExplosion.has(classid)) innateFlags.push("corpse_explosion")
  if (gloamClassids.has(classid)) innateFlags.push("gloam")
  if (oblKnightClassids.has(classid)) innateFlags.push("oblivion_knight")
  if (viperClassids.has(classid)) innateFlags.push("viper")

  // Attack speed from aidel (AI delay between actions, in frames)
  // Lower aidel = faster attacks. Convert to APS: 25 fps / aidel
  const aidel = diffField3("aidel", classid, diff)
  let baseAps: number
  if (gloamClassids.has(classid)) baseAps = 2.5
  else if (soulClassids.has(classid)) baseAps = 3.0
  else if (aidel > 0) baseAps = Math.min(4.0, 25 / aidel)
  else if (isRanged) baseAps = 1.8
  else baseAps = 1.5

  // Pack size
  const minGrp = getBaseStat("monstats", classid, "MinGrp")
  const maxGrp = getBaseStat("monstats", classid, "MaxGrp")
  const partyMin = getBaseStat("monstats", classid, "PartyMin")
  const partyMax = getBaseStat("monstats", classid, "PartyMax")
  const avgPackSize = ((minGrp + maxGrp) / 2) + ((partyMin + partyMax) / 2)

  // Defense
  const defense = diffField("AC", classid, diff)

  // Base HP from txt
  const baseHp = diffField("maxHP", classid, diff)

  const profile: MonsterProfile = {
    classid, isRanged, isMelee: !!getBaseStat("monstats", classid, "isMelee"),
    baseDamage, coldSusceptibility, innateFlags, baseAps,
    isReviver: isReviver(classid), avgPackSize, defense, baseHp,
  }
  profileCache.set(classid, profile)
  return profile
}

// ── Txt field helpers ────────────────────────────────────────────────
function diffField(base: string, classid: number, diff: number): number {
  const suffix = ["", "(N)", "(H)"][diff]!
  return getBaseStat("monstats", classid, base + suffix)
}
function diffField3(base: string, classid: number, diff: number): number {
  const suffix = ["", "(N)", "(H)"][diff]!
  return getBaseStat("monstats", classid, base + suffix)
}

function addOrMergeDamage(arr: ElementDamage[], element: string, dmg: number) {
  const existing = arr.find(e => e.element === element)
  if (existing) existing.rawDmg += dmg
  else arr.push({ element, rawDmg: dmg, effectiveDmg: 0 })
}

// ═══════════════════════════════════════════════════════════════════════
// PLAYER MITIGATION — reads live player stats
// ═══════════════════════════════════════════════════════════════════════

function playerResist(element: string): number {
  const stat = playerResistStat[element]
  if (stat === undefined) return 0
  const resist = getUnitStat(stat, 0)
  const maxStat = playerMaxResistStat[element]
  const cap = maxStat !== undefined
    ? Math.max(75, 75 + getUnitStat(maxStat, 0))
    : (element === "Physical" ? 50 : 75)
  return Math.min(resist, cap)
}

/**
 * D2 damage reduction pipeline (correct order):
 * 1. Resist (clamped -100..cap, reduced by conviction)
 * 2. Absorb % (applied to POST-resist damage, then heals same amount → 2x reduction)
 * 3. Absorb flat (reduces damage, heals same amount → 2x reduction)
 * 4. Flat DR (NormalDamageReduction for phys, MagicDamageReduction for magic)
 */
function mitigateDamage(element: string, rawDmg: number, convictionPenalty: number): number {
  if (rawDmg <= 0) return 0

  // 1. Resist
  let resist = playerResist(element)
  if (convictionPenalty > 0 && (element === "Fire" || element === "Lightning" || element === "Cold")) {
    resist -= convictionPenalty
  }
  resist = Math.max(-100, Math.min(resist, element === "Physical" ? 50 : 95))
  let dmg = rawDmg * (100 - resist) / 100
  if (dmg <= 0) return 0

  // 2. Absorb % (post-resist, heals = 2x effective reduction)
  const pctStat = playerAbsorbPctStat[element]
  if (pctStat !== undefined) {
    const pct = getUnitStat(pctStat, 0)
    if (pct > 0) dmg -= (dmg * pct / 100) * 2
  }

  // 3. Absorb flat (heals = 2x effective reduction)
  const flatStat = playerAbsorbFlatStat[element]
  if (flatStat !== undefined) {
    const flat = getUnitStat(flatStat, 0)
    if (flat > 0) dmg -= flat * 2
  }

  // 4. Flat DR
  if (element === "Physical") {
    dmg -= getUnitStat(Stat.NormalDamageReduction, 0)
  } else if (element === "Magic") {
    dmg -= getUnitStat(Stat.MagicDamageReduction, 0)
  }

  return Math.max(0, dmg)
}

// ═══════════════════════════════════════════════════════════════════════
// LIVE THREAT — per monster instance
// ═══════════════════════════════════════════════════════════════════════

export type ThreatLevel = "trivial" | "low" | "medium" | "high" | "extreme"

export interface ThreatAssessment {
  elements: ElementDamage[]
  totalPerHit: number
  effectiveDps: number
  /** Distance-adjusted: melee far away = lower immediate threat */
  positionedDps: number
  castsToKill: number
  bestSkill: number
  /** DPS if we apply chill/freeze CC */
  ccReducedDps: number
  /** Is this monster already CCed? */
  currentlyCCed: boolean
  /** Is frozen (zero output) */
  isFrozen: boolean
  /** Total damage taken over the fight duration */
  totalFightDamage: number
  threat: ThreatLevel
  dangers: string[]
  counterplay: string[]
  /** Kill priority: how much DPS we remove per cast spent killing this target */
  dpsPerCast: number
  /** Spectype flags for display */
  spectype: number
  /** Does player have Iron Maiden on them (dangerous for melee chars)? */
  playerHasIM: boolean
  /** Does player have Amp Damage on them? */
  playerHasAmpDmg: boolean
  /** Does player have Lower Resist? */
  playerHasLR: boolean
}

export function assessThreat(mon: Monster): ThreatAssessment {
  const diff = getDifficulty()
  const profile = getProfile(mon.classid)
  let enchants: number[]
  try { enchants = mon.enchants } catch { enchants = [] }
  const enchantSet = new Set(enchants)

  const dangers: string[] = []
  const counterplay: string[] = []

  // ── Player debuffs (from THIS monster or nearby) ───────────────────
  // These are on the PLAYER, checked once, but relevant for threat weighting
  const playerHasIM = mon.getState(STATE_IRONMAIDEN)
  const playerHasAmpDmg = mon.getState(STATE_AMPDAM)
  const playerHasLR = mon.getState(STATE_LOWERRESIST)

  // ── Enchant modifiers ──────────────────────────────────────────────
  let physMultiplier = 1.0
  let attackSpeedMultiplier = 1.0
  let convictionPenalty = 0
  const extraElements: ElementDamage[] = []

  if (enchantSet.has(ENCH.EXTRA_STRONG)) {
    physMultiplier *= 3
    dangers.push("Extra Strong (3x phys)")
  }
  if (enchantSet.has(ENCH.EXTRA_FAST)) {
    attackSpeedMultiplier *= 1.5
    dangers.push("Extra Fast")
  }
  if (enchantSet.has(ENCH.CURSED)) {
    physMultiplier *= 2
    dangers.push("Cursed (Amp Damage)")
  }
  if (enchantSet.has(ENCH.FANATICISM)) {
    physMultiplier *= 1.5
    attackSpeedMultiplier *= 1.3
    dangers.push("Fanaticism")
  }
  if (enchantSet.has(ENCH.CONVICTION)) {
    convictionPenalty = [30, 50, 85][diff] ?? 85
    dangers.push(`Conviction (-${convictionPenalty} res)`)
    counterplay.push("Stack resists above conviction penalty")
  }
  if (enchantSet.has(ENCH.LIGHTNING)) {
    const isMultishot = enchantSet.has(ENCH.MULTISHOT)
    const boltCount = isMultishot ? 24 : 8
    const boltDmg = Math.max(50, (mon.hpmax * 0.003) * boltCount)
    extraElements.push({ element: "Lightning", rawDmg: boltDmg, effectiveDmg: 0 })
    if (isMultishot) {
      dangers.push("MSLE")
      counterplay.push("Do not melee — bolts can one-shot")
    } else {
      dangers.push("Lightning Enchanted")
    }
  }
  if (enchantSet.has(ENCH.HOLY_FIRE)) {
    extraElements.push({ element: "Fire", rawDmg: 40 + diff * 100, effectiveDmg: 0 })
    dangers.push("Holy Fire")
  }
  if (enchantSet.has(ENCH.HOLY_SHOCK)) {
    extraElements.push({ element: "Lightning", rawDmg: 40 + diff * 150, effectiveDmg: 0 })
    dangers.push("Holy Shock")
  }
  if (enchantSet.has(ENCH.HOLY_FREEZE)) {
    extraElements.push({ element: "Cold", rawDmg: 30 + diff * 60, effectiveDmg: 0 })
    dangers.push("Holy Freeze (slows)")
  }
  if (enchantSet.has(ENCH.MANA_BURN)) {
    dangers.push("Mana Burn")
    counterplay.push("Avoid melee, protect mana")
  }
  if (enchantSet.has(ENCH.SPECTRAL)) dangers.push("Spectral Hit")
  if (enchantSet.has(ENCH.FIRE)) dangers.push("Fire Enchanted (death explosion)")
  if (enchantSet.has(ENCH.COLD)) dangers.push("Cold Enchanted (death nova)")

  // ── Innate classid dangers ─────────────────────────────────────────
  for (const flag of profile.innateFlags) {
    switch (flag) {
      case "corpse_explosion":
        dangers.push("Corpse Explosion on death")
        counterplay.push("Kill from distance")
        break
      case "gloam":
        dangers.push("Gloam (instant lightning)")
        counterplay.push("Max light res, teleport on top")
        break
      case "oblivion_knight":
        dangers.push("Oblivion Knight (Amp/Decrep/LR curses)")
        counterplay.push("Kill fast, avoid melee when Amped")
        break
      case "viper":
        dangers.push("Viper (bugged cloud)")
        counterplay.push("Kill from range, avoid cloud")
        break
    }
  }

  if (profile.isReviver) {
    dangers.push("Reviver — kill first or corpses respawn")
    counterplay.push("Priority target: kill before clearing pack")
  }

  // ── Build damage per hit ───────────────────────────────────────────
  const elements: ElementDamage[] = profile.baseDamage.map(e => ({ ...e, effectiveDmg: 0 }))

  for (const e of elements) {
    if (e.element === "Physical") e.rawDmg *= physMultiplier
  }
  for (const extra of extraElements) {
    addOrMergeDamage(elements, extra.element, extra.rawDmg)
  }

  // Apply player mitigation
  let totalPerHit = 0
  for (const e of elements) {
    e.effectiveDmg = mitigateDamage(e.element, e.rawDmg, convictionPenalty)
    totalPerHit += e.effectiveDmg
  }

  // ── Attack speed ───────────────────────────────────────────────────
  const attacksPerSecond = profile.baseAps * attackSpeedMultiplier

  const effectiveDps = totalPerHit * attacksPerSecond

  // ── Position-adjusted DPS ──────────────────────────────────────────
  let positionedDps = effectiveDps
  if (!profile.isRanged && mon.distance > 5) {
    // Melee closing model: threat ramps up as they approach
    // At distance 5 = 100%, at 15 = 66%, at 25 = 33%, at 35+ = ~10%
    const closingFactor = Math.max(0.1, 1 - (mon.distance - 5) / 30)
    positionedDps = effectiveDps * closingFactor
  }

  // ── Current CC state ───────────────────────────────────────────────
  const isFrozen = mon.getState(STATE_FROZEN)
  const isChilled = mon.getState(STATE_CHILLED)
  const isDecrepified = mon.getState(STATE_DECREPIFY)
  const currentlyCCed = isFrozen || isChilled || isDecrepified

  let currentDps = positionedDps
  if (isFrozen) {
    currentDps = 0
  } else if (isChilled) {
    const slowFactor = profile.coldSusceptibility / 100
    currentDps = positionedDps * (1 - slowFactor * 0.5)
  } else if (isDecrepified) {
    currentDps = positionedDps * 0.5
  }

  // ── CC potential ───────────────────────────────────────────────────
  let ccReducedDps = effectiveDps
  if (profile.coldSusceptibility > 0) {
    ccReducedDps = effectiveDps * (1 - 0.8 * (profile.coldSusceptibility / 100))
  }

  // ── Effort to kill ─────────────────────────────────────────────────
  // monsterEffort uses txt HP; scale by live HP / txt HP ratio for accuracy
  const area = mon.area
  const effort = monsterEffort(mon.classid, area)
  const txtHp = monsterMaxHP(mon.classid, area)
  const liveHp = mon.hpmax
  let castsToKill = Math.max(1, effort.effort)
  if (txtHp > 0 && liveHp > 0 && effort.effort > 0) {
    castsToKill = Math.max(1, Math.ceil(effort.effort * liveHp / txtHp))
  }
  const bestSkill = effort.skill

  // ── Kill priority: DPS removed per cast invested ───────────────────
  // Higher = kill this one first for maximum DPS reduction
  const dpsPerCast = castsToKill > 0 ? effectiveDps / castsToKill : 0

  // ── Total fight damage ─────────────────────────────────────────────
  const fightDurationSec = castsToKill * 0.4
  const totalFightDamage = effectiveDps * fightDurationSec

  // ── Threat classification ──────────────────────────────────────────
  const playerMaxHp = getUnitMaxHP()

  let threat: ThreatLevel
  if (castsToKill <= 2 && totalFightDamage < playerMaxHp * 0.05) {
    threat = "trivial"
  } else if (totalFightDamage < playerMaxHp * 0.2) {
    threat = "low"
  } else if (totalFightDamage < playerMaxHp * 0.8) {
    threat = "medium"
  } else if (totalFightDamage < playerMaxHp * 2) {
    threat = "high"
  } else {
    threat = "extreme"
  }

  // Override for deadly combos
  if (enchantSet.has(ENCH.LIGHTNING) && enchantSet.has(ENCH.MULTISHOT)) threat = "extreme"
  if (enchantSet.has(ENCH.CONVICTION) && (enchantSet.has(ENCH.HOLY_FIRE) || enchantSet.has(ENCH.HOLY_SHOCK))) {
    if (threat === "low" || threat === "medium") threat = "high"
  }

  // CC suggestions
  if (threat !== "trivial" && profile.coldSusceptibility > 30) {
    const ccFight = ccReducedDps * fightDurationSec
    if (ccFight < playerMaxHp * 0.2 && totalFightDamage >= playerMaxHp * 0.3) {
      counterplay.push("Chill/freeze neutralizes this target")
    }
  }
  if (profile.coldSusceptibility === 0) {
    counterplay.push("Cold immune — cannot chill/freeze")
  }

  return {
    elements, totalPerHit, effectiveDps, positionedDps,
    castsToKill, bestSkill, ccReducedDps, currentlyCCed, isFrozen,
    totalFightDamage, threat, dangers, counterplay, dpsPerCast,
    spectype: mon.spectype, playerHasIM, playerHasAmpDmg, playerHasLR,
  }
}

// ═══════════════════════════════════════════════════════════════════════
// BATTLEFIELD — full tactical situation analysis
// ═══════════════════════════════════════════════════════════════════════

/** Max distance to consider a monster "nearby" and contributing real threat */
const NEARBY_RADIUS = 25

/** Potion cooldown in D2: 30 frames = 1.2 seconds at 25fps */
const POT_COOLDOWN_SEC = 1.2

/** HP healed per potion tier (hp1..hp5, rvs, rvl) */
const POT_HEAL: Record<string, number> = {
  hp1: 45, hp2: 90, hp3: 150, hp4: 225, hp5: 320,
  rvs: 0, rvl: 0, // rejuvs heal % based — handled separately
}
const REJUV_PCT: Record<string, number> = { rvs: 0.35, rvl: 1.0 }

export type TacticalAction =
  | "engage"        // fight them
  | "cc_first"      // apply CC before committing kills
  | "focus_reviver" // kill reviver first
  | "skip"          // pack is not worth engaging
  | "retreat"       // we're losing, get out
  | "kite"          // keep distance, ranged-only
  | "burst_priority"// one extreme target, nuke it immediately

export interface KillPriority {
  mon: Monster
  threat: ThreatAssessment
  dpsPerCast: number
  priorityScore: number
  reason: string
}

export interface AuraContext {
  hasConviction: boolean
  convictionPenalty: number
  hasFanaticism: boolean
  hasHolyFreeze: boolean
  auraSources: Monster[]
}

export interface PotionInfo {
  /** Belt pot codes (e.g. ['hp3','hp3','hp4','mp3','rvs']) */
  beltPots: string[]
}

export interface BattlefieldAssessment {
  threats: KillPriority[]
  /** DPS from nearby monsters only (distance-adjusted) */
  totalIncomingDps: number
  /** Raw max DPS if everything were in melee */
  worstCaseDps: number
  activeThreats: number
  peakThreat: ThreatLevel
  situationDanger: ThreatLevel
  action: TacticalAction
  actionReason: string
  meleePackCount: number
  /** Seconds until death accounting for potion healing */
  timeToDeathSec: number
  totalCastsToKill: number
  /** Damage taken while clearing the fight (minus pot healing) */
  totalFightDamage: number
  /** How much our pots heal per second */
  potHealPerSec: number
  /** Whether pots can out-heal incoming DPS */
  canSustain: boolean
  /** Total pot charges remaining */
  potCharges: number
  ccDpsDelta: number
  auras: AuraContext
  playerHpPct: number
  playerMpPct: number
  corpseChainRisk: boolean
  reviverActive: boolean
}

const threatRank: Record<ThreatLevel, number> = {
  trivial: 0, low: 1, medium: 2, high: 3, extreme: 4,
}
const threatFromRank: ThreatLevel[] = ["trivial", "low", "medium", "high", "extreme"]

function aliveFilter(m: Monster): boolean {
  return m.valid && m.hp > 0 && m.mode !== MonsterMode.Death && m.mode !== MonsterMode.Dead
}

function computePotSustain(pots: PotionInfo, playerMaxHp: number): { healPerSec: number, totalHeal: number, charges: number } {
  let totalHeal = 0
  let charges = 0
  for (const code of pots.beltPots) {
    const flat = POT_HEAL[code]
    if (flat !== undefined && flat > 0) {
      totalHeal += flat
      charges++
    } else {
      const pct = REJUV_PCT[code]
      if (pct !== undefined) {
        totalHeal += playerMaxHp * pct
        charges++
      }
    }
  }
  // Heal per second = we can drink one pot every POT_COOLDOWN_SEC
  // Average heal per pot * drink rate
  const avgHeal = charges > 0 ? totalHeal / charges : 0
  const healPerSec = avgHeal / POT_COOLDOWN_SEC
  return { healPerSec, totalHeal, charges }
}

export function assessBattlefield(monsters: Monster[], potions?: PotionInfo): BattlefieldAssessment {
  const alive = monsters.filter(aliveFilter)

  // ── 1. Filter to nearby monsters only ──────────────────────────────
  const nearby = alive.filter(m => m.distance <= NEARBY_RADIUS)

  // ── 2. Detect aura context ─────────────────────────────────────────
  const auras: AuraContext = {
    hasConviction: false, convictionPenalty: 0,
    hasFanaticism: false, hasHolyFreeze: false,
    auraSources: [],
  }

  for (const m of nearby) {
    let ench: number[]
    try { ench = m.enchants } catch { ench = [] }
    const enchSet = new Set(ench)
    if (enchSet.has(ENCH.CONVICTION)) {
      auras.hasConviction = true
      const diff = getDifficulty()
      auras.convictionPenalty = Math.max(auras.convictionPenalty, [30, 50, 85][diff] ?? 85)
      auras.auraSources.push(m)
    }
    if (enchSet.has(ENCH.FANATICISM)) {
      auras.hasFanaticism = true
      auras.auraSources.push(m)
    }
    if (enchSet.has(ENCH.HOLY_FREEZE)) {
      auras.hasHolyFreeze = true
      auras.auraSources.push(m)
    }
  }

  // ── 3. Assess each nearby monster ──────────────────────────────────
  const assessed = nearby.map(m => ({
    mon: m,
    threat: assessThreat(m),
  }))

  // ── 4. Build kill priority ─────────────────────────────────────────
  const priorities: KillPriority[] = assessed.map(({ mon, threat }) => {
    let priorityScore = threat.dpsPerCast
    let reason = `${threat.dpsPerCast | 0} dps/cast`

    if (getProfile(mon.classid).isReviver) {
      priorityScore *= 5
      reason = `REVIVER ${reason}`
    }
    if (auras.auraSources.includes(mon)) {
      priorityScore *= 3
      reason = `AURA SOURCE ${reason}`
    }
    if (threat.isFrozen) {
      priorityScore *= 0.2
      reason = `frozen ${reason}`
    }
    if (mon.spectype & MonsterSpecType.SuperUnique) {
      priorityScore *= 1.5
      reason = `boss ${reason}`
    } else if (mon.spectype & MonsterSpecType.Champion) {
      priorityScore *= 1.2
    }
    if (threat.threat === "extreme") {
      priorityScore *= 2
      reason = `EXTREME ${reason}`
    }
    if (threat.castsToKill <= 2 && threat.effectiveDps > 0) {
      priorityScore *= 1.5
      reason = `quick-kill ${reason}`
    }

    return { mon, threat, dpsPerCast: threat.dpsPerCast, priorityScore, reason }
  })

  priorities.sort((a, b) => b.priorityScore - a.priorityScore)

  // ── 5. Aggregate stats ─────────────────────────────────────────────
  let totalIncomingDps = 0
  let worstCaseDps = 0
  let activeThreats = 0
  let peakThreat: ThreatLevel = "trivial"
  let meleePackCount = 0
  let totalCastsToKill = 0
  let ccDpsDelta = 0
  let corpseChainRisk = false
  let reviverActive = false

  for (const { mon, threat } of priorities) {
    totalIncomingDps += threat.positionedDps
    worstCaseDps += threat.effectiveDps
    if (threat.threat !== "trivial") activeThreats++
    if (threatRank[threat.threat] > threatRank[peakThreat]) peakThreat = threat.threat
    if (mon.distance < 8) meleePackCount++
    totalCastsToKill += threat.castsToKill
    ccDpsDelta += (threat.effectiveDps - threat.ccReducedDps)

    if (getProfile(mon.classid).isReviver) reviverActive = true

    let monEnch: number[]
    try { monEnch = mon.enchants } catch { monEnch = [] }
    if ((new Set(monEnch)).has(ENCH.FIRE) || deathExplosion.has(mon.classid)) {
      if (meleePackCount >= 3) corpseChainRisk = true
    }
  }

  // ── 6. Player state ────────────────────────────────────────────────
  const playerMaxHp = getUnitMaxHP()
  const playerHp = getUnitHP()
  const playerMaxMp = getUnitMaxMP()
  const playerMp = getUnitMP()
  const playerHpPct = playerMaxHp > 0 ? playerHp / playerMaxHp : 0
  const playerMpPct = playerMaxMp > 0 ? playerMp / playerMaxMp : 0

  // ── 7. Potion sustain ──────────────────────────────────────────────
  const potSustain = potions
    ? computePotSustain(potions, playerMaxHp)
    : { healPerSec: 0, totalHeal: 0, charges: 0 }

  const netDps = Math.max(0, totalIncomingDps - potSustain.healPerSec)
  const canSustain = potSustain.healPerSec >= totalIncomingDps && potSustain.charges > 0

  // ── 8. Time to death (factoring in pot healing) ────────────────────
  let timeToDeathSec: number
  if (totalIncomingDps <= 0) {
    timeToDeathSec = Infinity
  } else if (canSustain) {
    // Pots out-heal damage — we die when pots run out
    // Total sustain time = totalHeal / totalIncomingDps + playerHp/totalIncomingDps
    timeToDeathSec = (playerHp + potSustain.totalHeal) / totalIncomingDps
  } else {
    // Net damage after pot healing eats through HP
    timeToDeathSec = netDps > 0 ? playerHp / netDps : Infinity
  }

  // ── 9. Fight damage (damage taken while clearing, minus pot healing) ─
  const secsPerCast = 0.4
  let totalFightDamage = 0
  let castsSoFar = 0
  for (const { threat } of priorities) {
    // Monster outputs positioned DPS from now until we kill it
    const monAliveSec = (castsSoFar + threat.castsToKill) * secsPerCast
    totalFightDamage += threat.positionedDps * monAliveSec
    castsSoFar += threat.castsToKill
  }
  // Subtract pot healing over the fight duration
  const totalFightSec = totalCastsToKill * secsPerCast
  const potHealDuringFight = Math.min(potSustain.totalHeal, potSustain.healPerSec * totalFightSec)
  totalFightDamage = Math.max(0, totalFightDamage - potHealDuringFight)

  // ── 10. Situation danger ───────────────────────────────────────────
  let situationDanger: ThreatLevel
  if (activeThreats === 0) {
    situationDanger = "trivial"
  } else if (canSustain && totalFightDamage < playerHp * 0.3) {
    // Pots out-heal damage and fight won't dent us much
    situationDanger = "trivial"
  } else if (totalFightDamage < playerMaxHp * 0.3) {
    situationDanger = "low"
  } else if (totalFightDamage < playerMaxHp * 1.0) {
    situationDanger = "medium"
  } else if (totalFightDamage < playerMaxHp * 2.0) {
    situationDanger = "high"
  } else {
    situationDanger = "extreme"
  }

  // Surrounded amplifier
  if (meleePackCount >= 6 && threatRank[situationDanger] < 4) {
    situationDanger = threatFromRank[Math.min(4, threatRank[situationDanger] + 1)]!
  }

  // Extreme individual threat pulls floor up
  if (peakThreat === "extreme" && threatRank[situationDanger] < 3) {
    situationDanger = "high"
  }

  // Low MP = can't output damage
  if (playerMpPct < 0.1 && activeThreats > 0 && threatRank[situationDanger] < 3) {
    situationDanger = threatFromRank[Math.min(4, threatRank[situationDanger] + 1)]!
  }

  // ── 11. Tactical action ────────────────────────────────────────────
  let action: TacticalAction = "engage"
  let actionReason = "standard engagement"

  if (totalFightDamage > playerHp * 0.9 && situationDanger === "extreme") {
    action = "retreat"
    actionReason = `fightDmg=${totalFightDamage | 0} > HP=${playerHp | 0}`
  } else if (playerHpPct < 0.25 && meleePackCount >= 4) {
    action = "retreat"
    actionReason = `HP=${(playerHpPct * 100) | 0}% surrounded by ${meleePackCount}`
  } else if (meleePackCount >= 4 && totalIncomingDps > playerMaxHp * 0.3) {
    action = "kite"
    actionReason = `${meleePackCount} melee in range, reposition`
  } else if (ccDpsDelta > totalIncomingDps * 0.4 && activeThreats >= 3) {
    action = "cc_first"
    actionReason = `CC drops ${ccDpsDelta | 0} dps (${((ccDpsDelta / totalIncomingDps) * 100) | 0}%)`
  } else if (reviverActive) {
    action = "focus_reviver"
    actionReason = "reviver in pack — kill first"
  } else if (peakThreat === "extreme" && activeThreats <= 3) {
    action = "burst_priority"
    const top = priorities[0]
    actionReason = top ? `burst ${top.mon.name ?? `cls=${top.mon.classid}`}` : "burst extreme"
  } else if (situationDanger === "trivial" && activeThreats === 0) {
    action = "skip"
    actionReason = "trivial pack, skip"
  } else {
    actionReason = `${activeThreats} nearby, ${totalIncomingDps | 0} dps` +
      (canSustain ? ' (pots sustain)' : ` TTD=${timeToDeathSec === Infinity ? '∞' : timeToDeathSec.toFixed(1) + 's'}`)
  }

  return {
    threats: priorities,
    totalIncomingDps, worstCaseDps, activeThreats, peakThreat,
    situationDanger, action, actionReason,
    meleePackCount, timeToDeathSec, totalCastsToKill, totalFightDamage,
    potHealPerSec: potSustain.healPerSec, canSustain, potCharges: potSustain.charges,
    ccDpsDelta, auras, playerHpPct, playerMpPct,
    corpseChainRisk, reviverActive,
  }
}

// ═══════════════════════════════════════════════════════════════════════
// FORMATTERS
// ═══════════════════════════════════════════════════════════════════════

export function formatThreat(mon: Monster, t: ThreatAssessment): string {
  const parts = [
    `[${t.threat.toUpperCase()}] ${mon.name ?? `cls=${mon.classid}`} (${mon.classid})`,
    `${t.effectiveDps | 0} dps d=${mon.distance | 0}`,
    `${t.castsToKill} casts hp=${mon.hp | 0}/${mon.hpmax | 0}`,
  ]
  const elems = t.elements.filter(e => e.effectiveDmg > 0).map(e => `${e.element}:${e.effectiveDmg | 0}(raw ${e.rawDmg | 0})`).join(" ")
  if (elems) parts.push(elems)
  if (t.dangers.length) parts.push(`! ${t.dangers.join(", ")}`)
  if (t.currentlyCCed) parts.push(t.isFrozen ? "(FROZEN)" : "(CCed)")
  return parts.join(" | ")
}

export function formatBattlefield(bf: BattlefieldAssessment): string {
  const lines: string[] = []
  const ttd = bf.timeToDeathSec === Infinity ? '∞' : bf.timeToDeathSec.toFixed(1) + 's'
  lines.push(`[${bf.situationDanger.toUpperCase()}] → ${bf.action} | ${bf.actionReason}`)
  lines.push(`  ${bf.activeThreats} nearby threats, ${bf.totalIncomingDps | 0} dps, TTD=${ttd}, ${bf.totalCastsToKill} casts`)
  lines.push(`  HP=${(bf.playerHpPct * 100) | 0}% MP=${(bf.playerMpPct * 100) | 0}% melee=${bf.meleePackCount} fightDmg=${bf.totalFightDamage | 0}`)
  lines.push(`  Pots: ${bf.potCharges} charges, ${bf.potHealPerSec | 0} hp/s sustain ${bf.canSustain ? '(SUSTAINING)' : '(NOT sustaining)'}`)

  if (bf.auras.hasConviction) lines.push(`  Conviction aura: -${bf.auras.convictionPenalty} res`)
  if (bf.auras.hasFanaticism) lines.push(`  Fanaticism aura: pack hits harder + faster`)
  if (bf.auras.hasHolyFreeze) lines.push(`  Holy Freeze aura: we are slowed`)
  if (bf.corpseChainRisk) lines.push(`  Corpse chain risk — fire enchanted in dense pack`)
  if (bf.reviverActive) lines.push(`  Reviver active — infinite fight if not killed first`)

  for (let i = 0; i < Math.min(3, bf.threats.length); i++) {
    const p = bf.threats[i]!
    lines.push(`  #${i + 1} ${p.reason}: ${p.mon.name ?? `cls=${p.mon.classid}`} (${p.threat.threat})`)
  }

  return lines.join("\n")
}
