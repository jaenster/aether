import { test } from "node:test"
import assert from "node:assert/strict"
import { computeStatEx, type StatReader } from "./stat-ex.js"
import { Stat, ItemClassId, ItemType, SKILL_TABS } from "../constants/index.js"

/** Build a test reader from a stat table: Map<`${stat}:${layer}`, value>. */
function reader(init: {
  classid?: number
  itemType?: number
  flags?: number
  stats?: Record<string, number>
  statList?: Array<[number, number, number]>
}): StatReader {
  const stats = init.stats ?? {}
  const list = init.statList ?? []
  return {
    classid: init.classid ?? 0,
    itemType: init.itemType ?? 0,
    flags: init.flags ?? 0,
    getStat(id, layer) {
      return stats[id + ":" + layer] ?? 0
    },
    getStatList() { return list },
  }
}

// ── AllRes pseudo-stat ────────────────────────────────────────────

test("AllRes: all 4 resists equal → returns min (== that value)", () => {
  const r = reader({ stats: {
    [Stat.FireResist + ":0"]: 25,
    [Stat.ColdResist + ":0"]: 25,
    [Stat.LightningResist + ":0"]: 25,
    [Stat.PoisonResist + ":0"]: 25,
  }})
  assert.equal(computeStatEx(r, Stat.AllRes), 25)
})

test("AllRes: resists differ → returns 0", () => {
  const r = reader({ stats: {
    [Stat.FireResist + ":0"]: 25,
    [Stat.ColdResist + ":0"]: 20,
    [Stat.LightningResist + ":0"]: 25,
    [Stat.PoisonResist + ":0"]: 25,
  }})
  assert.equal(computeStatEx(r, Stat.AllRes), 0)
})

test("AllRes: all zero → returns 0", () => {
  assert.equal(computeStatEx(reader({}), Stat.AllRes), 0)
})

// ── ToBlock shield table ──────────────────────────────────────────

test("ToBlock: Buckler returns raw (no subtraction)", () => {
  const r = reader({ classid: ItemClassId.Buckler, stats: { [Stat.ToBlock + ":0"]: 50 } })
  assert.equal(computeStatEx(r, Stat.ToBlock), 50)
})

test("ToBlock: Monarch subtracts 22", () => {
  const r = reader({ classid: ItemClassId.Monarch, stats: { [Stat.ToBlock + ":0"]: 50 } })
  assert.equal(computeStatEx(r, Stat.ToBlock), 28)
})

test("ToBlock: SacredTarge subtracts 30", () => {
  const r = reader({ classid: ItemClassId.SacredTarge, stats: { [Stat.ToBlock + ":0"]: 60 } })
  assert.equal(computeStatEx(r, Stat.ToBlock), 30)
})

test("ToBlock: TowerShield subtracts 24", () => {
  const r = reader({ classid: ItemClassId.TowerShield, stats: { [Stat.ToBlock + ":0"]: 40 } })
  assert.equal(computeStatEx(r, Stat.ToBlock), 16)
})

test("ToBlock: SpikedShield subtracts 10 (weapon-type shield)", () => {
  const r = reader({ classid: ItemClassId.SpikedShield, stats: { [Stat.ToBlock + ":0"]: 25 } })
  assert.equal(computeStatEx(r, Stat.ToBlock), 15)
})

test("ToBlock: Necro head PreservedHead subtracts 3", () => {
  const r = reader({ classid: ItemClassId.PreservedHead, stats: { [Stat.ToBlock + ":0"]: 20 } })
  assert.equal(computeStatEx(r, Stat.ToBlock), 17)
})

test("ToBlock: non-shield classid falls through to raw (no subtraction)", () => {
  const r = reader({ classid: 9999, stats: { [Stat.ToBlock + ":0"]: 42 } })
  assert.equal(computeStatEx(r, Stat.ToBlock), 42)
})

// ── MinDamage/MaxDamage subid=1 (stat-list +damage detection) ──

test("MinDamage subid=1: no +dmg affix (single stat entry) → 0", () => {
  // Weapon with only base damage: single stat 21 entry, value = base min dmg
  const r = reader({
    stats: { [Stat.MinDamage + ":0"]: 10 },
    statList: [[Stat.MinDamage, 0, 10]],
  })
  assert.equal(computeStatEx(r, Stat.MinDamage, 1), 0)
})

test("MinDamage subid=1: +dmg affix present (two entries) → returns +dmg portion", () => {
  // Weapon with +5-10 damage affix: stat 21 appears twice. First = +5, second = base 10.
  // Total getStat = 15. First entry (5) < total (15) → stored. Second entry found → return stored (5).
  const r = reader({
    stats: { [Stat.MinDamage + ":0"]: 15 },
    statList: [[Stat.MinDamage, 0, 5], [Stat.MinDamage, 0, 10]],
  })
  assert.equal(computeStatEx(r, Stat.MinDamage, 1), 5)
})

