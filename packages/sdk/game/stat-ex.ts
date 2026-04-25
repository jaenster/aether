/**
 * Kolbot-compatible getStatEx implementation — pure function over a small
 * reader interface so it can be unit-tested without any game state.
 *
 * The reader matches the surface area of ItemUnit actually used by the
 * algorithm: classid, itemType, flags, and raw getStat(id, layer).
 */

import { Stat, ItemClassId, ItemType, ItemFlags, SKILL_TABS } from "diablo:constants"
// ItemFlags imported for Runeword bit test in description-fallback section below.

export interface StatReader {
  readonly classid: number
  readonly itemType: number
  readonly flags: number
  getStat(id: number, layer: number): number
  /** Full stat list — [stat, layer, value] triples. Empty array is fine for callers that don't need it. */
  getStatList(): Array<[number, number, number]>
}

export function computeStatEx(r: StatReader, id: number, subid?: number): number {
  switch (id) {
    case Stat.AllRes: {
      const fire = computeStatEx(r, Stat.FireResist)
      const cold = computeStatEx(r, Stat.ColdResist)
      const light = computeStatEx(r, Stat.LightningResist)
      const psn = computeStatEx(r, Stat.PoisonResist)
      const min = Math.min(fire, cold, light, psn)
      return (fire === cold && cold === light && light === psn) ? min : 0
    }

    case Stat.ToBlock: {
      const raw = r.getStat(Stat.ToBlock, 0)
      switch (r.classid) {
        case ItemClassId.Buckler:
          return raw
        case ItemClassId.PreservedHead:
        case ItemClassId.MummifiedTrophy:
        case ItemClassId.MinionSkull:
          return raw - 3
        case ItemClassId.SmallShield:
        case ItemClassId.ZombieHead:
        case ItemClassId.FetishTrophy:
        case ItemClassId.HellspawnSkull:
          return raw - 5
        case ItemClassId.KiteShield:
        case ItemClassId.UnravellerHead:
        case ItemClassId.SextonTrophy:
        case ItemClassId.OverseerSkull:
          return raw - 8
        case ItemClassId.SpikedShield:
        case ItemClassId.Defender:
        case ItemClassId.GargoyleHead:
        case ItemClassId.CantorTrophy:
        case ItemClassId.SuccubusSkull:
        case ItemClassId.Targe:
        case ItemClassId.AkaranTarge:
          return raw - 10
        case ItemClassId.LargeShield:
        case ItemClassId.RoundShield:
        case ItemClassId.DemonHead:
        case ItemClassId.HierophantTrophy:
        case ItemClassId.BloodlordSkull:
          return raw - 12
        case ItemClassId.Scutum:
          return raw - 14
        case ItemClassId.Rondache:
        case ItemClassId.AkaranRondache:
          return raw - 15
        case ItemClassId.GothicShield:
        case ItemClassId.AncientShield:
          return raw - 16
        case ItemClassId.BarbedShield:
          return raw - 17
        case ItemClassId.DragonShield:
          return raw - 18
        case ItemClassId.VortexShield:
          return raw - 19
        case ItemClassId.BoneShield:
        case ItemClassId.GrimShield:
        case ItemClassId.Luna:
        case ItemClassId.BladeBarrier:
        case ItemClassId.TrollNest:
        case ItemClassId.HeraldicShield:
        case ItemClassId.ProtectorShield:
          return raw - 20
        case ItemClassId.Heater:
        case ItemClassId.Monarch:
        case ItemClassId.AerinShield:
        case ItemClassId.GildedShield:
        case ItemClassId.ZakarumShield:
          return raw - 22
        case ItemClassId.TowerShield:
        case ItemClassId.Pavise:
        case ItemClassId.Hyperion:
        case ItemClassId.Aegis:
        case ItemClassId.Ward:
          return raw - 24
        case ItemClassId.CrownShield:
        case ItemClassId.RoyalShield:
        case ItemClassId.KurastShield:
          return raw - 25
        case ItemClassId.SacredRondache:
          return raw - 28
        case ItemClassId.SacredTarge:
          return raw - 30
      }
      break
    }

    case Stat.MinDamage:
    case Stat.MaxDamage:
      if (subid === 1) {
        // Kolbot algorithm: weapons with "+damage" affixes have the stat listed twice —
        // first entry is +damage, second is base item damage. If the total (via getStat)
        // exceeds the first entry's value, that first entry IS the plus-damage portion.
        const list = r.getStatList()
        let rval = 0
        const secondary = id + 2  // 21→23, 22→24
        for (let i = 0; i < list.length; i++) {
          const entry = list[i]!
          const st = entry[0]
          const val = entry[2]
          if (st !== id && st !== secondary) continue
          if (rval) return rval  // second occurrence found → first was +dmg
          const total = r.getStat(st, 0)
          if (total > 0 && total > val) rval = val
        }
        return 0
      }
      break

    case Stat.Defense:
      if (subid === 0) {
        switch (r.itemType) {
          case ItemType.Jewel:
          case ItemType.SmallCharm:
          case ItemType.LargeCharm:
          case ItemType.GrandCharm:
            return r.getStat(Stat.Defense, 0)
        }
        // For armor: kolbot parses the "+NNN Defense" line from the item description
        // (magic/affix defense, separate from base item defense). The stat list has
        // stat 31 with multiple entries when there's bonus defense — first is base,
        // subsequent are bonuses. Sum all non-first entries to match kolbot's reading.
        const list = r.getStatList()
        let base = true
        let bonus = 0
        for (let i = 0; i < list.length; i++) {
          const e = list[i]!
          if (e[0] !== Stat.Defense) continue
          if (base) { base = false; continue }
          bonus += e[2]
        }
        return bonus
      }
      break

    case Stat.PoisonMinDamage:
      if (subid === 1) {
        return Math.round(r.getStat(Stat.PoisonMinDamage, 0) * r.getStat(Stat.PoisonLength, 0) / 256)
      }
      break

    case Stat.AddClassSkills:
      if (subid === undefined) {
        for (let i = 0; i < 7; i++) {
          const v = r.getStat(Stat.AddClassSkills, i)
          if (v) return v
        }
        return 0
      }
      break

    case Stat.AddSkillTab:
      if (subid === undefined) {
        for (let i = 0; i < SKILL_TABS.length; i++) {
          const v = r.getStat(Stat.AddSkillTab, SKILL_TABS[i]!)
          if (v) return v
        }
        return 0
      }
      break

    case Stat.SkillOnAttack:
    case Stat.SkillOnKill:
    case Stat.SkillOnDeath:
    case Stat.SkillOnStrike:
    case Stat.SkillOnLevelUp:
    case Stat.SkillWhenStruck:
    case Stat.ChargedSkill:
      if (subid === 1 || subid === 2) {
        // Triggered skills: encoded as stat=id, layer=(level<<6)|chance or similar,
        // value=skillId. Kolbot's d2bs exposes {skill, level}; we scan the stat list
        // for the first entry matching this id and extract.
        //
        // Empirical D2 encoding (1.10+): value = (skill << 0) for ChargedSkill payload
        // layer, while subid=1 maps to skill, subid=2 to level. We honor the common
        // layout: layer = level<<6 | chance ; value = skill. kolbot's handling:
        //   subid=1 → .skill ; subid=2 → .level
        const list = r.getStatList()
        for (let i = 0; i < list.length; i++) {
          const entry = list[i]!
          if (entry[0] !== id) continue
          const layer = entry[1]
          const value = entry[2]
          // ChargedSkill (204): value = (level << 6) | (skillId & 0x3F)?  Actually D2:
          //   ChargedSkill: layer = (skillId << 6) | level ; value = (charges << 8) | maxCharges
          //   SkillOnX:     layer = (skillId << 6) | level ; value = chance (%)
          // kolbot's {skill, level} maps to: skill = layer >>> 6, level = layer & 0x3F
          const skill = (layer >>> 6) & 0x3FF
          const level = layer & 0x3F
          if (subid === 1) return skill
          if (subid === 2) return level
          void value  // unused in kolbot's skill/level selectors
        }
        return 0
      }
      break

    case Stat.PerLevelHp:
      return r.getStat(Stat.PerLevelHp, 0) / 2048
  }

  // Runeword Enhanced Defense / Enhanced Damage: runeword bonuses live in the
  // stat list (layer 0 or later). Kolbot parses the description to get the
  // displayed %. We sum all stat entries matching this id across layers — the
  // engine's single-layer getStat doesn't aggregate them.
  if ((r.flags & ItemFlags.Runeword) !== 0 && (id === Stat.ArmorPercent || id === Stat.EnhancedDamage)) {
    const list = r.getStatList()
    let total = 0
    for (let i = 0; i < list.length; i++) {
      const e = list[i]!
      if (e[0] === id) total += e[2]
    }
    return total
  }

  return subid === undefined ? r.getStat(id, 0) : r.getStat(id, subid)
}
