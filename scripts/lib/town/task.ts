import type { TownAction, TownContext } from "./action.js"
import type { Urgency } from "./enums.js"
import type { NpcEntry } from "./npc-flags.js"

export interface TownTask {
  action: TownAction
  urgency: Urgency
  npc?: NpcEntry
}
