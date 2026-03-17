import { createService, type Game } from "diablo:game"
import { Quest, QuestState } from "diablo:constants"
import { accessToAct, getMaxAct, haveWp } from "../lib/quest-utils.js"

/** Difficulty enum */
export const enum Difficulty {
  Normal = 0,
  Nightmare = 1,
  Hell = 2,
}

/** Mode flags for decision tree filtering */
export const enum Mode {
  Classic = 'classic',
  Expansion = 'xpac',
  Softcore = 'softcore',
  Hardcore = 'hardcore',
}

export interface DecisionNode {
  /** Human-readable description of this node */
  description?: string
  /** Script name to execute */
  name?: string
  /** Child nodes to evaluate in order */
  children?: DecisionNode[]
  /** Level range requirement */
  level?: { min?: number, max?: number }
  /** Gold range requirement */
  gold?: { min?: number, max?: number }
  /** Difficulty requirement */
  difficulty?: Difficulty | Difficulty[]
  /** Mode filter */
  mode?: Mode[]
  /** Quest that must be completed before this node */
  depend?: number
  /** Skip this node if quest(s) already completed */
  skipAfter?: number | number[]
  /** Prerequisite script that must run first */
  runFirst?: string
  /** Custom condition function */
  do?: (game: Game) => boolean
}

/** The progression decision tree for normal difficulty.
 *  Evaluated top-to-bottom, first matching leaf node is the script to run.
 *  Quest scripts are loaded from scripts/sequences/quests/ */
function buildNormalTree(): DecisionNode {
  return {
    description: 'Normal progression',
    difficulty: Difficulty.Normal,
    children: [
      // Act 1
      {
        description: 'Act 1',
        children: [
          { name: 'den-of-evil', skipAfter: Quest.DenOfEvil },
          { name: 'blood-raven', skipAfter: Quest.SistersBurialGrounds, level: { min: 3 } },
          { name: 'tristram', skipAfter: Quest.TheSearchForCain, level: { min: 5 } },
          { name: 'countess', skipAfter: Quest.TheForgottenTower, level: { min: 8 } },
          { name: 'walk-to-catacombs', skipAfter: Quest.SistersToTheSlaughter, level: { min: 10 } },
          { name: 'andy', skipAfter: Quest.SistersToTheSlaughter, level: { min: 12 } },
        ],
      },

      // Act 2
      {
        description: 'Act 2',
        depend: Quest.SistersToTheSlaughter,
        children: [
          { name: 'radament', skipAfter: Quest.RadamentsLair, level: { min: 14 } },
          { name: 'cube', skipAfter: Quest.TheHoradricStaff, level: { min: 14 } },
          { name: 'staff', skipAfter: Quest.TheHoradricStaff, level: { min: 15 } },
          { name: 'amulet', skipAfter: Quest.TaintedSun, level: { min: 16 } },
          { name: 'cube-staff', skipAfter: Quest.TheHoradricStaff, level: { min: 16 } },
          { name: 'summoner', skipAfter: Quest.TheSummoner, level: { min: 18 } },
          { name: 'duriel', skipAfter: Quest.TheSevenTombs, level: { min: 20 } },
        ],
      },

      // Act 3
      {
        description: 'Act 3',
        depend: Quest.TheSevenTombs,
        children: [
          { name: 'lam-essen', skipAfter: Quest.LamEsensTome, level: { min: 22 } },
          { name: 'khalims-will', skipAfter: Quest.KhalimsWill, level: { min: 22 } },
          { name: 'mephisto', skipAfter: Quest.TheGuardian, level: { min: 24 } },
        ],
      },

      // Act 4
      {
        description: 'Act 4',
        depend: Quest.TheGuardian,
        children: [
          { name: 'izual', skipAfter: Quest.TheFallenAngel, level: { min: 25 } },
          { name: 'diablo', skipAfter: Quest.TerrorsEnd, level: { min: 26 } },
        ],
      },

      // Act 5
      {
        description: 'Act 5',
        depend: Quest.TerrorsEnd,
        mode: [Mode.Expansion],
        children: [
          { name: 'rescue-barbs', skipAfter: Quest.RescueOnMountArreat, level: { min: 27 } },
          { name: 'anya', skipAfter: Quest.PrisonOfIce, level: { min: 28 } },
          { name: 'ancients', skipAfter: Quest.RiteOfPassage, level: { min: 30 } },
          { name: 'baal', skipAfter: Quest.EveOfDestruction, level: { min: 33 } },
        ],
      },
    ],
  }
}

