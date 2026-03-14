import { createService, type Game } from "diablo:game"
import { Town } from "./town.js"
import {
  beltCodes, beltSlotMap,
  HP_POT_SET, MP_POT_SET,
} from "../lib/item-data.js"

interface SupplyState {
  hpPots: number
  mpPots: number
  beltCapacity: number
  tpCount: number
  needsRepair: boolean
}

function getBeltSize(game: Game): number {
  const belt = game.items.find(i => i.location === 1 && beltCodes.has(i.code))
  if (!belt) return 4
  return beltSlotMap[belt.code] ?? 4
}

function checkSupplies(game: Game): SupplyState {
  const beltCapacity = getBeltSize(game)
  let hpPots = 0
  let mpPots = 0
  let tpCount = 0
  let needsRepair = false

  for (const item of game.items) {
    if (item.location === 2) {
      if (HP_POT_SET.has(item.code)) hpPots++
      else if (MP_POT_SET.has(item.code)) mpPots++
    }
    if (item.location === 0 && item.code === 'tbk') {
      tpCount = item.quantity
    }
    if (item.location === 1 && item.maxdurability > 0) {
      const ratio = item.durability / item.maxdurability
      if (ratio < 0.3) needsRepair = true
    }
  }

  return { hpPots, mpPots, beltCapacity, tpCount, needsRepair }
}

export const Supplies = createService((game: Game, services) => {
  const town = services.get(Town)

  function needsResupply(): boolean {
    const s = checkSupplies(game)
    const hpTarget = Math.floor(s.beltCapacity * 3 / 4)
    const mpTarget = Math.floor(s.beltCapacity * 1 / 4)

    if (s.hpPots < Math.floor(hpTarget * 0.75)) return true
    if (s.mpPots < Math.floor(mpTarget * 0.75)) return true
    if (s.tpCount < 5) return true
    if (s.needsRepair) return true
    return false
  }

  return {
    checkSupplies(): SupplyState {
      return checkSupplies(game)
    },

    needsResupply,

    /** Full resupply — delegates to the town planner which handles everything. */
    *resupply() {
      yield* town.planAndExecute()
    },

    *checkAndResupply() {
      if (!needsResupply()) return
      yield* this.resupply()
    },
  }
})
