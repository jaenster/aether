import { createService, type Game, type Monster, MonsterMode, MonsterClassId } from "diablo:game"
import { getSkillLevel as _getSkillLevel, getTickCount, meGetUnitId } from "diablo:native"
import { townAreas } from "../config.js"

// ── S2C packet-based state tracking ─────────────────────────────────
// 0xA7: state applied (no stats)  — [op:u8, unitType:u8, unitGuid:u32le, stateId:u8] = 7 bytes
// 0xA8: state applied (with stats) — [op:u8, unitType:u8, unitGuid:u32le, pktLen:u8, stateId:u8, ...stats] = variable
// 0xA9: state removed             — [op:u8, unitType:u8, unitGuid:u32le, stateId:u8] = 7 bytes
// 0x4C: player cast               — [..., skillId:u16le@6, skillLvl:u8@8, ...]
//
// Server doesn't send duration directly, but 0x4C gives us the skill level when
// another player casts. From the level we compute duration via the known formulas.

interface ActiveState {
  stateId: number
  unitType: number
  unitGuid: number
  setTick: number           // tick when 0xA7/0xA8 was received
  endTick: number           // tick when 0xA9 was received (0 = still active)
  observedDuration: number  // ms between set→end from last cycle (0 = unknown)
  skillLevel: number        // from 0x4C cast packet (0 = unknown/self-cast)
  computedDurationMs: number // duration computed from skillLevel (0 = unknown)
}

/** Key for the active state map: "unitType:unitGuid:stateId" */
function stateKey(unitType: number, unitGuid: number, stateId: number): string {
  return `${unitType}:${unitGuid}:${stateId}`
}

function readU16LE(data: Uint8Array, offset: number): number {
  return data[offset]! | (data[offset + 1]! << 8)
}

function readU32LE(data: Uint8Array, offset: number): number {
  return data[offset]! | (data[offset + 1]! << 8) | (data[offset + 2]! << 16) | ((data[offset + 3]! << 24) >>> 0)
}

// Reverse lookup: state ID → buff def (for duration formula)
const STATE_TO_BUFF = new Map<number, BuffDef>()

// Skill ID → state ID for cast packet correlation
const SKILL_TO_STATE = new Map<number, number>()

// D2 state IDs (from states.txt row indices, verified against Ghidra)
export const State = {
  FrozenArmor:   10,
  BoneArmor:     14,
  Enchant:       16,
  ChillingArmor: 20,
  Shout:         26,
  EnergyShield:  30,
  Venom:         31,  // venomclaws
  BattleOrders:  32,
  ThunderStorm:  38,
  BattleCommand: 51,
  ShiverArmor:   88,
  HolyShield:    101,
  CycloneArmor:  151,
  BurstOfSpeed:  157, // quickness
  BladeShield:   158,
  Fade:          159,
} as const

// Skill ID → state ID mapping
export const BUFF_STATE: Record<number, number> = {
  40:  State.FrozenArmor,
  50:  State.ShiverArmor,
  60:  State.ChillingArmor,
  57:  State.ThunderStorm,
  58:  State.EnergyShield,
  52:  State.Enchant,
  68:  State.BoneArmor,
  117: State.HolyShield,
  138: State.Shout,
  149: State.BattleOrders,
  155: State.BattleCommand,
  235: State.CycloneArmor,
  258: State.BurstOfSpeed,
  267: State.Fade,
  277: State.BladeShield,
  278: State.Venom,
}

// How to target each buff
type BuffTarget = 'self' | 'ally' | 'aura'

// Mutually exclusive groups — only one from each group can be active
const EXCLUSIVE_GROUPS: number[][] = [
  [40, 50, 60],       // sorc armors — only one active at a time
  [258, 267],          // Burst of Speed / Fade — only one active
]

interface BuffDef {
  skillId: number
  stateId: number
  target: BuffTarget
  /** Estimated duration in seconds (0 = permanent until broken/dispelled) */
  duration: (lvl: number) => number
  /** Cast priority — lower = cast first (BC before BO before Shout) */
  priority: number
}

