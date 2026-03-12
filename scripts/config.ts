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
  teleport: Skill.Teleport,
  killRange: 25,        // max distance to engage
  maxAttacks: 50,       // bail after this many casts per clear

  // Loot
  pickRange: 15,

  // Movement
  teleRange: 30,        // max teleport distance per hop
}))
