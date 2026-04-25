import { createService, Skill, Area } from "diablo:game"
import { getSkillLevel } from "diablo:native"

export const townAreas = new Set([
  Area.RogueEncampment,
  Area.LutGholein,
  Area.KurastDocks,
  Area.PandemoniumFortress,
  Area.Harrogath,
])

export const Config = createService((game) => ({
  // Combat
  teleport: Skill.Teleport,
  killRange: 30,        // max distance to engage (was 25, too tight for walking)
  maxAttacks: 50,       // bail after this many casts per clear

  // Loot
  pickRange: 15,

  // Movement
  teleRange: 30,        // max teleport distance per hop

  /** Does the player currently have Teleport? */
  get canTeleport(): boolean {
    return getSkillLevel(Skill.Teleport, 1) > 0
  },
}))