// All known buff definitions
const BUFF_DEFS: BuffDef[] = [
  // Sorc armors (pick whichever has points)
  { skillId: 40,  stateId: State.FrozenArmor,   target: 'self', duration: l => 144 + 12 * l, priority: 50 },
  { skillId: 50,  stateId: State.ShiverArmor,   target: 'self', duration: l => 144 + 12 * l, priority: 50 },
  { skillId: 60,  stateId: State.ChillingArmor,  target: 'self', duration: l => 144 + 12 * l, priority: 50 },
  // Sorc utility
  { skillId: 57,  stateId: State.ThunderStorm,   target: 'self', duration: l => 32 + l,       priority: 60 },
  { skillId: 58,  stateId: State.EnergyShield,   target: 'self', duration: _ => 300,          priority: 40 },
  // Sorc ally buff
  { skillId: 52,  stateId: State.Enchant,        target: 'ally', duration: l => 144 + 12 * l, priority: 70 },
  // Necro
  { skillId: 68,  stateId: State.BoneArmor,      target: 'self', duration: _ => 0,            priority: 30 },
  // Paladin
  { skillId: 117, stateId: State.HolyShield,     target: 'self', duration: l => 24 + 12 * l,  priority: 20 },
  // Barb warcries
  { skillId: 155, stateId: State.BattleCommand,  target: 'self', duration: l => 10 + 5 * l,   priority: 10 },
  { skillId: 149, stateId: State.BattleOrders,   target: 'self', duration: l => 10 + 5 * l,   priority: 11 },
  { skillId: 138, stateId: State.Shout,          target: 'self', duration: l => 10 + 5 * l,   priority: 12 },
  // Druid
  { skillId: 235, stateId: State.CycloneArmor,   target: 'self', duration: _ => 0,            priority: 30 },
  // Assassin
  { skillId: 258, stateId: State.BurstOfSpeed,   target: 'self', duration: l => 12 + 8 * l,   priority: 20 },
  { skillId: 267, stateId: State.Fade,           target: 'self', duration: l => 12 + 8 * l,   priority: 20 },
  { skillId: 277, stateId: State.BladeShield,    target: 'self', duration: l => 12 + 4 * l,   priority: 50 },
  { skillId: 278, stateId: State.Venom,          target: 'self', duration: l => 12 + 2 * l,   priority: 40 },
]

const BUFF_DEF_MAP = new Map(BUFF_DEFS.map(d => [d.skillId, d]))

// Populate reverse lookups
for (const d of BUFF_DEFS) {
  STATE_TO_BUFF.set(d.stateId, d)
  SKILL_TO_STATE.set(d.skillId, d.stateId)
}

interface TrackedBuff {
  def: BuffDef
  lastCast: number       // tick when last cast
  lastSeenActive: number // tick when last polled as active
  requiresSwap: boolean  // needs CTA weapon swap
  castAttempts: number   // times cast without state activating
}

// CTA warcry skills — BC first (adds +1 to all skills, making BO/Battle Cry stronger)
// CTA grants: Battle Command (155), Battle Orders (149), Battle Cry (130)
const CTA_SKILLS = [155, 149] as const
const CTA_SKILL_SET = new Set<number>(CTA_SKILLS)

function skillLevel(skillId: number): number {
  return _getSkillLevel(skillId, 1)
}

