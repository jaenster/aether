import { getBaseStat } from "./txt.js"
import { getDifficulty } from "diablo:native"

// --- Tactical classifiers ---

// Fallen Shaman classids that revive their fallen
const shamanClassids = new Set([
  4,    // FallenShaman
  5,    // FallenShaman2 (Carver Shaman)
  6,    // FallenShaman3 (Devilkin Shaman)
  7,    // FallenShaman4 (Dark Shaman)
  8,    // FallenShaman5 (Warped Shaman)
])

// Greater Mummies / Unravelers that revive skeleton-type monsters
const unravelerClassids = new Set([
  283,  // GreaterMummy1
  284,  // GreaterMummy2
  285,  // GreaterMummy3
  286,  // GreaterMummy4
  287,  // GreaterMummy5
])

// All reviver-type monsters
const reviverClassids = new Set([...shamanClassids, ...unravelerClassids])

/** Does this monster revive dead monsters? Kill these first. */
export function isReviver(classid: number): boolean {
  return reviverClassids.has(classid)
}

/** Is this specifically a Fallen Shaman? */
export function isShaman(classid: number): boolean {
  return shamanClassids.has(classid)
}

/** Is this an Unraveler/Greater Mummy? */
export function isUnraveler(classid: number): boolean {
  return unravelerClassids.has(classid)
}

/** Is this monster undead (low or high)? */
export function isUndead(monId: number): boolean {
  return !!(getBaseStat("monstats", monId, "lUndead") || getBaseStat("monstats", monId, "hUndead"))
}

/** Is this monster a demon? */
export function isDemon(monId: number): boolean {
  return !!getBaseStat("monstats", monId, "demon")
}

/** Is this a boss-type monster? (act bosses) */
export function isBoss(monId: number): boolean {
  return !!getBaseStat("monstats", monId, "boss")
}

// Aura-enchanted monsters (run-time enchant check, not classid-based)
// Aura enchants: 30=Conviction, 31=Fanaticism, 32=Blessed Aim, 33=Holy Fire,
//                34=Holy Freeze, 35=Holy Shock, 36=Thorns
const auraEnchants = new Set([30, 31, 32, 33, 34, 35, 36])

/** Check if a monster's enchant list includes an aura. Requires enchants array from Monster. */
export function hasAuraEnchant(enchants: number[]): boolean {
  return enchants.some(e => auraEnchants.has(e))
}

// --- Damage estimation ---

/** Get monster's average attack damage for the current difficulty */
export function monsterAvgDmg(monId: number, _areaId: number): number {
  const diff = getDifficulty()
  const fields = [
    ["A1MinD", "A1MaxD"],
    ["A1MinD(N)", "A1MaxD(N)"],
    ["A1MinD(H)", "A1MaxD(H)"],
  ][diff]!
  const min = getBaseStat("monstats", monId, fields[0]!)
  const max = getBaseStat("monstats", monId, fields[1]!)
  return (min + max) / 2
}

/** Get monster's maximum possible hit damage */
export function monsterMaxDmg(monId: number, _areaId: number): number {
  const diff = getDifficulty()
  // Check A1, A2, S1 and return the highest max
  const a1Fields = [["A1MaxD", "A2MaxD", "S1MaxD"], ["A1MaxD(N)", "A2MaxD(N)", "S1MaxD(N)"], ["A1MaxD(H)", "A2MaxD(H)", "S1MaxD(H)"]][diff]!
  let maxDmg = 0
  for (const f of a1Fields) {
    const v = getBaseStat("monstats", monId, f)
    if (v > maxDmg) maxDmg = v
  }
  return maxDmg
}

/** Get monster experience value */
export function monsterExp(monId: number): number {
  const diff = getDifficulty()
  const fields = ["Exp", "Exp(N)", "Exp(H)"]
  return getBaseStat("monstats", monId, fields[diff]!)
}

/** Multiplayer HP modifier: (players + 1) / 2 */
export function multiplayerModifier(playerCount: number): number {
  return (playerCount + 1) / 2
}
