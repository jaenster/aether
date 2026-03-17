import { Skill } from "diablo:constants"
import type { Build, SkillAllocation, StatAllocation } from "../services/auto-build.js"
import type { Game } from "diablo:game"

// Blizzard Sorceress leveling build
// Early: Fire Bolt → Static Field → Frozen Armor → Telekinesis → Teleport
// Mid: Blizzard + Cold Mastery + Glacial Spike
// Synergies: Ice Bolt, Ice Blast

const skillPlan: SkillAllocation[] = [
  // Level 2-5: Fire Bolt for early damage
  { level: 2, skillId: Skill.FireBolt },
  { level: 3, skillId: Skill.FireBolt },
  { level: 4, skillId: Skill.FireBolt },
  { level: 5, skillId: Skill.FireBolt },
  // Level 6: Unlock Static Field (game changer)
  { level: 6, skillId: Skill.StaticField },
  // Level 7-11: More Fire Bolt while saving for key skills
  { level: 7, skillId: Skill.IceBolt },
  { level: 8, skillId: Skill.FrozenArmor },
  { level: 9, skillId: Skill.FireBolt },
  { level: 10, skillId: Skill.FireBolt },
  { level: 11, skillId: Skill.FireBolt },
  // Level 12: Telekinesis prerequisite
  { level: 12, skillId: Skill.Telekinesis },
  // Level 13-17: Push toward Teleport
  { level: 13, skillId: Skill.FrostNova },
  { level: 14, skillId: Skill.IceBlast },
  { level: 15, skillId: Skill.FireBolt },
  { level: 16, skillId: Skill.FireBolt },
  { level: 17, skillId: Skill.FireBolt },
  // Level 18: TELEPORT — mobility breakthrough
  { level: 18, skillId: Skill.Teleport },
  // Level 19-23: Build toward Glacial Spike
  { level: 19, skillId: Skill.GlacialSpike },
  { level: 20, skillId: Skill.GlacialSpike },
  { level: 21, skillId: Skill.GlacialSpike },
  { level: 22, skillId: Skill.GlacialSpike },
  { level: 23, skillId: Skill.GlacialSpike },
  // Level 24: BLIZZARD — primary skill
  { level: 24, skillId: Skill.Blizzard },
  { level: 25, skillId: Skill.Blizzard },
  { level: 26, skillId: Skill.Blizzard },
  { level: 27, skillId: Skill.Blizzard },
  { level: 28, skillId: Skill.Blizzard },
  { level: 29, skillId: Skill.Blizzard },
  // Level 30: Cold Mastery
  { level: 30, skillId: Skill.ColdMastery },
  // Level 31+: Max Blizzard, then Cold Mastery, then synergies
  { level: 31, skillId: Skill.Blizzard },
  { level: 32, skillId: Skill.Blizzard },
  { level: 33, skillId: Skill.Blizzard },
  { level: 34, skillId: Skill.Blizzard },
  { level: 35, skillId: Skill.Blizzard },
  { level: 36, skillId: Skill.Blizzard },
  { level: 37, skillId: Skill.Blizzard },
  { level: 38, skillId: Skill.Blizzard },
  { level: 39, skillId: Skill.Blizzard },
  { level: 40, skillId: Skill.Blizzard },
  // Max Cold Mastery to ~17
  { level: 41, skillId: Skill.ColdMastery },
  { level: 42, skillId: Skill.ColdMastery },
  { level: 43, skillId: Skill.ColdMastery },
  { level: 44, skillId: Skill.ColdMastery },
  { level: 45, skillId: Skill.ColdMastery },
  { level: 46, skillId: Skill.ColdMastery },
  { level: 47, skillId: Skill.ColdMastery },
  { level: 48, skillId: Skill.ColdMastery },
  { level: 49, skillId: Skill.ColdMastery },
  { level: 50, skillId: Skill.ColdMastery },
  // Synergy: Ice Bolt (20% cold damage per level to Blizzard)
  { level: 51, skillId: Skill.IceBolt },
  { level: 52, skillId: Skill.IceBolt },
  { level: 53, skillId: Skill.IceBolt },
  { level: 54, skillId: Skill.IceBolt },
  { level: 55, skillId: Skill.IceBolt },
  { level: 56, skillId: Skill.IceBolt },
  { level: 57, skillId: Skill.IceBolt },
  { level: 58, skillId: Skill.IceBolt },
  { level: 59, skillId: Skill.IceBolt },
  { level: 60, skillId: Skill.IceBolt },
  { level: 61, skillId: Skill.IceBolt },
  { level: 62, skillId: Skill.IceBolt },
  { level: 63, skillId: Skill.IceBolt },
  { level: 64, skillId: Skill.IceBolt },
  { level: 65, skillId: Skill.IceBolt },
  { level: 66, skillId: Skill.IceBolt },
  { level: 67, skillId: Skill.IceBolt },
  { level: 68, skillId: Skill.IceBolt },
  { level: 69, skillId: Skill.IceBolt },
  // Synergy: Glacial Spike (already 5 points, fill to 20)
  { level: 70, skillId: Skill.GlacialSpike },
  { level: 71, skillId: Skill.GlacialSpike },
  { level: 72, skillId: Skill.GlacialSpike },
  { level: 73, skillId: Skill.GlacialSpike },
  { level: 74, skillId: Skill.GlacialSpike },
  { level: 75, skillId: Skill.GlacialSpike },
  { level: 76, skillId: Skill.GlacialSpike },
  { level: 77, skillId: Skill.GlacialSpike },
  { level: 78, skillId: Skill.GlacialSpike },
  { level: 79, skillId: Skill.GlacialSpike },
  { level: 80, skillId: Skill.GlacialSpike },
  { level: 81, skillId: Skill.GlacialSpike },
  { level: 82, skillId: Skill.GlacialSpike },
  { level: 83, skillId: Skill.GlacialSpike },
  { level: 84, skillId: Skill.GlacialSpike },
]

const statPlan: StatAllocation = {
  str: 60,    // enough for Spirit monarch (156 with gear)
  dex: 25,    // base
  vit: 999,   // everything else
  energy: 35, // small energy boost early
}

export const BlizzSorc: Build = {
  name: 'Blizzard Sorceress',
  valid(game: Game) { return game.classId === 1 },
  active(game: Game) { return game.classId === 1 },
  usedSkills: [
    Skill.FireBolt, Skill.StaticField, Skill.FrozenArmor,
    Skill.Telekinesis, Skill.Teleport, Skill.FrostNova,
    Skill.IceBolt, Skill.IceBlast, Skill.GlacialSpike,
    Skill.Blizzard, Skill.ColdMastery,
  ],
  skillPlan,
  statPlan,
}
