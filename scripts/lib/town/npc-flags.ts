export const enum NpcFlags {
  NONE       = 0,
  HEAL       = 1 << 0,
  TRADE      = 1 << 1,
  REPAIR     = 1 << 2,
  GAMBLE     = 1 << 3,
  RESURRECT  = 1 << 4,
  POTS       = 1 << 5,
  SCROLL     = 1 << 6,
  KEYS       = 1 << 7,
  CAIN_ID    = 1 << 8,
  STASH      = 1 << 9,
}

export interface NpcEntry {
  name: string
  classid: number
  act: number
  flags: NpcFlags
}

export const npcTable: NpcEntry[] = [
  // Act 1
  { name: "Akara",    classid: 148, act: 1, flags: NpcFlags.HEAL | NpcFlags.TRADE | NpcFlags.POTS | NpcFlags.SCROLL | NpcFlags.KEYS },
  { name: "Charsi",   classid: 154, act: 1, flags: NpcFlags.TRADE | NpcFlags.REPAIR },
  { name: "Gheed",    classid: 147, act: 1, flags: NpcFlags.GAMBLE },
  { name: "Kashya",   classid: 150, act: 1, flags: NpcFlags.RESURRECT },
  { name: "Cain",     classid: 146, act: 1, flags: NpcFlags.CAIN_ID },
  // Act 2
  { name: "Fara",     classid: 178, act: 2, flags: NpcFlags.TRADE | NpcFlags.REPAIR | NpcFlags.HEAL },
  { name: "Drognan",  classid: 177, act: 2, flags: NpcFlags.TRADE | NpcFlags.SCROLL },
  { name: "Lysander", classid: 202, act: 2, flags: NpcFlags.TRADE | NpcFlags.POTS | NpcFlags.KEYS },
  { name: "Elzix",    classid: 199, act: 2, flags: NpcFlags.GAMBLE },
  { name: "Atma",     classid: 176, act: 2, flags: NpcFlags.HEAL },
  { name: "Greiz",    classid: 198, act: 2, flags: NpcFlags.RESURRECT },
  { name: "Cain",     classid: 244, act: 2, flags: NpcFlags.CAIN_ID },
  // Act 3
  { name: "Ormus",    classid: 255, act: 3, flags: NpcFlags.HEAL | NpcFlags.TRADE | NpcFlags.POTS | NpcFlags.SCROLL },
  { name: "Hratli",   classid: 253, act: 3, flags: NpcFlags.TRADE | NpcFlags.REPAIR },
  { name: "Alkor",    classid: 254, act: 3, flags: NpcFlags.GAMBLE },
  { name: "Asheara",  classid: 252, act: 3, flags: NpcFlags.RESURRECT },
  { name: "Cain",     classid: 245, act: 3, flags: NpcFlags.CAIN_ID },
  // Act 4
  { name: "Halbu",    classid: 257, act: 4, flags: NpcFlags.TRADE | NpcFlags.REPAIR },
  { name: "Jamella",  classid: 405, act: 4, flags: NpcFlags.HEAL | NpcFlags.TRADE | NpcFlags.GAMBLE | NpcFlags.POTS | NpcFlags.SCROLL | NpcFlags.KEYS },
  { name: "Tyrael",   classid: 367, act: 4, flags: NpcFlags.RESURRECT },
  { name: "Cain",     classid: 246, act: 4, flags: NpcFlags.CAIN_ID },
  // Act 5
  { name: "Larzuk",   classid: 511, act: 5, flags: NpcFlags.TRADE | NpcFlags.REPAIR },
  { name: "Malah",    classid: 513, act: 5, flags: NpcFlags.HEAL | NpcFlags.TRADE | NpcFlags.POTS | NpcFlags.SCROLL | NpcFlags.KEYS },
  { name: "Anya",     classid: 512, act: 5, flags: NpcFlags.TRADE | NpcFlags.GAMBLE },
  { name: "QualKehk", classid: 515, act: 5, flags: NpcFlags.RESURRECT },
  { name: "Cain",     classid: 527, act: 5, flags: NpcFlags.CAIN_ID },
]

export const npcByClassid = new Map<number, NpcEntry>(
  npcTable.map(n => [n.classid, n])
)

export function getNpcsForAct(act: number): NpcEntry[] {
  return npcTable.filter(n => n.act === act)
}

export function actFromArea(area: number): number {
  if (area <= 39) return 1
  if (area <= 74) return 2
  if (area <= 102) return 3
  if (area <= 108) return 4
  return 5
}

/**
 * Find minimum NPC sets that cover all needed flags for a given act.
 * Returns arrays of NpcEntry — each is a valid covering set.
 * Only returns smallest-size covers.
 */
export function getGroups(act: number, neededFlags: NpcFlags): NpcEntry[][] {
  const npcs = getNpcsForAct(act).filter(n => (n.flags & neededFlags) !== 0)
  const n = npcs.length
  if (n === 0) return []

  let bestSize = n + 1
  const results: NpcEntry[][] = []

  for (let mask = 1; mask < (1 << n); mask++) {
    const bits = popcount(mask)
    if (bits > bestSize) continue

    let covered: number = NpcFlags.NONE
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) covered |= npcs[i]!.flags
    }

    if ((covered & neededFlags) === neededFlags) {
      if (bits < bestSize) {
        bestSize = bits
        results.length = 0
      }
      const group: NpcEntry[] = []
      for (let i = 0; i < n; i++) {
        if (mask & (1 << i)) group.push(npcs[i]!)
      }
      results.push(group)
    }
  }

  return results
}

function popcount(x: number): number {
  let c = 0
  while (x) { c++; x &= x - 1 }
  return c
}
