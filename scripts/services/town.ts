import { createService, type Game, type NPC, UiFlags, Area, ItemContainer, ObjectClassId } from "diablo:game"
import { Config, townAreas } from "../config.js"
import { Movement } from "./movement.js"
import { ItemGrading } from "../lib/item/evaluator.js"
import { getTown } from "../lib/waypoints.js"
import { npcClose, useItem } from "../lib/packets.js"
import { TownPlan } from "../lib/town/planner.js"
import { townActions } from "../lib/town/registry.js"
import { Urgency } from "../lib/town/enums.js"
import type { TownContext } from "../lib/town/action.js"
import { HP_POT_SET, MP_POT_SET, RV_POT_SET } from "../lib/item-data.js"

export const Town = createService((game: Game, services) => {
  const cfg = services.get(Config)
  const move = services.get(Movement)
  const grading = services.get(ItemGrading)

  function makeContext(): TownContext {
    return { game, move, grading }
  }

  const urgencyNames = ['Not', 'Convenience', 'Needed', 'TownVisitWorthy']

  /** Pre-calculate the town plan and return it (without going to town). */
  function assessPlan(): TownPlan {
    const ctx = makeContext()

    // Log each action's urgency
    const details: string[] = []
    for (const action of townActions) {
      const u = action.check(ctx)
      if (u > Urgency.Not) details.push(`${action.type}=${urgencyNames[u]}`)
    }
    if (details.length > 0) {
      game.log(`[town:assess] ${details.join(', ')}`)
    } else {
      game.log(`[town:assess] all checks passed — nothing needed`)
    }
    const plan = new TownPlan(townActions, ctx)
    plan.calculate()
    return plan
  }

  return {
    *goToTown(act?: number) {
      const town = getTown(game.area)
      if (game.area !== town) {
        // Use TP tome/scroll via packet 0x20 (use item at location)
        const tpTome = game.items.find(i => i.location === ItemContainer.Inventory && (i.code === 'tbk' || i.code === 'tsc'))
        if (!tpTome) {
          game.log(`[town] no TP tome or scroll — falling back to waypoint`)
          yield* move.useWaypoint(town)
          return
        }
        game.log(`[town] TP to town`)
        game.sendPacket(useItem(tpTome.unitId, game.player.x, game.player.y))

        // Wait for portal to spawn
        yield* game.delay(500)
        let portal = null
        for (let attempt = 0; attempt < 20; attempt++) {
          portal = game.objects.find(o => o.classid === ObjectClassId.TownPortal && o.name === game.player.charname)
          if (portal) break
          yield* game.delay(100)
        }

        if (!portal) {
          game.log(`[town] portal didn't spawn, using waypoint`)
          yield* move.useWaypoint(town)
          return
        }

        game.interact(portal)
        yield* game.waitForArea(town)
      }

      // Switch acts if requested
      if (act && act >= 1 && act <= 5) {
        const townAreas = [0, Area.RogueEncampment, Area.LutGholein, Area.KurastDocks, Area.PandemoniumFortress, Area.Harrogath]
        const targetTown = townAreas[act]!
        if (game.area !== targetTown) {
          yield* move.useWaypoint(targetTown)
        }
      }
    },

    get inTown(): boolean {
      return townAreas.has(game.area)
    },

    /** Full town visit: TP to town, do chores, TP back. Skips if nothing needed. */
    *visitTown() {
      if (townAreas.has(game.area)) {
        yield* this.planAndExecute()
        return
      }

      // Check before TPing — skip the whole trip if nothing to do
      const plan = assessPlan()
      if (plan.urgency === Urgency.Not) {
        game.log(`[town] skipping — nothing needed`)
        return
      }

      const preArea = game.area

      // Go to town
      yield* this.goToTown()

      // Execute the pre-calculated plan (re-calculate in town for accurate NPC distances)
      yield* this.planAndExecute()

      // Return via portal
      const returnPortal = game.objects.find(o => o.classid === ObjectClassId.TownPortal && o.name === game.player.charname)
      if (returnPortal) {
        game.log(`[town] returning to area ${preArea}`)
        yield* move.walkTo(returnPortal.x, returnPortal.y)
        game.interact(returnPortal)
        yield* game.waitForArea(preArea)
      } else {
        game.log(`[town] return portal not found`)
      }
    },

    /** Plan and execute all needed town tasks using the route optimizer. */
    *planAndExecute() {
      this.clearBelt()

      const plan = assessPlan()
      if (plan.urgency === Urgency.Not) {
        game.log(`[town] nothing needed`)
        return
      }

      if (!townAreas.has(game.area)) {
        yield* this.goToTown()
      }

      // Re-calculate in town for accurate NPC distances
      const ctx = makeContext()
      const townPlan = new TownPlan(townActions, ctx)
      townPlan.calculate()

      if (townPlan.urgency === Urgency.Not) {
        game.log(`[town] nothing needed`)
        return
      }

      game.log(`[town] plan: ${townPlan.summary()}`)
      yield* townPlan.execute(ctx)
      game.log(`[town] plan complete`)
    },

    /** Full town routine — delegates to the planner. */
    *doTownChores() {
      yield* this.planAndExecute()
    },

    /** Remove wrong potion types from belt columns.
     *  Belt layout: columns 0-1 = HP, column 2 = MP, column 3 = RV (rejuv). */
    clearBelt() {
      let cleared = 0
      for (const item of game.items) {
        if (item.location !== ItemContainer.Belt) continue
        // x coordinate mod 4 gives the column
        const col = item.x % 4
        const isHp = HP_POT_SET.has(item.code)
        const isMp = MP_POT_SET.has(item.code)
        const isRv = RV_POT_SET.has(item.code)

        let wrong = false
        if (col <= 1) {
          // HP columns — only HP and RV are acceptable
          wrong = isMp
        } else if (col === 2) {
          // MP column
          wrong = isHp
        } else {
          // RV column — only RV acceptable, HP/MP wrong
          wrong = isHp || isMp
        }

        if (wrong) {
          // Use the potion (drink it) to clear it from belt
          game.interact(item)
          cleared++
        }
      }
      if (cleared > 0) {
        game.log(`[town] cleared ${cleared} wrong pots from belt`)
      }
    },

    /** Heal at the nearest heal NPC if health/mana is low. */
    *heal() {
      if (game.player.hp >= game.player.hpmax && game.player.mp >= game.player.mpmax) return

      // Find heal NPC — may need to walk closer to load her
      let npc = game.npcs.find(n => n.canHeal)
      if (!npc) {
        // NPC not loaded — try walking toward known healer presets
        // Healers: Akara=148(A1), Fara=178(A2), Ormus=255(A3), Jamella=405(A4), Malah=513(A5)
        const healerClassIds = [148, 178, 255, 405, 513]
        for (const cid of healerClassIds) {
          const pos = game.findPreset(1, cid) // type 1 = monster preset
          if (pos) {
            game.log(`[town:heal] walking to healer preset cid=${cid} at ${pos.x},${pos.y}`)
            yield* move.walkTo(pos.x, pos.y)
            yield* game.delay(500)
            npc = game.npcs.find(n => n.canHeal)
            if (npc) break
          }
        }
      }

      if (!npc) {
        game.log(`[town] no heal NPC found in area ${game.area}`)
        return
      }

      game.log(`[town:heal] healing at ${npc.name} (hp=${game.player.hp}/${game.player.hpmax})`)
      yield* move.walkTo(npc.x, npc.y)
      game.interact(npc)
      yield* game.delay(500)
      // Interacting with a healer NPC auto-heals. Close the dialog.
      game.log(`[town:heal] done (hp=${game.player.hp}/${game.player.hpmax})`)
    },

    /** Repair all items at the nearest repair NPC. */
    *repair() {
      const npc = game.npcs.find(n => n.canRepair)
      if (!npc) {
        game.log(`[town] no repair NPC found in area ${game.area}`)
        return
      }

      game.log(`[town] repair at ${npc.name}`)
      yield* move.walkTo(npc.x, npc.y)

      if (npc.canHeal && (game.player.hp < game.player.hpmax || game.player.mp < game.player.mpmax)) {
        yield* npc.heal()
      }

      yield* npc.repair()
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

      yield* move.walkTo(npc.x, npc.y)
      yield* npc.interact()
      yield* game.delay(1000)
      yield* npc.close()
    },
  }
})