test("MaxDamage subid=1: +dmg affix (two entries) → returns +dmg", () => {
  const r = reader({
    stats: { [Stat.MaxDamage + ":0"]: 20 },
    statList: [[Stat.MaxDamage, 0, 8], [Stat.MaxDamage, 0, 12]],
  })
  assert.equal(computeStatEx(r, Stat.MaxDamage, 1), 8)
})

test("MinDamage subid=1: secondary (2-handed) slot entries also scanned", () => {
  // secondary = id + 2 (MinDamage 21 → 23)
  const r = reader({
    stats: { [Stat.MinDamage + ":0"]: 0, [Stat.SecondaryMinDamage + ":0"]: 15 },
    statList: [[Stat.SecondaryMinDamage, 0, 5], [Stat.SecondaryMinDamage, 0, 10]],
  })
  assert.equal(computeStatEx(r, Stat.MinDamage, 1), 5)
})

test("MinDamage subid=0 falls through to raw", () => {
  const r = reader({ stats: { [Stat.MinDamage + ":0"]: 50 } })
  assert.equal(computeStatEx(r, Stat.MinDamage, 0), 50)
})

test("MinDamage no subid falls through to raw layer 0", () => {
  const r = reader({ stats: { [Stat.MinDamage + ":0"]: 50 } })
  assert.equal(computeStatEx(r, Stat.MinDamage), 50)
})

// ── Defense subid=0 ───────────────────────────────────────────────

test("Defense subid=0 on Jewel returns raw plus-defense", () => {
  const r = reader({ itemType: ItemType.Jewel, stats: { [Stat.Defense + ":0"]: 15 } })
  assert.equal(computeStatEx(r, Stat.Defense, 0), 15)
})

test("Defense subid=0 on SmallCharm returns raw", () => {
  const r = reader({ itemType: ItemType.SmallCharm, stats: { [Stat.Defense + ":0"]: 8 } })
  assert.equal(computeStatEx(r, Stat.Defense, 0), 8)
})

test("Defense subid=0 on LargeCharm returns raw", () => {
  const r = reader({ itemType: ItemType.LargeCharm, stats: { [Stat.Defense + ":0"]: 12 } })
  assert.equal(computeStatEx(r, Stat.Defense, 0), 12)
})

test("Defense subid=0 on GrandCharm returns raw", () => {
  const r = reader({ itemType: ItemType.GrandCharm, stats: { [Stat.Defense + ":0"]: 20 } })
  assert.equal(computeStatEx(r, Stat.Defense, 0), 20)
})

test("Defense subid=0 on armor (base only, no affix) returns 0", () => {
  const r = reader({
    itemType: 3, /* Armor */
    statList: [[Stat.Defense, 0, 200]],  // base only
  })
  assert.equal(computeStatEx(r, Stat.Defense, 0), 0)
})

test("Defense subid=0 on armor with +NN defense affix → returns affix value", () => {
  // Base first, then affix entries
  const r = reader({
    itemType: 3,
    statList: [[Stat.Defense, 0, 200], [Stat.Defense, 0, 50]],
  })
  assert.equal(computeStatEx(r, Stat.Defense, 0), 50)
})

test("Defense subid=0 on armor sums multiple affix entries", () => {
  const r = reader({
    itemType: 3,
    statList: [[Stat.Defense, 0, 200], [Stat.Defense, 0, 30], [Stat.Defense, 0, 20]],
  })
  assert.equal(computeStatEx(r, Stat.Defense, 0), 50)
})

test("Defense without subid falls through to raw", () => {
  const r = reader({ stats: { [Stat.Defense + ":0"]: 500 } })
  assert.equal(computeStatEx(r, Stat.Defense), 500)
})

// ── PoisonMinDamage subid=1 ───────────────────────────────────────

test("PoisonMinDamage subid=1 multiplies by PoisonLength/256", () => {
  const r = reader({ stats: {
    [Stat.PoisonMinDamage + ":0"]: 512,
    [Stat.PoisonLength + ":0"]: 256,
  }})
  // 512 * 256 / 256 = 512
  assert.equal(computeStatEx(r, Stat.PoisonMinDamage, 1), 512)
})

test("PoisonMinDamage subid=1 with half-duration", () => {
  const r = reader({ stats: {
    [Stat.PoisonMinDamage + ":0"]: 1000,
    [Stat.PoisonLength + ":0"]: 128,  // half duration
  }})
  // Math.round(1000 * 128 / 256) = 500
  assert.equal(computeStatEx(r, Stat.PoisonMinDamage, 1), 500)
})

