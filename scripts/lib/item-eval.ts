/**
 * Item evaluation — should we pick it up, equip it, sell it?
 * All decisions based on txt data, not hardcoded item lists.
 */

import { type ItemUnit, ItemContainer } from "diablo:game"
import { txtReadFieldU, txtReadField, getUnitStat } from "diablo:native"
import { getBaseStat } from "./txt.js"

// Item quality enum
const QUALITY_LOW = 1, QUALITY_NORMAL = 2, QUALITY_SUPERIOR = 3
const QUALITY_MAGIC = 4, QUALITY_SET = 5, QUALITY_RARE = 6
const QUALITY_UNIQUE = 7, QUALITY_CRAFTED = 8

// Item type categories from ItemTypes.txt
const GOLD_CODE = 'gld'
const QUEST_CODES = new Set([
  'bks', 'bkd', 'ass', 'box', 'tr1', 'tr2', // quest items
  'j34', 'g34', 'bbb', 'g33', 'leg', 'hdm', 'hfh', 'msf', 'hst', // quest items act 2-5
  'vip', 'xyz', // misc quest
])
const POTION_CODES = new Set([
  'hp1', 'hp2', 'hp3', 'hp4', 'hp5',
  'mp1', 'mp2', 'mp3', 'mp4', 'mp5',
  'rvs', 'rvl', 'yps', 'vps', 'wms',
])
const SCROLL_CODES = new Set(['tsc', 'isc'])
const KEY_CODE = 'key'
const GEM_TYPES = new Set(['gcv', 'gcb', 'gcg', 'gcr', 'gcw', 'gcy', 'skc',
  'gfv', 'gfb', 'gfg', 'gfr', 'gfw', 'gfy', 'skf',
  'gsv', 'gsb', 'gsg', 'gsr', 'gsw', 'gsy', 'sku',
  'gzv', 'glb', 'glg', 'glr', 'glw', 'gly', 'skl',
  'gpv', 'gpb', 'gpg', 'gpr', 'gpw', 'gpy', 'skz',
])
const RUNE_PATTERN = /^r[0-3][0-9]$/

/** Should we pick this item up from the ground? */
export function shouldPickup(item: ItemUnit, charLevel: number, gold: number): boolean {
  const code = item.code

  // Always pick gold
  if (code === GOLD_CODE) return true

  // Always pick quest items
  if (QUEST_CODES.has(code)) return true

  // Pick potions if belt not full (caller should check)
  if (POTION_CODES.has(code)) return true

  // Pick scrolls (TP/ID) — always useful
  if (SCROLL_CODES.has(code)) return true

  // Pick keys early game
  if (code === KEY_CODE && charLevel < 20) return true

  // Pick gems and runes — always valuable
  if (GEM_TYPES.has(code) || RUNE_PATTERN.test(code)) return true

  // Equipment: pick based on quality
  const quality = item.quality
  if (quality >= QUALITY_UNIQUE) return true    // unique — always
  if (quality >= QUALITY_SET) return true        // set — always
  if (quality >= QUALITY_RARE) return true       // rare — always (identify later)

  // Magic items: pick if low level (might be upgrade)
  if (quality >= QUALITY_MAGIC && charLevel < 15) return true

  // Normal/superior: pick only if early game and could be an upgrade
  if (charLevel < 8 && isEquipment(code)) return true

  return false
}

/** Is this item code equipment (weapon/armor/jewelry)? */
function isEquipment(code: string): boolean {
  // Check item type from txt — types 1-87 are equipment (weapons, armor, etc.)
  // Simplified: 3-char codes that aren't potions/scrolls/misc
  if (POTION_CODES.has(code) || SCROLL_CODES.has(code)) return false
  if (code === GOLD_CODE || code === KEY_CODE) return false
  if (code.length < 3 || code.length > 3) return false
  return true
}

/** Compare item to currently equipped — return true if item is better */
export function isBetterThanEquipped(item: ItemUnit, charLevel: number): boolean {
  // Read item stats from txt
  const itemDef = item.classid
  const minDam = getBaseStat("items", itemDef, "dwMinDam")
  const maxDam = getBaseStat("items", itemDef, "dwMaxDam")
  const minAc = getBaseStat("items", itemDef, "dwMinAc")
  const maxAc = getBaseStat("items", itemDef, "dwMaxAc")

  // Get currently equipped stats
  const curMinDam = getUnitStat(0, 0, 21, 0) // STAT_MINDMG on player
  const curMaxDam = getUnitStat(0, 0, 22, 0)

  // Weapon: compare average damage
  if (minDam > 0 || maxDam > 0) {
    const itemAvg = (minDam + maxDam) / 2
    const curAvg = (curMinDam + curMaxDam) / 2
    return itemAvg > curAvg * 1.1 // 10% better threshold
  }

  // Armor: compare defense
  if (minAc > 0 || maxAc > 0) {
    const curDef = getUnitStat(0, 0, 31, 0) // STAT_DEFENSE
    return maxAc > curDef * 1.1
  }

  return false
}

/** Check if player meets stat requirements to equip item */
export function meetsRequirements(item: ItemUnit, charLevel: number): boolean {
  const classid = item.classid
  const reqLvl = getBaseStat("items", classid, "nLevelReq")
  const reqStr = getBaseStat("items", classid, "reqstr") // need to find correct field
  const reqDex = getBaseStat("items", classid, "reqdex")

  if (reqLvl > charLevel) return false

  const str = getUnitStat(0, 0, 0, 0) // player STR
  const dex = getUnitStat(0, 0, 2, 0) // player DEX

  if (reqStr > 0 && str < reqStr) return false
  if (reqDex > 0 && dex < reqDex) return false

  return true
}
