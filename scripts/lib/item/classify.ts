import { ItemCategory } from "./types.js"

const POTIONS = new Set([
  'hp1', 'hp2', 'hp3', 'hp4', 'hp5',
  'mp1', 'mp2', 'mp3', 'mp4', 'mp5',
  'rvs', 'rvl',                        // rejuv
  'yps', 'vps', 'wms',                 // antidote, stamina, thawing
])

const SCROLLS = new Set(['tsc', 'isc'])   // TP, ID
const TOMES = new Set(['tbk', 'ibk'])     // TP tome, ID tome
const KEYS = new Set(['key'])
const CHARMS = new Set(['cm1', 'cm2', 'cm3']) // small, large, grand
const JEWELS = new Set(['jew'])

// r01..r33
const RUNES = new Set(Array.from({ length: 33 }, (_, i) => {
  const n = i + 1
  return 'r' + (n < 10 ? '0' : '') + n
}))

const GEMS = new Set([
  // chipped, flawed, normal, flawless, perfect × 7 types
  'gcv', 'gfv', 'gsv', 'gzv', 'gpv', // amethyst
  'gcb', 'gfb', 'gsb', 'gzb', 'gpb', // sapphire
  'gcg', 'gfg', 'gsg', 'gzg', 'gpg', // emerald
  'gcr', 'gfr', 'gsr', 'gzr', 'gpr', // ruby
  'gcw', 'gfw', 'gsw', 'gzw', 'gpw', // diamond
  'gcy', 'gfy', 'gsy', 'gzy', 'gpy', // topaz
  'skc', 'skf', 'sku', 'skl', 'skz', // skull
])

const QUEST_ITEMS = new Set([
  'leg', 'hdm', 'bks', 'bkd', 'ass', 'box', 'tr1', 'tr2',
  'msf', 'vip', 'hst', 'g33', 'g34', 'qey', 'qhr', 'qbr',
  'mss', 'xyz', 'j34', 'bbb', 'ceh', 'tes',
])

export function classifyItem(item: { code: string }): ItemCategory {
  const { code } = item
  if (POTIONS.has(code)) return ItemCategory.Potion
  if (SCROLLS.has(code)) return ItemCategory.Scroll
  if (TOMES.has(code)) return ItemCategory.Tome
  if (KEYS.has(code)) return ItemCategory.Key
  if (CHARMS.has(code)) return ItemCategory.Charm
  if (JEWELS.has(code)) return ItemCategory.Jewel
  if (RUNES.has(code)) return ItemCategory.Rune
  if (GEMS.has(code)) return ItemCategory.Gem
  if (QUEST_ITEMS.has(code)) return ItemCategory.Quest
  if (code === 'gld') return ItemCategory.Gold
  return ItemCategory.Equipment
}
