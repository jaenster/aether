/**
 * Decision tree — ported from Ryuk's decisions/index.ts
 * Picks the next script based on level, waypoints, and quest state.
 */

import { type Game, Area } from "diablo:game"
import { haveWp } from "../sequences/act1/util.js"

// Quest IDs (matches Ryuk sdk.quests)
const Q = {
  DenOfEvil: 1,
  SistersBurialGrounds: 2,
  TheSearchForCain: 4,
  SistersToTheSlaughter: 6,
}

const doneScripts = new Set<string>()
export function markDone(name: string) { doneScripts.add(name) }
export function resetDone() { doneScripts.clear() }

function safeWp(game: Game, area: number): boolean {
  try { return haveWp(game, area) } catch { return false }
}

function safeQuest(game: Game, id: number, sub: number): boolean {
  try { return !!game.getQuest(id, sub) } catch { return false }
}

export function pickScript(game: Game): string | null {
  const level = game.charLevel
  const hasDarkWoodWp = safeWp(game, Area.DarkWood)
  const hasCatacombsWp = safeWp(game, Area.CatacombsLvl2)
  const andyDone = safeQuest(game, Q.SistersToTheSlaughter, 0)
  const bloodRavenDone = safeQuest(game, Q.SistersBurialGrounds, 0)
  const cainRescued = safeQuest(game, Q.TheSearchForCain, 14)

  // Act 1 (until Andy killed)
  if (!andyDone) {
    if (level < 6 && !doneScripts.has('cave')) return 'cave'
    if (level < 13 && !bloodRavenDone && !doneScripts.has('blood-raven')) return 'blood-raven'
    if (!hasDarkWoodWp && !doneScripts.has('underground')) return 'underground'
    if (level >= 6 && level < 11 && hasDarkWoodWp && !cainRescued && !doneScripts.has('tristram')) return 'tristram'
    if (hasDarkWoodWp && !doneScripts.has('countess')) return 'countess'
    if (level >= 12 && !hasCatacombsWp && !doneScripts.has('walk-to-catacombs')) return 'walk-to-catacombs'
    if (hasCatacombsWp) return 'andy'
  }

  // TODO: Act 2+ tree

  return 'den-of-evil'
}
