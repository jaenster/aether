import { createService, type Game } from "diablo:game"
import { Packet } from "../lib/packets.js"

/** Skill allocation entry: at what level to put a point */
export interface SkillAllocation {
  level: number
  skillId: number
}

/** Stat allocation targets */
export interface StatAllocation {
  str: number
  dex: number
  vit: number  // everything else goes here
  energy: number
}

/** Build definition — pluggable per class */
export interface Build {
  name: string
  valid(game: Game): boolean
  active(game: Game): boolean
  usedSkills: number[]
  skillPlan: SkillAllocation[]
  statPlan: StatAllocation
}

// Stat IDs for allocation packets
const STAT_STR = 0
const STAT_ENERGY = 1
const STAT_DEX = 2
const STAT_VIT = 3

/** Auto-build service: allocates skill and stat points on level-up */
export const AutoBuild = createService((game: Game, _svc) => {
  let currentBuild: Build | null = null
  let lastLevel = 0

  function setBuild(build: Build) {
    currentBuild = build
    game.log(`[build] set: ${build.name}`)
  }

  /** Allocate a single skill point — packet 0x3B */
  function allocateSkill(skillId: number) {
    const pkt = new Packet().byte(0x3B).word(skillId).toUint8Array()
    game.sendPacket(pkt)
  }

  /** Allocate a single stat point — packet 0x3A */
  function allocateStat(statId: number) {
    const pkt = new Packet().byte(0x3A).word(statId).toUint8Array()
    game.sendPacket(pkt)
  }

  /** Check and allocate pending skill points based on the build's skill plan */
  function* allocateSkillPoints() {
    if (!currentBuild) return

    const level = game.charLevel
    // stat 108 = unspent skill points
    let unspent = game.player.getStat(108, 0)

    if (unspent <= 0) return

    game.log(`[build] ${unspent} unspent skill points at level ${level}`)

    // Walk the plan in order, allocate any skills we haven't taken yet
    for (const entry of currentBuild.skillPlan) {
      if (unspent <= 0) break
      if (entry.level > level) break

      // Check if we already have this skill point
      const currentPoints = game.player.getSkillLevel(entry.skillId, 0) // base points
      if (currentPoints > 0) continue // already allocated

      // Check prerequisites — the skill plan should be ordered correctly
      game.log(`[build] allocating skill ${entry.skillId} (level ${entry.level})`)
      allocateSkill(entry.skillId)
      unspent--
      yield* game.delay(100) // small delay between allocations
    }
  }

  /** Check and allocate pending stat points based on the build's stat plan */
  function* allocateStatPoints() {
    if (!currentBuild) return

    // stat 109 = unspent stat points (5 per level)
    let unspent = game.player.getStat(109, 0)
    if (unspent <= 0) return

    game.log(`[build] ${unspent} unspent stat points`)

    const plan = currentBuild.statPlan
    const curStr = game.player.getStat(0, 0)
    const curDex = game.player.getStat(2, 0)
    const curEnergy = game.player.getStat(1, 0)

    while (unspent > 0) {
      // Priority: str to target → dex to target → energy to target → rest to vit
      if (curStr + (unspent > 0 ? 1 : 0) <= plan.str && curStr < plan.str) {
        allocateStat(STAT_STR)
      } else if (curDex < plan.dex) {
        allocateStat(STAT_DEX)
      } else if (curEnergy < plan.energy) {
        allocateStat(STAT_ENERGY)
      } else {
        allocateStat(STAT_VIT)
      }
      unspent--
      yield* game.delay(50)
    }
  }

  /** Main entry: allocate all pending points */
  function* allocatePoints() {
    if (!currentBuild) return
    const level = game.charLevel
    if (level === lastLevel) return
    lastLevel = level

    yield* allocateSkillPoints()
    yield* allocateStatPoints()
  }

  return {
    setBuild,
    allocatePoints,
    allocateSkillPoints,
    allocateStatPoints,
    get build() { return currentBuild },
  }
})
