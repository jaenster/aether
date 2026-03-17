// D2 character names: 2-15 chars, letters only, no consecutive same char
// Generate fantasy-sounding names by combining prefixes + suffixes

const prefixes = [
  'Ash', 'Bal', 'Bel', 'Bor', 'Cal', 'Cor', 'Cyr', 'Dar', 'Del', 'Dor',
  'Dra', 'Eld', 'Eth', 'Fal', 'Fen', 'Gal', 'Gor', 'Grim', 'Hal', 'Hel',
  'Ith', 'Jah', 'Kal', 'Kel', 'Kir', 'Kor', 'Lam', 'Lem', 'Lor', 'Lum',
  'Mal', 'Mir', 'Mor', 'Nef', 'Nim', 'Nor', 'Ohm', 'Ort', 'Pul', 'Ral',
  'Ryn', 'Sal', 'Sel', 'Sha', 'Sol', 'Sul', 'Tal', 'Tir', 'Tor', 'Tyr',
  'Ulf', 'Ume', 'Val', 'Var', 'Vel', 'Ven', 'Vex', 'Vol', 'Xar', 'Zal',
  'Zar', 'Zod', 'Zul', 'Aza', 'Bri', 'Cad', 'Dex', 'Eir', 'Fyn', 'Gil',
  'Hux', 'Ira', 'Jyn', 'Kaz', 'Lux', 'Myr', 'Nyx', 'Osk', 'Pax', 'Qor',
  'Rex', 'Siv', 'Tav', 'Ula', 'Vyn', 'Wex', 'Xul', 'Yar', 'Zan', 'Zex',
]

const middles = [
  'an', 'ar', 'el', 'en', 'er', 'il', 'in', 'ir', 'on', 'or',
  'al', 'ol', 'ul', 'is', 'as', 'os', 'us', 'ad', 'ed', 'id',
  'ra', 're', 'ri', 'ro', 'la', 'le', 'li', 'lo', 'na', 'ne',
  'ni', 'no', 'da', 'de', 'di', 'do', 'ka', 'ke', 'ki', 'ko',
  'th', 'sh', 'ch', 'ph', 'wh', 'dr', 'gr', 'kr', 'tr', 'br',
]

const suffixes = [
  'ius', 'iel', 'ael', 'ion', 'ius', 'ian', 'iel', 'eon', 'ius',
  'ath', 'eth', 'ith', 'oth', 'uth', 'akh', 'ekh', 'ikh',
  'and', 'end', 'ind', 'ond', 'und', 'ard', 'erd', 'ird',
  'ax', 'ex', 'ix', 'ox', 'ux', 'az', 'ez', 'iz', 'oz', 'uz',
  'us', 'os', 'is', 'as', 'es', 'ur', 'or', 'ir', 'ar', 'er',
  'yn', 'an', 'en', 'in', 'on', 'un', 'al', 'el', 'il', 'ol',
  'ra', 'ri', 'ro', 'la', 'le', 'na', 'ne', 'da', 'de', 'ka',
  'heim', 'gard', 'mir', 'nar', 'thas', 'dor', 'gor', 'mor',
  'wyn', 'ryn', 'lyn', 'myr', 'vyn', 'nyx', 'rax', 'lux',
]

/** Simple seeded RNG (xorshift32) — deterministic per seed */
function xorshift(seed: number): () => number {
  let s = seed | 1
  return () => {
    s ^= s << 13
    s ^= s >> 17
    s ^= s << 5
    return (s >>> 0)
  }
}

/** Pick random element from array */
function pick<T>(arr: T[], rand: () => number): T {
  return arr[rand() % arr.length]!
}

/** Check D2 name rules: 2-15 chars, letters only, no 2+ consecutive same char */
function isValidD2Name(name: string): boolean {
  if (name.length < 2 || name.length > 15) return false
  if (!/^[A-Za-z]+$/.test(name)) return false
  for (let i = 1; i < name.length; i++) {
    if (name[i] === name[i - 1]) return false
  }
  return true
}

/** Generate a random D2-valid character name.
 *  Uses tickCount as seed if none provided. */
export function generateName(seed?: number): string {
  const rand = xorshift(seed ?? (Date.now() ^ 0xDEAD))

  for (let attempt = 0; attempt < 50; attempt++) {
    const p = pick(prefixes, rand)
    const useMiddle = rand() % 3 !== 0 // 2/3 chance of middle segment
    const m = useMiddle ? pick(middles, rand) : ''
    const s = pick(suffixes, rand)

    let name = p + m + s

    // Capitalize first letter only
    name = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()

    // Trim to 15 chars max
    if (name.length > 15) name = name.slice(0, 15)

    if (isValidD2Name(name)) return name
  }

  // Fallback: simple prefix + suffix
  return 'Aether' + String(seed ?? 1).slice(0, 5)
}

/** Generate a batch of unique names */
export function generateNames(count: number, seed?: number): string[] {
  const names = new Set<string>()
  const baseSeed = seed ?? (Date.now() ^ 0xBEEF)
  let attempt = 0

  while (names.size < count && attempt < count * 10) {
    names.add(generateName(baseSeed + attempt))
    attempt++
  }

  return [...names]
}
