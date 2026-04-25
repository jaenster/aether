import { createService, type Game } from "diablo:game"
import { Packet } from "../lib/packets.js"

/** Skill allocation entry: put up to `amount` hard points, starting at `minLevel` */
export interface SkillEntry {
  skill: number
  amount: number
  minLevel?: number
}

/** Stat allocation: [target, pointsPerLevel] */
export interface StatPlan {
  strength: [number, number]
  dexterity: [number, number]
  vitality: [number, number]
  energy: [number, number]
}

/** Build definition */
export interface Build {
  name: string
  skills: SkillEntry[]
  stats: StatPlan
}

// Skill prerequisite table (sorc only for now, extend as needed)
// Maps skillId -> array of prerequisite skillIds
var PREREQS: Record<number, number[]> = {
  // Fire
  37: [36],        // Warmth <- FireBolt
  41: [36],        // Inferno <- FireBolt
  46: [41],        // Blaze <- Inferno
  47: [36],        // FireBall <- FireBolt
  51: [46],        // FireWall <- Blaze
  52: [37],        // Enchant <- Warmth
  56: [47, 51],    // Meteor <- FireBall, FireWall
  61: [37],        // FireMastery <- Warmth
  62: [52, 56],    // Hydra <- Enchant, Meteor

  // Lightning
  42: [38],        // StaticField <- ChargedBolt
  48: [49],        // Nova <- Lightning
  49: [42],        // Lightning <- StaticField
  53: [49],        // ChainLightning <- Lightning
  54: [43],        // Teleport <- Telekinesis
  57: [49],        // ThunderStorm <- Lightning
  58: [43],        // EnergyShield <- Telekinesis
  63: [49],        // LightningMastery <- Lightning

  // Cold
  44: [39],        // FrostNova <- IceBolt
  45: [39],        // IceBlast <- IceBolt
  50: [40],        // ShiverArmor <- FrozenArmor
  55: [45],        // GlacialSpike <- IceBlast
  59: [55],        // Blizzard <- GlacialSpike
  60: [50],        // ChillingArmor <- ShiverArmor
  64: [55],        // FrozenOrb <- GlacialSpike
  65: [59],        // ColdMastery <- Blizzard
}

// Required levels per skill (hardcoded for sorc tree)
var REQ_LEVELS: Record<number, number> = {
  36: 1,  37: 1,  38: 1,  39: 1,  40: 1,   // Level 1 skills
  41: 6,  42: 6,  43: 6,  44: 6,  45: 6,   // Level 6 skills
  46: 12, 47: 12, 48: 12, 49: 12, 50: 12,  // Level 12 skills
  51: 18, 52: 18, 53: 18, 54: 18, 55: 18,  // Level 18 skills
  56: 24, 57: 24, 58: 24, 59: 24, 60: 24,  // Level 24 skills
  61: 30, 62: 30, 63: 30, 64: 30, 65: 30,  // Level 30 skills
}

/** Get prerequisite skill IDs that aren't yet skilled (0 hard points + pending) */
function getUnmetPrereqs(game: Game, skillId: number, pending: Record<number, number>): number[] {
  var prereqs = PREREQS[skillId]
  if (!prereqs) return []
  var unmet: number[] = []
  for (var i = 0; i < prereqs.length; i++) {
    var pid = prereqs[i] as number
    var effective = game.getSkillLevel(pid, 0) + (pending[pid] ? pending[pid] as number : 0)
    if (effective === 0) {
      unmet.push(pid)
    }
  }
  return unmet
}

/** Check if charLevel allows putting another point in this skill */
function canPutPointIn(game: Game, skillId: number, pending: Record<number, number>): boolean {
  var reqLevel = REQ_LEVELS[skillId]
  if (reqLevel === undefined) reqLevel = 1
  var hardPoints = game.getSkillLevel(skillId, 0) + (pending[skillId] ? pending[skillId] as number : 0)
  return game.charLevel >= reqLevel + hardPoints
}

// Stat IDs for allocation packets (order: str, energy, dex, vit)
var STAT_IDS = [0, 1, 2, 3] as const
var STAT_NAMES = ["strength", "energy", "dexterity", "vitality"]

