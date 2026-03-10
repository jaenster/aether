import { createService, skills, areas } from "diablo:game"

export const townAreas = new Set([
  areas.RogueEncampment,
  areas.LutGholein,
  areas.KurastDocks,
  areas.ThePandemoniumFortress,
  areas.Harrogath,
])

export const Config = createService(() => ({
  // Combat
  mainSkill: skills.Blizzard,
  teleport: skills.Teleport,
  castDelay: 600,       // ms between casts
  killRange: 25,        // max distance to engage
  maxAttacks: 20,       // bail after this many casts per clear

  // Loot — minimum quality to pick up (4=magic, 5=set, 6=rare, 7=unique)
  pickMinQuality: 6,
  pickRange: 15,

  // Movement
  teleRange: 30,        // max teleport distance per hop
}))
