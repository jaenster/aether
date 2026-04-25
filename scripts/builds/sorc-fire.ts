import { Skill } from "diablo:constants"
import type { Build } from "../services/auto-build.js"

/**
 * Fire Sorceress leveling build (port of Ryuk's Firen).
 * Early: FireBolt -> FrostNova -> StaticField
 * Core: FireBall (max) -> FireBolt (synergy)
 * Utility: FrozenArmor, Telekinesis, Teleport
 *
 * Skills are allocated in priority order — first entry with room
 * for more points gets the next skill point. Prerequisites are
 * auto-resolved by the auto-build service.
 */
export var FireSorc: Build = {
  name: 'Fire Sorceress',
  skills: [
    // Utility skills we want at specific levels
    { skill: Skill.Telekinesis, amount: 1, minLevel: 17 },
    { skill: Skill.FrozenArmor, amount: 1, minLevel: 3 },

    // Core utility — get these ASAP
    { skill: Skill.Teleport, amount: 1 },
    { skill: Skill.FrostNova, amount: 1, minLevel: 6 },
    { skill: Skill.StaticField, amount: 4 },

    // Primary damage: max FireBall first, then FireBolt as synergy
    { skill: Skill.FireBall, amount: 20 },
    { skill: Skill.FireBolt, amount: 20 },
  ],
  stats: {
    strength: [35, 1],
    dexterity: [0, 0],
    vitality: [200, 3],
    energy: [100, 1],
  },
}
