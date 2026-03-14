import { createService, type Game, type NPC, UiFlags } from "diablo:game"
import { Config, townAreas } from "../config.js"
import { Movement } from "./movement.js"
import { ItemGrading } from "../lib/item/evaluator.js"
import { getTown } from "../lib/waypoints.js"
import { npcClose } from "../lib/packets.js"
import { TownPlan } from "../lib/town/planner.js"
import { townActions } from "../lib/town/registry.js"
import { Urgency } from "../lib/town/enums.js"
import type { TownContext } from "../lib/town/action.js"

export const Town = createService((game: Game, services) => {
  const cfg = services.get(Config)
  const move = services.get(Movement)
  const grading = services.get(ItemGrading)

  function makeContext(): TownContext {
    return { game, move, grading }
  }

  return {
    *goToTown() {
      const town = getTown(game.area)
      if (game.area === town) return
      yield* move.useWaypoint(town)
    },

    get inTown(): boolean {
      return townAreas.has(game.area)
    },

    /** Plan and execute all needed town tasks using the route optimizer. */
    *planAndExecute() {
      if (!townAreas.has(game.area)) {
        yield* this.goToTown()
      }

      const ctx = makeContext()
      const plan = new TownPlan(townActions, ctx)
      plan.calculate()

      if (plan.urgency === Urgency.Not) {
        game.log(`[town] nothing needed`)
        return
      }

      game.log(`[town] plan: ${plan.summary()}`)
      yield* plan.execute(ctx)
      game.log(`[town] plan complete`)
    },

    /** Full town routine — delegates to the planner. */
    *doTownChores() {
      yield* this.planAndExecute()
    },

    /** Heal at the nearest heal NPC if health/mana is low. */
    *heal() {
      if (game.player.hp >= game.player.hpmax && game.player.mp >= game.player.mpmax) return

      const npc = game.npcs.find(n => n.canHeal)
      if (!npc) {
        game.log(`[town] no heal NPC found in area ${game.area}`)
        return
      }

      game.log(`[town] healing at ${npc.name} cls=${npc.classid} dist=${npc.distance|0} (hp=${game.player.hp}/${game.player.hpmax} mp=${game.player.mp}/${game.player.mpmax})`)
      yield* move.walkTo(npc.x, npc.y)
      game.log(`[town] walked to ${npc.name}, dist=${npc.distance|0}`)
      yield* npc.heal()
      game.log(`[town] healed hp=${game.player.hp}/${game.player.hpmax} mp=${game.player.mp}/${game.player.mpmax}`)
    },

    /** Repair all items at the nearest repair NPC. */
    *repair() {
      const npc = game.npcs.find(n => n.canRepair)
      if (!npc) {
        game.log(`[town] no repair NPC found in area ${game.area}`)
        return
      }

      game.log(`[town] repairing at ${npc.name}`)
      yield* move.walkTo(npc.x, npc.y)

      if (npc.canHeal && (game.player.hp < game.player.hpmax || game.player.mp < game.player.mpmax)) {
        yield* npc.heal()
      }

      yield* npc.repair()
      game.log(`[town] repair done`)
    },

    /** Open trade with an NPC. Returns the NPC or null. */
    *openTrade(pred: (n: NPC) => boolean) {
      const npc = game.npcs.find(pred)
      if (!npc) {
        game.log(`[town] no matching trade NPC found`)
        return null
      }

      yield* move.walkTo(npc.x, npc.y)
      const ok = yield* npc.openTrade()
      if (!ok) {
        game.log(`[town] trade didn't open with ${npc.name}`)
        yield* npc.close()
        return null
      }
      return npc
    },

    *closeTrade(npcUnitId: number) {
      const npc = game.npcs.find(n => n.unitId === npcUnitId)
      if (npc) {
        yield* npc.close()
      }
    },

    /** Identify all items at Cain. */
    *identify() {
      const npc = game.npcs.find(n => n.canIdentify)
      if (!npc) {
        game.log(`[town] no identify NPC in area ${game.area}`)
        return
      }

      game.log(`[town] identifying at ${npc.name}`)
      yield* move.walkTo(npc.x, npc.y)
      yield* npc.interact()
      yield* game.delay(1000)
      yield* npc.close()
    },
  }
})
