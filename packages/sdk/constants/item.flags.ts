/** Item flags (dwItemFlags bitmask) */
export const enum ItemFlags {
  Identified = 0x10,
  Socketed = 0x800,
  New = 0x2000,
  Ethereal = 0x400000,
  Runeword = 0x4000000,
}

/** Monster spectype flags (bitmask from monGetSpecType) */
export const enum MonsterSpecType {
  SuperUnique = 0x02,
  Champion = 0x04,
  Unique = 0x08,
  Minion = 0x10,
}
