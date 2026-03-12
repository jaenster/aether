// Belt code → total slot count
export const beltSlotMap: Record<string, number> = {
  // Sash / light belt class: 2 rows = 8 slots
  lbl: 8, zlb: 8, ulb: 8,  // sash, demonhide sash, ...
  vbl: 8, zvb: 8, uvb: 8,  // light belt
  // Belt / heavy belt class: 3 rows = 12 slots
  mbl: 12, zmb: 12, umb: 12,
  tbl: 12, ztb: 12, utb: 12,
  // Plated / war belt class: 4 rows = 16 slots
  hbl: 16, zhb: 16, uhb: 16,
}

export const beltCodes = new Set(Object.keys(beltSlotMap))

// Potions in ascending tier
export const HP_POTS = ['hp1', 'hp2', 'hp3', 'hp4', 'hp5'] as const
export const MP_POTS = ['mp1', 'mp2', 'mp3', 'mp4', 'mp5'] as const

export const HP_POT_SET = new Set<string>(HP_POTS)
export const MP_POT_SET = new Set<string>(MP_POTS)
export const RV_POT_SET = new Set(['rvs', 'rvl'])

export const ALL_POT_CODES = new Set([...HP_POT_SET, ...MP_POT_SET, ...RV_POT_SET])
