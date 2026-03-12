import type { Monster } from "diablo:game"

export interface Pos { x: number; y: number }

/** Describes a potential action: cast skillId from casterPos at targetPos */
export interface ActionScore {
  skillId: number
  /** Where to cast from (might require teleport) */
  casterPos: Pos
  /** Where to aim the skill */
  targetPos: Pos
  /** Total damage-per-frame across all monsters hit */
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

export interface AttackOptions {
  maxCasts?: number
  killRange?: number
  /** Debuff skills to consider before attacking */
  debuffs?: DebuffConfig[]
  /** Filter skills — return false to exclude */
  skillFilter?: (skillId: number) => boolean
  /** Custom target priority — lower = higher priority. Default: closest */
  priority?: (a: Monster, b: Monster) => number
  /** Called before each cast. Return false to abort the attack loop. */
  shouldContinue?: () => boolean
}
