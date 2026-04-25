import { Skill } from "diablo:constants"
import type { Build } from "../services/auto-build.js"

// Blizzard Sorceress leveling build (Ryuk-style priority allocation)
// Early: FireBolt for damage, Static for bosses, FrozenArmor for defense
// Core: Blizzard (max) + Cold Mastery + GlacialSpike
// Synergies: IceBolt, IceBlast

export var BlizzSorc: Build = {
  name: 'Blizzard Sorceress',
  skills: [
    // Early utility
    { skill: Skill.FrozenArmor, amount: 1, minLevel: 3 },
    { skill: Skill.StaticField, amount: 1, minLevel: 6 },
    { skill: Skill.Telekinesis, amount: 1, minLevel: 12 },
    { skill: Skill.Teleport, amount: 1 },

    // Pre-Blizzard damage
    { skill: Skill.FireBolt, amount: 10, minLevel: 2 },

    // Cold tree prereqs + core
    { skill: Skill.IceBolt, amount: 1 },
    { skill: Skill.FrostNova, amount: 1, minLevel: 6 },
    { skill: Skill.IceBlast, amount: 1, minLevel: 6 },
    { skill: Skill.GlacialSpike, amount: 5, minLevel: 18 },
    { skill: Skill.Blizzard, amount: 20, minLevel: 24 },
    { skill: Skill.ColdMastery, amount: 10, minLevel: 30 },

    // Synergies
    { skill: Skill.IceBolt, amount: 20 },
    { skill: Skill.GlacialSpike, amount: 20 },
  ],
  stats: {
    strength: [60, 1],
    dexterity: [25, 0],
    vitality: [999, 4],
    energy: [35, 0],
  },
}
