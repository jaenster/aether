import type { Game, ItemUnit } from "diablo:game"
import type { NpcFlags } from "./npc-flags.js"
import type { Urgency } from "./enums.js"

export interface TownContext {
  game: Game
  move: {
    walkTo(x: number, y: number): Generator<void>
    useWaypoint(destArea: number): Generator<void, boolean>
    moveTo(x: number, y: number): Generator<void>
  }
  grading: {
    shouldPickup(item: ItemUnit): boolean
    evaluate(item: ItemUnit): number
  }
}

export interface TownAction {
  /** Unique identifier for this action (used for dependency resolution) */
  type: string
  /** Which NPC capability this action requires */
  npcFlag: NpcFlags
  /** Whether this action needs the NPC's trade window open.
   *  The planner opens trade once for all needsTrade tasks at a stop. */
  needsTrade?: boolean
  /** Assess urgency — called during planning */
  check(ctx: TownContext): Urgency
  /** Execute the action. The planner has already walked near the assigned NPC.
   *  npcClassid is the classid of the NPC chosen by the planner (-1 for stash).
   *  If needsTrade is set, trade window is already open — do NOT open/close trade. */
  run(ctx: TownContext, npcClassid: number): Generator<void, boolean>
  /** Action types that must complete before this one */
  dependencies?: string[]
}
