/**
 * D2 Seed RNG — replicates the game's Linear Congruential Generator.
 *
 * D2SeedStrc at Room1+0x6C: { nSeedLow: u32, nSeedHigh: u32 }
 * LCG multiplier: 0x6AC690C5
 * Advance: tmp = low * 0x6AC690C5; low = tmp & 0xFFFFFFFF; high += tmp >> 32
 * Roll: advance, return high % range
 */

export interface D2Seed {
  low: number   // nSeedLow (u32)
  high: number  // nSeedHigh (u32)
}

/** Clone a seed (so the original isn't mutated). */
export function seedClone(s: D2Seed): D2Seed {
  return { low: s.low, high: s.high }
}

/**
 * Advance the D2 LCG seed in-place.
 * Computes: tmp = low * 0x6AC690C5 (64-bit); low = tmp[31:0]; high += tmp[63:32]
 * Uses 16-bit chunk multiplication to stay within JS safe integer range.
 */
export function seedAdvance(s: D2Seed): void {
  const a = s.low >>> 0
  const M = 0x6AC690C5
  const aLo = a & 0xFFFF, aHi = (a >>> 16) & 0xFFFF
  const mLo = M & 0xFFFF, mHi = (M >>> 16) & 0xFFFF

  const ll = aLo * mLo
  const lh = aLo * mHi
  const hl = aHi * mLo
  const hh = aHi * mHi

  // low 32 bits: ll + ((lh + hl) & 0xFFFF) << 16
  const mid = lh + hl
  const lo32 = (ll + ((mid & 0xFFFF) << 16)) >>> 0

  // high 32 bits: hh + (mid >> 16) + carry from lo32
  const carry = (ll + ((mid & 0xFFFF) << 16)) > 0xFFFFFFFF ? 1 : 0
  const hi32 = (hh + ((mid >>> 16) & 0xFFFF) + carry) >>> 0

  s.low = lo32
  s.high = ((s.high >>> 0) + hi32) >>> 0
}

/**
 * Roll a random number in [0, range) using D2's LCG.
 * Advances the seed, returns high % range.
 */
export function seedRoll(s: D2Seed, range: number): number {
  seedAdvance(s)
  if (range <= 0) return 0
  return (s.high >>> 0) % range
}
