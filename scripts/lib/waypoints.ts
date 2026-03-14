import { Area } from "diablo:game"

// All known waypoint object classids (from objects.txt)
export const waypointClassIds = [
  119, 145, 156, 157, 237, 238, 288, 323, 324, 398, 402, 429, 494, 496, 511, 539
]

// Areas that have waypoints
const wpAreas = new Set<Area>([
  // Act 1
  Area.RogueEncampment, Area.ColdPlains, Area.StonyField, Area.DarkWood,
  Area.BlackMarsh, Area.OuterCloister, Area.JailLvl1, Area.InnerCloister, Area.CatacombsLvl2,
  // Act 2
  Area.LutGholein, Area.A2SewersLvl2, Area.DryHills, Area.HallsoftheDeadLvl2,
  Area.FarOasis, Area.LostCity, Area.PalaceCellarLvl1, Area.ArcaneSanctuary,
  // Act 3
  Area.KurastDocks, Area.SpiderForest, Area.GreatMarsh, Area.FlayerJungle,
  Area.LowerKurast, Area.KurastBazaar, Area.UpperKurast, Area.Travincal, Area.DuranceofHateLvl2,
  // Act 4
  Area.PandemoniumFortress, Area.CityoftheDamned, Area.RiverofFlame,
  // Act 5
  Area.Harrogath, Area.FrigidHighlands, Area.ArreatPlateau, Area.CrystalizedPassage,
  Area.GlacialTrail, Area.HallsofPain, Area.FrozenTundra, Area.AncientsWay, Area.WorldstoneLvl2,
])

export function hasWaypoint(area: Area): boolean {
  return wpAreas.has(area)
}

export function getTown(area: Area): Area {
  if (area <= 39) return Area.RogueEncampment
  if (area <= 74) return Area.LutGholein
  if (area <= 102) return Area.KurastDocks
  if (area <= 108) return Area.PandemoniumFortress
  return Area.Harrogath
}

