import type { Monster } from "diablo:game"

export interface Pos { x: number; y: number }

/** Describes a potential action: cast skillId from casterPos at targetPos */
export interface ActionScore {
  skillId: number
  /** Where to cast from (might require teleport) */
  casterPos: Pos
  /** Where to aim the skill */
  targetPos: Pos
  /** Total useful damage per frame (overkill-capped, mana-weighted) */
  dpsPerFrame: number
  /** Damage to the primary target only */
  primaryDmg: number
  /** Number of monsters expected to be hit */
  monstersHit: number
  /** Frames cost: cast time + teleport time if repositioning */
  frameCost: number
  /** Mana cost of this cast */
  manaCost: number
  /** Whether this requires repositioning (teleport) */
  needsReposition: boolean
}

export interface DebuffConfig {
  skillId: number
  /** State ID to check — skip if monster already has this state */
  checkState?: number
  /** Min effort-reduction factor to justify casting (default 0.5 = halves effort) */
  minBenefit?: number
  /** Duration in frames — don't recast within this window */
  duration?: number
}

export type SkillProjectile = 'stops' | 'pierces' | 'nova' | 'ground_aoe' | 'melee'

export interface AttackOptions {
  maxCasts?: number
  killRange?: number
  /** Debuff skills to consider before attacking */
  debuffs?: DebuffConfig[]
  /** Filter skills — return false to exclude */
  skillFilter?: (skillId: number) => boolean
  /** Called before each cast. Return false to abort the attack loop. */
  shouldContinue?: () => boolean

  // --- targeting ---
  /** Sort monsters by priority. Lower return = higher priority. Default: closest. */
  priority?: (a: Monster, b: Monster) => number
  /** Spatial filter — return false to exclude monster from consideration. */
  spatialFilter?: (m: Monster) => boolean
  /** Pick which monster to kill next from the filtered set. Returning undefined = use default. */
  focusTarget?: (monsters: Monster[]) => Monster | undefined
  /** Urgency multiplier per monster based on group context. Default 1.0. */
  groupModifier?: (target: Monster, nearby: Monster[]) => number

  /** Enable combat debug snapshots. true = log to game.log, function = custom handler. */
  debugCombat?: boolean | ((snap: CombatSnapshot) => void)
}

// --- Pre-attack (spawn prediction) types ---

export interface SpawnEvent {
  pos: Pos
  classId: number
  framesUntilSpawn: number
}

export type PreAttackAction =
  | { type: 'cast', skill: number, x: number, y: number }
  | { type: 'reposition', x: number, y: number }
  | { type: 'wait' }

// --- Combat debug / replay types ---

export interface MonsterSnapshot {
  unitId: number
  classid: number
  x: number
  y: number
  hp: number
  hpmax: number
  mode: number
  spectype: number
  resists: Record<string, number>
  blocked: boolean
  inFilter: boolean
}

export interface CombatSnapshot {
  tick: number
  casterPos: Pos
  casterHp: number
  casterMp: number
  monsters: MonsterSnapshot[]
  rankedActions: ActionScore[]
  chosen: ActionScore | null
  filters: string[]
  primaryTarget: { unitId: number, classid: number, hp: number } | undefined
}
