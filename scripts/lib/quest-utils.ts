import { Game } from "diablo:game"
import { Area } from "diablo:constants"

/** Town area IDs by act (0-indexed) */
const townByAct = [
  Area.RogueEncampment,
  Area.LutGholein,
  Area.KurastDocks,
  Area.PandemoniumFortress,
  Area.Harrogath,
]

/** Waypoint area IDs in order (index = waypoint index) */
const waypointAreas = [
  // Act 1 (0-8)
  Area.RogueEncampment, Area.ColdPlains, Area.StonyField, Area.DarkWood,
  Area.BlackMarsh, Area.OuterCloister, Area.JailLvl1, Area.InnerCloister, Area.CatacombsLvl2,
  // Act 2 (9-17)
  Area.LutGholein, Area.A2SewersLvl2, Area.DryHills, Area.HallsoftheDeadLvl2,
  Area.FarOasis, Area.LostCity, Area.PalaceCellarLvl1, Area.ArcaneSanctuary, Area.CanyonofMagic,
  // Act 3 (18-26)
  Area.KurastDocks, Area.SpiderForest, Area.GreatMarsh, Area.FlayerJungle,
  Area.LowerKurast, Area.KurastBazaar, Area.UpperKurast, Area.Travincal, Area.DuranceofHateLvl2,
  // Act 4 (27-29)
  Area.PandemoniumFortress, Area.CityoftheDamned, Area.RiverofFlame,
  // Act 5 (30-38)
  Area.Harrogath, Area.BloodyFoothills, Area.FrigidHighlands, Area.ArreatPlateau,
  Area.CrystalizedPassage, Area.GlacialTrail, Area.FrozenTundra, Area.AncientsWay, Area.WorldstoneLvl2,
]

/** Get the town area for a given act (0-4) */
export function getTownForAct(act: number): number {
  return townByAct[act] ?? Area.RogueEncampment
}

/** Get the act number (0-4) for a given area */
export function getActForArea(area: number): number {
  if (area <= 39) return 0
  if (area <= 74) return 1
  if (area <= 102) return 2
  if (area <= 108) return 3
  return 4
}

/** Check if player has access to an act (0-4) based on quest completion */
export function accessToAct(game: Game, act: number): boolean {
  if (act <= 0) return true
  // Act 2: Andy killed (quest 5 = SistersToTheSlaughter, bit 0 = completed)
  if (act >= 1 && !game.getQuest(5, 0)) return false
  // Act 3: Duriel killed (quest 11 = TheSevenTombs, bit 0)
  if (act >= 2 && !game.getQuest(11, 0)) return false
  // Act 4: Mephisto killed (quest 17 = TheGuardian, bit 0)
  if (act >= 3 && !game.getQuest(17, 0)) return false
  // Act 5: Diablo killed (quest 19 = TerrorsEnd, bit 0) — expansion only
  if (act >= 4 && !game.getQuest(19, 0)) return false
  return true
}

/** Get the highest act the player can access (0-4) */
export function getMaxAct(game: Game): number {
  for (let act = 4; act >= 0; act--) {
    if (accessToAct(game, act)) return act
  }
  return 0
}

/** Check if player has a waypoint for a given area */
export function haveWp(game: Game, area: number): boolean {
  const idx = waypointAreas.indexOf(area)
  if (idx === -1) return false
  return game.hasWaypoint(idx)
}

/** Get all waypoint areas the player has activated */
export function getActivatedWaypoints(game: Game): number[] {
  const result: number[] = []
  for (let i = 0; i < waypointAreas.length; i++) {
    if (game.hasWaypoint(i)) {
      result.push(waypointAreas[i]!)
    }
  }
  return result
}

/** Get the waypoint index for an area, or -1 if area has no waypoint */
export function getWaypointIndex(area: number): number {
  return waypointAreas.indexOf(area)
}

/** Check if an area has a waypoint */
export function hasWaypointInArea(area: number): boolean {
  return waypointAreas.includes(area)
}

export { waypointAreas, townByAct }