test("PoisonMinDamage subid=1 rounds (not truncates)", () => {
  const r = reader({ stats: {
    [Stat.PoisonMinDamage + ":0"]: 7,
    [Stat.PoisonLength + ":0"]: 100,
  }})
  // 7*100/256 = 2.734... → round → 3
  assert.equal(computeStatEx(r, Stat.PoisonMinDamage, 1), 3)
})

// ── AddClassSkills without subid (layer scan) ─────────────────────

test("AddClassSkills no subid: returns first nonzero layer", () => {
  const r = reader({ stats: { [Stat.AddClassSkills + ":2"]: 3 } })
  assert.equal(computeStatEx(r, Stat.AddClassSkills), 3)
})

test("AddClassSkills no subid: returns 0 when all 7 layers empty", () => {
  assert.equal(computeStatEx(reader({}), Stat.AddClassSkills), 0)
})

test("AddClassSkills no subid: layer 6 (last) still found", () => {
  const r = reader({ stats: { [Stat.AddClassSkills + ":6"]: 1 } })
  assert.equal(computeStatEx(r, Stat.AddClassSkills), 1)
})

test("AddClassSkills no subid: does not return from layer 7+", () => {
  const r = reader({ stats: { [Stat.AddClassSkills + ":7"]: 5 } })
  assert.equal(computeStatEx(r, Stat.AddClassSkills), 0)
})

test("AddClassSkills with explicit subid falls through to raw", () => {
  const r = reader({ stats: { [Stat.AddClassSkills + ":1"]: 2 } })
  assert.equal(computeStatEx(r, Stat.AddClassSkills, 1), 2)
})

// ── AddSkillTab without subid (tab layer scan) ────────────────────

test("AddSkillTab no subid: finds value in sorc Fire tab (layer 8)", () => {
  const r = reader({ stats: { [Stat.AddSkillTab + ":8"]: 2 } })
  assert.equal(computeStatEx(r, Stat.AddSkillTab), 2)
})

test("AddSkillTab no subid: finds value in assassin MartialArts (layer 50, last)", () => {
  const r = reader({ stats: { [Stat.AddSkillTab + ":50"]: 3 } })
  assert.equal(computeStatEx(r, Stat.AddSkillTab), 3)
})

test("AddSkillTab no subid: layer outside SKILL_TABS ignored", () => {
  const r = reader({ stats: { [Stat.AddSkillTab + ":99"]: 5 } })
  assert.equal(computeStatEx(r, Stat.AddSkillTab), 0)
})

test("AddSkillTab no subid: 21 tab layers exactly", () => {
  assert.equal(SKILL_TABS.length, 21)
})

// ── Triggered skills subid=1/2 (decoded from stat list) ──

test("SkillOnAttack subid=1: returns skill id decoded from layer (level<<6)|chance", () => {
  // Telekinesis = skill id 43; level 5 → layer = (43 << 6) | 5 = 2757
  const layer = (43 << 6) | 5
  const r = reader({ statList: [[Stat.SkillOnAttack, layer, 100]] })
  assert.equal(computeStatEx(r, Stat.SkillOnAttack, 1), 43)
})

test("SkillOnAttack subid=2: returns level decoded from layer", () => {
  const layer = (43 << 6) | 5
  const r = reader({ statList: [[Stat.SkillOnAttack, layer, 100]] })
  assert.equal(computeStatEx(r, Stat.SkillOnAttack, 2), 5)
})

test("ChargedSkill subid=1: returns skill id", () => {
  // Enchant = skill 56; level 12
  const layer = (56 << 6) | 12
  const r = reader({ statList: [[Stat.ChargedSkill, layer, 123]] })
  assert.equal(computeStatEx(r, Stat.ChargedSkill, 1), 56)
})

test("ChargedSkill subid=2: returns level", () => {
  const layer = (56 << 6) | 12
  const r = reader({ statList: [[Stat.ChargedSkill, layer, 123]] })
  assert.equal(computeStatEx(r, Stat.ChargedSkill, 2), 12)
})

test("SkillOnKill subid=1 with no matching entry → 0", () => {
  assert.equal(computeStatEx(reader({}), Stat.SkillOnKill, 1), 0)
})

test("SkillOnAttack returns first matching entry when multiple", () => {
  const first = (43 << 6) | 5
  const second = (56 << 6) | 12
  const r = reader({ statList: [
    [Stat.SkillOnAttack, first, 100],
    [Stat.SkillOnAttack, second, 50],
  ]})
  assert.equal(computeStatEx(r, Stat.SkillOnAttack, 1), 43)  // first entry's skill
})