/** Auto-build service: allocates skill and stat points based on a Build definition */
export var AutoBuild = createService(function(game: Game, _svc) {
  var currentBuild: Build | null = null
  var lastAllocTick = 0
  // Track pending skill allocations so we don't double-send before server confirms
  var pendingSkills: Record<number, number> = {}

  function setBuild(build: Build) {
    if (currentBuild === build) return  // don't reset state on repeated calls
    currentBuild = build
    pendingSkills = {}
    game.log('[build] set: ' + build.name)
  }

  /** Get effective hard points = server value + pending allocations */
  function effectiveHardPoints(skillId: number): number {
    var base = game.getSkillLevel(skillId, 0)
    var pending = pendingSkills[skillId]
    return base + (pending ? pending : 0)
  }

  /** Send skill allocation packet (0x3B + word skillId) */
  function sendSkillPacket(skillId: number) {
    game.sendPacket(new Packet(0x3B, 2).word(skillId).toUint8Array())
  }

  /** Send stat allocation packet (0x3A + word statId) */
  function sendStatPacket(statId: number) {
    game.sendPacket(new Packet(0x3A, 2).word(statId).toUint8Array())
  }

  /**
   * Walk skills array in priority order (Ryuk-style).
   * First entry with room for more points gets the next point.
   * Prerequisites are auto-resolved recursively.
   */
  function* allocateSkillPoints(): Generator<void> {
    if (!currentBuild) return

    var unspent = game.player.getStat(5, 0)
    if (unspent <= 0) return

    game.log('[build] skill alloc: ' + unspent + ' points, level ' + game.charLevel)

    while (unspent > 0) {
      var allocated = false
      var skills = currentBuild.skills

      for (var idx = 0; idx < skills.length; idx++) {
        var entry = skills[idx] as SkillEntry
        var skillId = entry.skill
        var amount = entry.amount
        var minLevel = entry.minLevel !== undefined ? entry.minLevel : 0

        if (minLevel > game.charLevel) continue

        var hardPoints = effectiveHardPoints(skillId)
        if (hardPoints >= Math.min(amount, 20)) continue
        if (!canPutPointIn(game, skillId, pendingSkills)) continue

        // Resolve prerequisites recursively
        var unmet = getUnmetPrereqs(game, skillId, pendingSkills)
        var target = skillId
        while (unmet.length > 0) {
          target = unmet[0] as number
          if (!canPutPointIn(game, target, pendingSkills)) {
            target = -1
            break
          }
          unmet = getUnmetPrereqs(game, target, pendingSkills)
        }
        if (target === -1) continue

        var targetHard = effectiveHardPoints(target)
        game.log('[build] skill ' + target + ' (' + (targetHard + 1) + ')')
        sendSkillPacket(target)
        pendingSkills[target] = (pendingSkills[target] ? pendingSkills[target] as number : 0) + 1
        unspent--
        allocated = true
        yield* game.delay(200)
        break
      }

      if (!allocated) break
    }
  }

  /**
   * Distribute stat points per-level based on build ratios (Ryuk-style).
   * Each stat has [target, pointsPerLevel]. Excess goes to vitality.
   */
  function* allocateStatPoints(): Generator<void> {
    if (!currentBuild) return

    var unspent = game.player.getStat(4, 0)
    if (unspent <= 0) return

    game.log('[build] stat alloc: ' + unspent + ' points')

    var plan = currentBuild.stats
    // Order: str, energy, dex, vit (matches D2 stat IDs 0-3)
    var tgt0 = plan.strength[0],  rate0 = plan.strength[1]
    var tgt1 = plan.energy[0],    rate1 = plan.energy[1]
    var tgt2 = plan.dexterity[0], rate2 = plan.dexterity[1]
    var tgt3 = plan.vitality[0],  rate3 = plan.vitality[1]
    var targets = [tgt0, tgt1, tgt2, tgt3]
    var rates = [rate0, rate1, rate2, rate3]

    var cur0 = game.player.getStat(0, 0)
    var cur1 = game.player.getStat(1, 0)
    var cur2 = game.player.getStat(2, 0)
    var cur3 = game.player.getStat(3, 0)
    var curStats = [cur0, cur1, cur2, cur3]

    var missing = [0, 0, 0, 0]
    var send = [0, 0, 0, 0]
    for (var i = 0; i < 4; i++) {
      var cs = curStats[i] as number
      var tg = targets[i] as number
      if (cs < tg) {
        missing[i] = tg - cs
      }
    }

    // Distribute points based on rates, capped by missing
    var points = unspent
    var lastPoints = points + 1
    while (points > 0 && points < lastPoints) {
      lastPoints = points
      for (var i = 0; i < 4; i++) {
        var r = rates[i] as number
        var m = (missing[i] as number) - (send[i] as number)
        var one = r
        if (one > m) one = m
        if (one > points) one = points
        if (one < 0) one = 0
        send[i] = (send[i] as number) + one
        points -= one
      }
    }

    // Any leftover goes to vitality
    send[3] = (send[3] as number) + points

    // Send stat packets
    for (var i = 0; i < 4; i++) {
      var cnt = send[i] as number
      if (cnt <= 0) continue
      game.log('[build] +' + cnt + ' ' + STAT_NAMES[i])
      for (var j = 0; j < cnt; j++) {
        sendStatPacket(i)
        yield* game.delay(50)
      }
    }
  }

  /** Allocate all pending skill and stat points */
  function* allocatePoints(): Generator<void> {
    if (!currentBuild) return

    // Only allocate if there are unspent points
    var skillPts = game.player.getStat(5, 0)
    var statPts = game.player.getStat(4, 0)
    if (skillPts <= 0 && statPts <= 0) return

    if (skillPts > 0) {
      // Clear pending for skills the server has confirmed
      for (var sk in pendingSkills) {
        var real = game.getSkillLevel(parseInt(sk), 0)
        if (real >= (pendingSkills[sk] as number)) {
          delete pendingSkills[sk]
        }
      }
      yield* allocateSkillPoints()
    }
    if (statPts > 0) {
      yield* allocateStatPoints()
    }
  }

  return {
    setBuild: setBuild,
    allocatePoints: allocatePoints,
    allocateSkillPoints: allocateSkillPoints,
    allocateStatPoints: allocateStatPoints,
    get build() { return currentBuild },
  }
})