function buildNightmareTree(): DecisionNode {
  return {
    description: 'Nightmare progression',
    difficulty: Difficulty.Nightmare,
    children: [
      // Rush through acts — higher level requirements
      { description: 'Act 1 NM', children: [
        { name: 'andy', skipAfter: Quest.SistersToTheSlaughter, level: { min: 36 } },
      ]},
      { description: 'Act 2 NM', depend: Quest.SistersToTheSlaughter, children: [
        { name: 'duriel', skipAfter: Quest.TheSevenTombs, level: { min: 40 } },
      ]},
      { description: 'Act 3 NM', depend: Quest.TheSevenTombs, children: [
        { name: 'mephisto', skipAfter: Quest.TheGuardian, level: { min: 44 } },
      ]},
      { description: 'Act 4 NM', depend: Quest.TheGuardian, children: [
        { name: 'diablo', skipAfter: Quest.TerrorsEnd, level: { min: 48 } },
      ]},
      { description: 'Act 5 NM', depend: Quest.TerrorsEnd, mode: [Mode.Expansion], children: [
        { name: 'ancients', skipAfter: Quest.RiteOfPassage, level: { min: 50 } },
        { name: 'baal', skipAfter: Quest.EveOfDestruction, level: { min: 55 } },
      ]},
    ],
  }
}

function buildHellTree(): DecisionNode {
  return {
    description: 'Hell progression',
    difficulty: Difficulty.Hell,
    children: [
      { description: 'Act 1 Hell', children: [
        { name: 'andy', skipAfter: Quest.SistersToTheSlaughter, level: { min: 60 } },
      ]},
      { description: 'Act 2 Hell', depend: Quest.SistersToTheSlaughter, children: [
        { name: 'duriel', skipAfter: Quest.TheSevenTombs, level: { min: 63 } },
      ]},
      { description: 'Act 3 Hell', depend: Quest.TheSevenTombs, children: [
        { name: 'mephisto', skipAfter: Quest.TheGuardian, level: { min: 66 } },
      ]},
      { description: 'Act 4 Hell', depend: Quest.TheGuardian, children: [
        { name: 'diablo', skipAfter: Quest.TerrorsEnd, level: { min: 70 } },
      ]},
      { description: 'Act 5 Hell', depend: Quest.TerrorsEnd, mode: [Mode.Expansion], children: [
        { name: 'ancients', skipAfter: Quest.RiteOfPassage, level: { min: 75 } },
        { name: 'baal', skipAfter: Quest.EveOfDestruction, level: { min: 80 } },
      ]},
    ],
  }
}

export const Progression = createService((game: Game, _svc) => {
  // Evaluate all difficulty trees in order — Normal → NM → Hell
  const trees = [buildNormalTree(), buildNightmareTree(), buildHellTree()]

  function getModes(): Set<Mode> {
    const modes = new Set<Mode>()
    modes.add(game.isExpansion ? Mode.Expansion : Mode.Classic)
    modes.add(game.isHardcore ? Mode.Hardcore : Mode.Softcore)
    return modes
  }

  /** Check if a quest is completed (bit 0 = completed) */
  function questDone(questId: number): boolean {
    return game.getQuest(questId, QuestState.Completed) === 1
  }

  /** Evaluate a decision node. Returns the first matching script name, or null. */
  function evaluateNode(node: DecisionNode): string | null {
    // Check difficulty
    if (node.difficulty !== undefined) {
      const diffs = Array.isArray(node.difficulty) ? node.difficulty : [node.difficulty]
      if (!diffs.includes(game.difficulty as Difficulty)) return null
    }

    // Check mode
    if (node.mode) {
      const modes = getModes()
      if (!node.mode.some(m => modes.has(m))) return null
    }

    // Check level
    if (node.level) {
      const lvl = game.charLevel
      if (node.level.min !== undefined && lvl < node.level.min) return null
      if (node.level.max !== undefined && lvl > node.level.max) return null
    }

    // Check gold
    if (node.gold) {
      const gold = game.gold + game.goldStash
      if (node.gold.min !== undefined && gold < node.gold.min) return null
      if (node.gold.max !== undefined && gold > node.gold.max) return null
    }

    // Check dependency (quest must be completed)
    if (node.depend !== undefined && !questDone(node.depend)) return null

    // Check skip condition (skip if already done)
    if (node.skipAfter !== undefined) {
      const skips = Array.isArray(node.skipAfter) ? node.skipAfter : [node.skipAfter]
      if (skips.every(q => questDone(q))) return null
    }

    // Custom condition
    if (node.do && !node.do(game)) return null

    // If this node has children, evaluate them in order
    if (node.children) {
      for (const child of node.children) {
        const result = evaluateNode(child)
        if (result) return result
      }
      return null
    }

    // Leaf node — return the script name
    return node.name ?? null
  }

  return {
    /** Evaluate all difficulty trees and return the next script to run, or null if done. */
    evaluate(): string | null {
      for (const t of trees) {
        const result = evaluateNode(t)
        if (result) return result
      }
      return null
    },

    /** Check if a specific quest is completed */
    questDone,

    /** Get max accessible act */
    getMaxAct() { return getMaxAct(game) },

    /** Check act access */
    canAccessAct(act: number) { return accessToAct(game, act) },

    /** Check waypoint */
    haveWaypoint(area: number) { return haveWp(game, area) },
  }
})