test("ChargedSkill subid=0 falls through to raw", () => {
  const r = reader({ stats: { [Stat.ChargedSkill + ":0"]: 7 } })
  assert.equal(computeStatEx(r, Stat.ChargedSkill, 0), 7)
})

// ── PerLevelHp fixed-point ────────────────────────────────────────

test("PerLevelHp divides raw by 2048", () => {
  const r = reader({ stats: { [Stat.PerLevelHp + ":0"]: 2048 } })
  assert.equal(computeStatEx(r, Stat.PerLevelHp), 1)
})

test("PerLevelHp: Fortitude 1.5/lvl stored as 3072", () => {
  const r = reader({ stats: { [Stat.PerLevelHp + ":0"]: 3072 } })
  assert.equal(computeStatEx(r, Stat.PerLevelHp), 1.5)
})

test("PerLevelHp: no +hp/lvl → 0", () => {
  assert.equal(computeStatEx(reader({}), Stat.PerLevelHp), 0)
})

// ── Default fallthrough for common stats ──────────────────────────

test("FCR (stat 105): no special handling, raw fallthrough", () => {
  const r = reader({ stats: { "105:0": 10 } })
  assert.equal(computeStatEx(r, 105), 10)
})

test("Strength (stat 0): raw fallthrough", () => {
  const r = reader({ stats: { "0:0": 30 } })
  assert.equal(computeStatEx(r, 0), 30)
})

test("MaxHP (stat 7): raw fallthrough", () => {
  const r = reader({ stats: { "7:0": 100 } })
  assert.equal(computeStatEx(r, 7), 100)
})

test("Gold in pile (stat 14): raw fallthrough", () => {
  const r = reader({ stats: { "14:0": 500 } })
  assert.equal(computeStatEx(r, 14), 500)
})

test("SingleSkill with specific layer: raw fallthrough with subid", () => {
  const r = reader({ stats: { "107:112": 3 } })
  assert.equal(computeStatEx(r, 107, 112), 3)
})

test("AddClassSkills with explicit subid passes through correctly", () => {
  const r = reader({ stats: { "83:1": 3, "83:2": 5 } })
  assert.equal(computeStatEx(r, Stat.AddClassSkills, 1), 3)
  assert.equal(computeStatEx(r, Stat.AddClassSkills, 2), 5)
})

// ── Runeword Enhanced Defense / Enhanced Damage (stat list sum) ──

test("Runeword Fortitude: EnhancedDamage (stat 18) sums across entries", () => {
  // ItemFlags.Runeword = 0x4000000
  // Base item has no ED, but the runeword adds +300% via a rune mod (might be split)
  const r = reader({
    flags: 0x4000000,
    statList: [[Stat.EnhancedDamage, 0, 300]],
  })
  // Runeword branch runs: sums all stat-18 entries
  assert.equal(computeStatEx(r, Stat.EnhancedDamage), 300)
})

test("Runeword: EnhancedDefense (stat 16 = ArmorPercent) sums across entries", () => {
  const r = reader({
    flags: 0x4000000,
    statList: [[Stat.ArmorPercent, 0, 200]],
  })
  assert.equal(computeStatEx(r, Stat.ArmorPercent), 200)
})

test("Non-runeword item: EnhancedDamage falls through to raw (no stat list sum)", () => {
  // Not a runeword (flags=0). Default path → raw getStat.
  const r = reader({
    stats: { [Stat.EnhancedDamage + ":0"]: 50 },
    statList: [[Stat.EnhancedDamage, 0, 50], [Stat.EnhancedDamage, 0, 100]],  // would sum to 150 if runeword
  })
  assert.equal(computeStatEx(r, Stat.EnhancedDamage), 50)  // uses raw
})

test("Runeword with multiple ED entries (split per rune): sums them", () => {
  const r = reader({
    flags: 0x4000000,
    statList: [
      [Stat.EnhancedDamage, 0, 50],
      [Stat.EnhancedDamage, 0, 100],
      [Stat.EnhancedDamage, 0, 150],
    ],
  })
  assert.equal(computeStatEx(r, Stat.EnhancedDamage), 300)
})

// ── Integration: NIP-compiled rule shape ──────────────────────────

test("NIP rule example: rare ring with FCR=10 and HP=25", () => {
  // Simulates pickit check output for: [classid]==522 && [quality]==6 && [fcr]==10 && [maxhp]>=25
  const r = reader({
    classid: 522,  // ring
    stats: {
      "105:0": 10,   // FCR
      "7:0": 30,     // max HP
    }
  })
  assert.equal(computeStatEx(r, 105), 10)  // fcr
  assert.equal(computeStatEx(r, 7), 30)    // hp
})