// Area adjacency for exit-based navigation (from waypoint areas to non-waypoint areas)
// Each entry: area → [areas reachable by walking through exits]
export const exitGraph: Record<number, number[]> = {
  // ── Act 1 ──────────────────────────────────────────────────────────
  [Area.RogueEncampment]: [Area.BloodMoor],
  [Area.BloodMoor]: [Area.ColdPlains, Area.DenofEvil],
  [Area.ColdPlains]: [Area.StonyField, Area.CaveLvl1, Area.BurialGrounds],
  [Area.CaveLvl1]: [Area.CaveLvl2],
  [Area.BurialGrounds]: [Area.Crypt, Area.Mausoleum],
  [Area.StonyField]: [Area.DarkWood, Area.UndergroundPassageLvl1, Area.Tristram],
  [Area.UndergroundPassageLvl1]: [Area.UndergroundPassageLvl2],
  [Area.DarkWood]: [Area.BlackMarsh],
  [Area.BlackMarsh]: [Area.TamoeHighland, Area.ForgottenTower, Area.HoleLvl1],
  [Area.HoleLvl1]: [Area.HoleLvl2],
  [Area.ForgottenTower]: [Area.TowerCellarLvl1],
  [Area.TowerCellarLvl1]: [Area.TowerCellarLvl2],
  [Area.TowerCellarLvl2]: [Area.TowerCellarLvl3],
  [Area.TowerCellarLvl3]: [Area.TowerCellarLvl4],
  [Area.TowerCellarLvl4]: [Area.TowerCellarLvl5],
  [Area.TamoeHighland]: [Area.MonasteryGate, Area.PitLvl1],
  [Area.PitLvl1]: [Area.PitLvl2],
  [Area.MonasteryGate]: [Area.OuterCloister],
  [Area.OuterCloister]: [Area.Barracks],
  [Area.Barracks]: [Area.JailLvl1],
  [Area.JailLvl1]: [Area.JailLvl2],
  [Area.JailLvl2]: [Area.JailLvl3],
  [Area.JailLvl3]: [Area.InnerCloister],
  [Area.InnerCloister]: [Area.Cathedral],
  [Area.Cathedral]: [Area.CatacombsLvl1],
  [Area.CatacombsLvl1]: [Area.CatacombsLvl2],
  [Area.CatacombsLvl2]: [Area.CatacombsLvl3],
  [Area.CatacombsLvl3]: [Area.CatacombsLvl4],

  // ── Act 2 ──────────────────────────────────────────────────────────
  [Area.LutGholein]: [Area.RockyWaste, Area.A2SewersLvl1, Area.HaremLvl1],
  [Area.A2SewersLvl1]: [Area.A2SewersLvl2],
  [Area.A2SewersLvl2]: [Area.A2SewersLvl3],
  [Area.HaremLvl1]: [Area.HaremLvl2],
  [Area.HaremLvl2]: [Area.PalaceCellarLvl1],
  [Area.PalaceCellarLvl1]: [Area.PalaceCellarLvl2],
  [Area.PalaceCellarLvl2]: [Area.PalaceCellarLvl3],
  [Area.PalaceCellarLvl3]: [Area.ArcaneSanctuary],
  [Area.RockyWaste]: [Area.DryHills, Area.StonyTombLvl1],
  [Area.StonyTombLvl1]: [Area.StonyTombLvl2],
  [Area.DryHills]: [Area.FarOasis, Area.HallsoftheDeadLvl1],
  [Area.HallsoftheDeadLvl1]: [Area.HallsoftheDeadLvl2],
  [Area.HallsoftheDeadLvl2]: [Area.HallsoftheDeadLvl3],
  [Area.FarOasis]: [Area.LostCity, Area.MaggotLairLvl1],
  [Area.MaggotLairLvl1]: [Area.MaggotLairLvl2],
  [Area.MaggotLairLvl2]: [Area.MaggotLairLvl3],
  [Area.LostCity]: [Area.ValleyofSnakes, Area.AncientTunnels],
  [Area.ValleyofSnakes]: [Area.ClawViperTempleLvl1],
  [Area.ClawViperTempleLvl1]: [Area.ClawViperTempleLvl2],
  [Area.ArcaneSanctuary]: [Area.CanyonofMagic],
  [Area.CanyonofMagic]: [Area.TalRashasTomb1, Area.TalRashasTomb2, Area.TalRashasTomb3,
    Area.TalRashasTomb4, Area.TalRashasTomb5, Area.TalRashasTomb6, Area.TalRashasTomb7],

  // ── Act 3 ──────────────────────────────────────────────────────────
  [Area.KurastDocks]: [Area.SpiderForest],
  [Area.SpiderForest]: [Area.GreatMarsh, Area.SpiderCave, Area.SpiderCavern],
  [Area.GreatMarsh]: [Area.FlayerJungle],
  [Area.FlayerJungle]: [Area.LowerKurast, Area.SwampyPitLvl1, Area.FlayerDungeonLvl1],
  [Area.SwampyPitLvl1]: [Area.SwampyPitLvl2],
  [Area.SwampyPitLvl2]: [Area.SwampyPitLvl3],
  [Area.FlayerDungeonLvl1]: [Area.FlayerDungeonLvl2],
  [Area.FlayerDungeonLvl2]: [Area.FlayerDungeonLvl3],
  [Area.LowerKurast]: [Area.KurastBazaar],
  [Area.KurastBazaar]: [Area.UpperKurast, Area.A3SewersLvl1, Area.RuinedTemple, Area.DisusedFane],
  [Area.A3SewersLvl1]: [Area.A3SewersLvl2],
  [Area.UpperKurast]: [Area.KurastCauseway, Area.ForgottenTemple, Area.ForgottenReliquary],
  [Area.KurastCauseway]: [Area.Travincal, Area.RuinedFane, Area.DisusedReliquary],
  [Area.Travincal]: [Area.DuranceofHateLvl1],
  [Area.DuranceofHateLvl1]: [Area.DuranceofHateLvl2],
  [Area.DuranceofHateLvl2]: [Area.DuranceofHateLvl3],

  // ── Act 4 ──────────────────────────────────────────────────────────
  [Area.PandemoniumFortress]: [Area.OuterSteppes],
  [Area.OuterSteppes]: [Area.PlainsofDespair],
  [Area.PlainsofDespair]: [Area.CityoftheDamned],
  [Area.CityoftheDamned]: [Area.RiverofFlame],
  [Area.RiverofFlame]: [Area.ChaosSanctuary],

  // ── Act 5 ──────────────────────────────────────────────────────────
  [Area.Harrogath]: [Area.BloodyFoothills, Area.NihlathaksTemple],
  [Area.BloodyFoothills]: [Area.FrigidHighlands],
  [Area.FrigidHighlands]: [Area.ArreatPlateau, Area.Abaddon],
  [Area.ArreatPlateau]: [Area.CrystalizedPassage, Area.PitofAcheron],
  [Area.CrystalizedPassage]: [Area.GlacialTrail, Area.FrozenRiver],
  [Area.GlacialTrail]: [Area.FrozenTundra, Area.DrifterCavern],
  [Area.FrozenTundra]: [Area.AncientsWay, Area.InfernalPit],
  [Area.AncientsWay]: [Area.ArreatSummit, Area.IcyCellar],
  [Area.ArreatSummit]: [Area.WorldstoneLvl1],
  [Area.WorldstoneLvl1]: [Area.WorldstoneLvl2],
  [Area.WorldstoneLvl2]: [Area.WorldstoneLvl3],
  [Area.WorldstoneLvl3]: [Area.ThroneofDestruction],
  [Area.NihlathaksTemple]: [Area.HallsofAnguish],
  [Area.HallsofAnguish]: [Area.HallsofPain],
  [Area.HallsofPain]: [Area.HallsofVaught],
}

// BFS from one area to another via exits
export function findExitPath(fromArea: Area, toArea: Area): Area[] | null {
  if (fromArea === toArea) return []
  const queue: Area[][] = [[fromArea]]
  const visited = new Set<Area>([fromArea])

  while (queue.length > 0) {
    const path = queue.shift()!
    const current = path[path.length - 1]!
    const neighbors = exitGraph[current]
    if (!neighbors) continue
    for (const next of neighbors) {
      if (next === toArea) return path.slice(1).concat([next])
      if (!visited.has(next)) {
        visited.add(next)
        queue.push(path.concat([next]))
      }
    }
  }
  return null
}

// Find the waypoint with the shortest exit path to the target
export function findBestWaypoint(targetArea: Area): { wpArea: Area, exitPath: Area[] } | null {
  if (hasWaypoint(targetArea)) return { wpArea: targetArea, exitPath: [] }

  const targetTown = getTown(targetArea)
  let best: { wpArea: Area, exitPath: Area[] } | null = null

  for (const area of wpAreas) {
    if (getTown(area) !== targetTown) continue
    const path = findExitPath(area, targetArea)
    if (path && (!best || path.length < best.exitPath.length)) {
      best = { wpArea: area, exitPath: path }
    }
  }
  return best
}
