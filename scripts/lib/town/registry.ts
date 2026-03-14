import type { TownAction } from "./action.js"
import { healAction } from "./actions/heal.js"
import { repairAction } from "./actions/repair.js"
import { potsAction } from "./actions/pots.js"
import { scrollAction } from "./actions/scroll.js"
import { identifyAction } from "./actions/identify.js"
import { sellAction } from "./actions/sell.js"
import { stashAction } from "./actions/stash.js"
import { resurrectAction } from "./actions/resurrect.js"

export const townActions: TownAction[] = [
  healAction,
  repairAction,
  potsAction,
  scrollAction,
  identifyAction,
  sellAction,
  stashAction,
  resurrectAction,
]
