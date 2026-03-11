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

// Area adjacency for exit-based navigation (waypoint area → target area chains)
export const exitGraph: Record<number, number[]> = {
  // Catacombs (Andy)
  [Area.CatacombsLvl2]: [Area.CatacombsLvl3],
  [Area.CatacombsLvl3]: [Area.CatacombsLvl4],
  // Durance (Meph)
  [Area.DuranceofHateLvl2]: [Area.DuranceofHateLvl3],
  // River → Chaos (Diablo)
  [Area.RiverofFlame]: [Area.ChaosSanctuary],
  // WSK (Baal)
  [Area.WorldstoneLvl2]: [Area.WorldstoneLvl3],
  [Area.WorldstoneLvl3]: [Area.ThroneofDestruction],
  // Tower (Countess)
  [Area.TowerCellarLvl1]: [Area.TowerCellarLvl2],
  [Area.TowerCellarLvl2]: [Area.TowerCellarLvl3],
  [Area.TowerCellarLvl3]: [Area.TowerCellarLvl4],
  [Area.TowerCellarLvl4]: [Area.TowerCellarLvl5],
  // Nihlathak
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

// Find the closest waypoint area that can reach the target via exits
export function findBestWaypoint(targetArea: Area): { wpArea: Area, exitPath: Area[] } | null {
  if (hasWaypoint(targetArea)) return { wpArea: targetArea, exitPath: [] }

  const targetTown = getTown(targetArea)
  for (const area of wpAreas) {
    if (getTown(area) !== targetTown) continue
    const path = findExitPath(area, targetArea)
    if (path) return { wpArea: area, exitPath: path }
  }
  return null
}
