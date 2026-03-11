import { createService, Skill, Area } from "diablo:game"

export const townAreas = new Set([
  Area.RogueEncampment,
  Area.LutGholein,
  Area.KurastDocks,
  Area.PandemoniumFortress,
  Area.Harrogath,
])

export const Config = createService(() => ({
  // Combat
  mainSkill: Skill.Blizzard,
  teleport: Skill.Teleport,
  castDelay: 600,       // ms between casts
  killRange: 25,        // max distance to engage
  maxAttacks: 20,       // bail after this many casts per clear

  // Loot — minimum quality to pick up (4=magic, 5=set, 6=rare, 7=unique)
  pickMinQuality: 6,
  pickRange: 15,

  // Movement
  teleRange: 30,        // max teleport distance per hop
}))