export const Buffs = createService((game: Game) => {
  const tracked: TrackedBuff[] = []
  let initialized = false

  // ── Packet-based state tracking ──────────────────────────────────
  // Authoritative source for whether a buff is active: if we received 0xA7/0xA8
  // and haven't received 0xA9, the buff is still on — regardless of who cast it.
  const activeStates = new Map<string, ActiveState>()

  // Set of state IDs we care about (populated from BUFF_DEFS)
  const trackedStateIds = new Set(BUFF_DEFS.map(d => d.stateId))

  // Pending cast info from 0x4C — correlates skill level with upcoming state set.
  // Key: "unitType:unitGuid", Value: { skillId, skillLevel, tick }
  // Short-lived: consumed when the matching 0xA7/0xA8 arrives.
  const pendingCasts = new Map<string, { skillId: number, skillLevel: number, stateId: number, tick: number }>()

  function handlePlayerCast(data: Uint8Array) {
    // 0x4C: [op, unitType, unitGuid:u32le, skillId:u16le, skillLvl:u8, targetType:u8, targetId:u32le]
    if (data.length < 9) return
    const unitType = data[1]!
    const unitGuid = readU32LE(data, 2)
    const castSkillId = readU16LE(data, 6)
    const castSkillLvl = data[8]!

    const stateId = SKILL_TO_STATE.get(castSkillId)
    if (stateId === undefined) return

    // Store pending cast — will be matched when 0xA7/0xA8 arrives for this unit+state
    const castKey = `${unitType}:${unitGuid}`
    pendingCasts.set(castKey, {
      skillId: castSkillId,
      skillLevel: castSkillLvl,
      stateId,
      tick: getTickCount(),
    })

    game.log(`[buffs] 0x4C: unit ${unitGuid} cast skill=${castSkillId} lvl=${castSkillLvl} → state=${stateId}`)
  }

  function handleStateSet(data: Uint8Array) {
    if (data.length < 7) return
    const unitType = data[1]!
    const unitGuid = readU32LE(data, 2)
    const stateId = data[data[0] === 0xA8 ? 7 : 6]!
    if (!trackedStateIds.has(stateId)) return

    const key = stateKey(unitType, unitGuid, stateId)
    const prev = activeStates.get(key)
    const now = getTickCount()

    // Check if we have a pending cast from 0x4C that matches this state
    const castKey = `${unitType}:${unitGuid}`
    const pending = pendingCasts.get(castKey)
    let castLevel = 0
    let computedMs = 0

    if (pending && pending.stateId === stateId && (now - pending.tick) < 2000) {
      castLevel = pending.skillLevel
      pendingCasts.delete(castKey)

      // Compute duration from the observed skill level
      const def = STATE_TO_BUFF.get(stateId)
      if (def) {
        const durSec = def.duration(castLevel)
        computedMs = durSec > 0 ? durSec * 1000 : 0
        game.log(`[buffs] state ${stateId} set with lvl=${castLevel} → ${durSec}s`)
      }
    }

    activeStates.set(key, {
      stateId,
      unitType,
      unitGuid,
      setTick: now,
      endTick: 0,
      observedDuration: prev?.observedDuration ?? 0,
      skillLevel: castLevel || prev?.skillLevel || 0,
      computedDurationMs: computedMs || prev?.computedDurationMs || 0,
    })
  }

  function handleStateEnd(data: Uint8Array) {
    if (data.length < 7) return
    const unitType = data[1]!
    const unitGuid = readU32LE(data, 2)
    const stateId = data[6]!
    if (!trackedStateIds.has(stateId)) return

    const key = stateKey(unitType, unitGuid, stateId)
    const entry = activeStates.get(key)
    const now = getTickCount()

    if (entry && entry.endTick === 0) {
      entry.endTick = now
      entry.observedDuration = now - entry.setTick
    } else {
      activeStates.set(key, {
        stateId, unitType, unitGuid,
        setTick: 0, endTick: now, observedDuration: 0,
        skillLevel: 0, computedDurationMs: 0,
      })
    }
  }

  // Register packet hooks
  game.onPacket(0x4C, (data) => { handlePlayerCast(data) })
  game.onPacket(0xA7, (data) => { handleStateSet(data) })
  game.onPacket(0xA8, (data) => { handleStateSet(data) })
  game.onPacket(0xA9, (data) => { handleStateEnd(data) })

  /** Check if a state is active on a unit via packet tracking */
  function isStateActiveByPacket(unitType: number, unitGuid: number, stateId: number): boolean {
    const entry = activeStates.get(stateKey(unitType, unitGuid, stateId))
    return !!entry && entry.endTick === 0 && entry.setTick > 0
  }

  /** Get observed duration (ms) from last complete set→end cycle, 0 = unknown */
  function getObservedDuration(unitType: number, unitGuid: number, stateId: number): number {
    const entry = activeStates.get(stateKey(unitType, unitGuid, stateId))
    return entry?.observedDuration ?? 0
  }

  const mercClassIds = new Set([MonsterClassId.MercA1Rogue, MonsterClassId.MercA2Guard, MonsterClassId.MercA3IronWolf, MonsterClassId.MercA5Barb])

  /** Find merc (monster owned by player) */
  function findMerc(): Monster | undefined {
    const pid = meGetUnitId()
    for (const m of game.monsters) {
      if (m.mode === MonsterMode.Death || m.mode === MonsterMode.Dead || m.hp <= 0) continue
      if (!mercClassIds.has(m.classid)) continue
      const p = m.parent
      if (p && p.unitId === pid && p.type === 0) return m
    }
    return undefined
  }

  /** Find all allied units that could benefit from Enchant (merc + summons) */
  function findAllies(): Monster[] {
    const pid = meGetUnitId()
    const allies: Monster[] = []
    for (const m of game.monsters) {
      if (m.mode === MonsterMode.Death || m.mode === MonsterMode.Dead || m.hp <= 0) continue
      // Check if owned by player (merc + summons share this property)
      const p = m.parent
      if (p && p.unitId === pid && p.type === 0) {
        allies.push(m)
      }
    }
    return allies
  }

  function init() {
    if (initialized) return
    initialized = true

    const charClass = game.player.charclass

    // Find which buffs this character has access to
    for (const def of BUFF_DEFS) {
      const lvl = skillLevel(def.skillId)
      if (lvl < 1) continue

      // Check exclusivity — if another skill in the same group has more points, skip this one
      const group = EXCLUSIVE_GROUPS.find(g => g.includes(def.skillId))
      if (group) {
        const best = group.reduce((best, sk) => {
          const l = skillLevel(sk)
          return l > best.lvl ? { sk, lvl: l } : best
        }, { sk: -1, lvl: 0 })
        if (best.sk !== def.skillId) continue
      }

      tracked.push({
        def,
        lastCast: 0,
        lastSeenActive: 0,
        requiresSwap: false,
        castAttempts: 0,
      })
    }

    // CTA buffs for non-barbs: always register as swap buffs.
    // We can't check skill levels here (CTA is on swap weapon, not active),
    // so we register them unconditionally. refreshAll/refreshOne will swap
    // weapons and skip if skill level is 0 (no CTA equipped).
    if (charClass !== 4 /* barb */) {
      for (const skillId of CTA_SKILLS) {
        if (tracked.some(t => t.def.skillId === skillId)) continue
        const def = BUFF_DEF_MAP.get(skillId)
        if (!def) continue
        tracked.push({
          def,
          lastCast: 0,
          lastSeenActive: 0,
          requiresSwap: true,
          castAttempts: 0,
        })
      }
    }

    // Sort by priority (lower = first)
    tracked.sort((a, b) => a.def.priority - b.def.priority)

    if (tracked.length > 0) {
      game.log(`[buffs] tracking ${tracked.length}: ${tracked.map(t => t.def.skillId).join(',')}`)
    }
  }

  function isActiveOnPlayer(t: TrackedBuff): boolean {
    // Packet tracking is authoritative — if we saw the state set and no end, it's active.
    // This correctly handles buffs from other players (e.g. higher-level BO from a barb).
    const pid = meGetUnitId()
    if (isStateActiveByPacket(0, pid, t.def.stateId)) return true
    // Fallback to polling for cases where we missed the packet (e.g. state was already
    // active when we joined, before packet hooks were registered)
    return game.player.getState(t.def.stateId)
  }

  function isActiveOnUnit(unitType: number, unitId: number, stateId: number): boolean {
    if (isStateActiveByPacket(unitType, unitId, stateId)) return true
    // No fallback for non-player units (we don't have a generic getState for arbitrary units)
    return false
  }

  /**
   * After a buff expires, check if we recently had a stronger version from another player.
   * If so, wait a grace period before recasting our weaker version — gives the other
   * player time to recast theirs.
   */
  function shouldDeferToStrongerCaster(t: TrackedBuff): boolean {
    const pid = meGetUnitId()
    const entry = activeStates.get(stateKey(0, pid, t.def.stateId))
    if (!entry || entry.skillLevel === 0) return false
    const ourLevel = skillLevel(t.def.skillId)
    if (entry.skillLevel <= ourLevel) return false
    // Had a stronger buff — if it ended less than 3s ago, wait for the other player to recast
    if (entry.endTick > 0 && (getTickCount() - entry.endTick) < 3000) {
      return true
    }
    return false
  }

  function needsRefresh(t: TrackedBuff, eager = false): boolean {
    if (t.def.target === 'ally') {
      const merc = findMerc()
      if (!merc) return false
      if (isActiveOnUnit(1, merc.unitId, t.def.stateId)) return false
      return !merc.getState(t.def.stateId)
    }
    if (isActiveOnPlayer(t)) {
      t.lastSeenActive = getTickCount()
      t.castAttempts = 0
      return false
    }
    // Buff is not active — but defer if a stronger player might recast
    if (shouldDeferToStrongerCaster(t)) return false
    // Not eager (refreshOne during combat): skip CTA buffs unless expired >5s ago
    // This avoids weapon-swapping mid-combat for a buff that just fell off
    if (!eager && t.requiresSwap && t.lastCast > 0) {
      const pid = meGetUnitId()
      const entry = activeStates.get(stateKey(0, pid, t.def.stateId))
      const endTick = entry?.endTick ?? 0
      if (endTick > 0 && (getTickCount() - endTick) < 5000) return false
    }
    return true
  }

  let swapAcked = false
  game.onPacket(0x97, () => { swapAcked = true })

  function* swapWeapon() {
    // Wait for idle — server rejects swap while running/casting
    for (let i = 0; i < 25; i++) {
      if (game.player.idle) break
      yield
    }
    swapAcked = false
    game.sendPacket(new Uint8Array([0x60]))
    // Wait for server to ack the swap (0x97) — skill list updates on this packet
    for (let i = 0; i < 50; i++) {
      if (swapAcked) break
      yield
    }
    if (swapAcked) {
      game.log('[buffs] swap acked')
    } else {
      game.log('[buffs] swap timeout — 0x97 not received, idle=' + game.player.idle)
    }
    // Extra frames for client to process the new skill list
    for (let i = 0; i < 5; i++) yield
  }

  function* castSelfBuff(skillId: number) {
    // All buffs use packet path — clickAtWorld causes walking
    for (let f = 0; f < 10; f++) {
      if (game.player.idle) break
      yield
    }
    game.selectSkill(skillId)
    for (let f = 0; f < 6; f++) yield
    game.castSkillPacket(game.player.x, game.player.y)
    for (let f = 0; f < 20; f++) yield
  }

  function* castOnTarget(skillId: number, x: number, y: number) {
    for (let f = 0; f < 10; f++) {
      if (game.player.idle) break
      yield
    }
    game.selectSkill(skillId)
    for (let f = 0; f < 6; f++) yield
    game.castSkillPacket(x, y)
    for (let f = 0; f < 20; f++) yield
  }

  function allyHasBuff(ally: Monster, stateId: number): boolean {
    return isActiveOnUnit(1, ally.unitId, stateId) || ally.getState(stateId)
  }

  function* castTracked(t: TrackedBuff) {
    if (t.def.target === 'ally') {
      const allies = findAllies()
      for (const ally of allies) {
        if (allyHasBuff(ally, t.def.stateId)) continue
        game.log(`[buffs] enchanting ally classid=${ally.classid} at ${ally.x},${ally.y}`)
        yield* castOnTarget(t.def.skillId, ally.x, ally.y)
        yield
      }
    } else {
      yield* castSelfBuff(t.def.skillId)
    }
    t.lastCast = getTickCount()
    t.castAttempts++
    // If buff never activates after 3 attempts, it's probably not available (wrong CTA skill etc.)
    if (t.castAttempts >= 3 && t.lastSeenActive === 0) {
      game.log(`[buffs] removing skill=${t.def.skillId} — never activated after ${t.castAttempts} casts`)
      const idx = tracked.indexOf(t)
      if (idx >= 0) tracked.splice(idx, 1)
    }
  }

  return {
    get entries(): readonly TrackedBuff[] {
      init()
      return tracked
    },

    /** Check if a specific buff (by skill ID) is currently active on the player */
    isBuffActive(skillId: number): boolean {
      const stateId = BUFF_STATE[skillId]
      if (stateId === undefined) return false
      return game.player.getState(stateId)
    },

    /** Estimated remaining duration in seconds. 0 = not active or can't estimate. */
    estimatedRemaining(skillId: number): number {
      init()
      const t = tracked.find(e => e.def.skillId === skillId)
      if (!t) return 0
      if (t.def.target === 'self' && !isActiveOnPlayer(t)) return 0

      const pid = meGetUnitId()
      const entry = activeStates.get(stateKey(0, pid, t.def.stateId))

      // If we have packet-tracked set time, use that as the reference
      const setTick = entry?.setTick ?? t.lastCast
      if (setTick === 0) return 0

      // Priority: computed from 0x4C skill level > observed from previous cycle > formula
      const computed = entry?.computedDurationMs ?? 0
      const observed = entry?.observedDuration ?? 0
      const formulaDur = t.def.duration(skillLevel(skillId)) * 1000
      const durMs = computed > 0 ? computed : observed > 0 ? observed : formulaDur
      if (durMs === 0) return Infinity // permanent until broken

      const elapsed = getTickCount() - setTick
      return Math.max(0, (durMs - elapsed) / 1000)
    },

    /** Returns true if any tracked buff needs refresh */
    needsRefresh(): boolean {
      init()
      return tracked.some(t => needsRefresh(t))
    },

    /**
     * Cast all missing buffs. Handles CTA weapon swap, Enchant on allies, etc.
     * Best called from town before starting a run.
     */
    *refreshAll() {
      init()
      if (tracked.length === 0) return

      const missing = tracked.filter(t => needsRefresh(t, true))
      if (missing.length === 0) {
        game.log(`[buffs] all ${tracked.length} buffs active`)
        return
      }

      game.log(`[buffs] refreshing ${missing.length}/${tracked.length} buffs`)

      // Phase 1: native (non-swap) self buffs + ally buffs
      const native = missing.filter(t => !t.requiresSwap)
      for (const t of native) {
        game.log(`[buffs] casting skill=${t.def.skillId} (${t.def.target})`)
        yield* castTracked(t)
        yield
        if (t.def.target === 'self' && isActiveOnPlayer(t)) {
          t.lastSeenActive = getTickCount()
        }
      }

      // Phase 2: CTA weapon swap buffs — skip in town (pointless, buff expires before leaving)
      const swapBuffs = missing.filter(t => t.requiresSwap)
      if (swapBuffs.length > 0 && !townAreas.has(game.area)) {

        // Save current right skill to restore after swap-back (CTA sets pRightSkill
        // to a swap-weapon skill which becomes a dangling pointer after swap-back)
        const savedSkill = game.rightSkill

        game.log(`[buffs] swapping to CTA for ${swapBuffs.length} warcries`)
        yield* swapWeapon()

        for (const t of swapBuffs) {
          game.log(`[buffs] casting CTA skill=${t.def.skillId}`)
          yield* castTracked(t)
          yield
          if (isActiveOnPlayer(t)) {
            t.lastSeenActive = getTickCount()
          }
        }

        // Wait for server to finish last cast before swapping back
        for (let i = 0; i < 30; i++) yield

        yield* swapWeapon()
        // Restore right skill to fix dangling pRightSkill from CTA
        if (savedSkill > 0) game.selectSkill(savedSkill)
        game.log(`[buffs] swapped back`)
      }
    },

    /**
     * Quick refresh during gameplay. Casts one missing native buff, or does a full
     * CTA swap if warcries expired. Returns true if something was cast.
     */
    *refreshOne(): Generator<undefined, boolean, unknown> {
      init()
      if (tracked.length === 0) return false

      // Native buff first (cheaper — no weapon swap)
      const nativeMissing = tracked.find(t => !t.requiresSwap && needsRefresh(t))
      if (nativeMissing) {
        game.log(`[buffs] quick-refresh skill=${nativeMissing.def.skillId}`)
        yield* castTracked(nativeMissing)
        return true
      }

      // CTA: swap and cast all missing warcries at once
      const swapMissing = tracked.filter(t => t.requiresSwap && needsRefresh(t))
      if (swapMissing.length > 0) {
        const savedSkill = game.rightSkill
        game.log(`[buffs] CTA refresh: ${swapMissing.length} warcries`)
        yield* swapWeapon()
        for (const t of swapMissing) {
          yield* castTracked(t)
          yield
        }
        for (let i = 0; i < 30; i++) yield
        yield* swapWeapon()
        if (savedSkill > 0) game.selectSkill(savedSkill)
        return true
      }

      return false
    },

    /** Update state tracking — call per-frame from background thread */
    tick() {
      init()
      const now = getTickCount()
      for (const t of tracked) {
        if (t.def.target === 'self' && isActiveOnPlayer(t)) {
          t.lastSeenActive = now
        }
      }
    },

    /** Check if a state is active on player via packet tracking (authoritative) */
    isStateActive(stateId: number): boolean {
      return isStateActiveByPacket(0, meGetUnitId(), stateId)
    },

    /** Get the observed duration (ms) from the last complete buff cycle. 0 = unknown. */
    observedDuration(stateId: number): number {
      return getObservedDuration(0, meGetUnitId(), stateId)
    },

    /** Exposed constants */
    State,
    BUFF_STATE,
  }
})
