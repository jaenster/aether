import { type Game, Area } from "diablo:game"

// Area -> waypoint index mapping (D2 standard order)
const wpIndexMap: Partial<Record<number, number>> = {
  [Area.RogueEncampment]: 0,
  [Area.ColdPlains]: 1,
  [Area.StonyField]: 2,
  [Area.DarkWood]: 3,
  [Area.BlackMarsh]: 4,
  [Area.OuterCloister]: 5,
  [Area.JailLvl1]: 6,
  [Area.InnerCloister]: 7,
  [Area.CatacombsLvl2]: 8,
}

export function haveWp(game: Game, area: number): boolean {
  const idx = wpIndexMap[area]
  if (idx === undefined) return false
  try { return game.hasWaypoint(idx) } catch { return false }
}

export const townAreas = new Set([
  Area.RogueEncampment, Area.LutGholein, Area.KurastDocks,
  Area.PandemoniumFortress, Area.Harrogath,
])

// Quest classids
export const BLOOD_RAVEN = 267
export const CAIRN_STONES = [17, 18, 19, 20, 21]
export const CAIRN_STONE_PORTAL_PRESET = 61
export const CAIN_GIBBET = 26
export const COUNTESS_CHEST = 580
export const ANDARIEL = 156
export const GRISWOLD = 365
export const TREE_OF_INIFUSS = 30  // object classid
export const SCROLL_OF_INIFUSS = 524  // item classid
export const KASHYA = 150  // NPC classid
export const WARRIV = 155  // NPC classid
