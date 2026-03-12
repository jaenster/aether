import { createService, type Game, UiFlags } from "diablo:game"
import { Config, townAreas } from "../config.js"
import { Movement } from "./movement.js"
import { findHealNpc, findRepairNpc, findNpc, NpcService, type NpcInfo } from "../lib/npcs.js"
import { npcSession, npcClose, npcRepair } from "../lib/packets.js"
import { getTown } from "../lib/waypoints.js"

export const Town = createService((game: Game, services) => {
  const cfg = services.get(Config)
  const move = services.get(Movement)

  /** Walk to an NPC in town and interact via client (visual). */
  function* goToNpc(npc: NpcInfo) {
    // Find the actual unit in the world
    const unit = game.objects.find(o => o.classid === npc.classid)
    if (!unit) {
      game.log(`[town] ${npc.name} not found in area`)
      return null
    }

    // Walk close to NPC
    yield* move.walkTo(unit.x, unit.y)

    // Client-side interact — opens NPC menu visually
    game.interact(unit)

    // Wait for NPC menu to appear
    for (let i = 0; i < 50; i++) {
      yield* game.delay(100)
      if (game.getUIFlag(UiFlags.NPCMenu) || game.getUIFlag(UiFlags.Shop)) return unit
    }

    game.log(`[town] ${npc.name} interaction timed out`)
    return null
  }

  /** Wait for shop UI to open after sending open-trade packet */
  function* waitForShop() {
    for (let i = 0; i < 30; i++) {
      yield* game.delay(100)
      if (game.getUIFlag(UiFlags.Shop)) return true
    }
    return false
  }

  /** Close any open NPC dialog */
  function* closeNpc(npcUnitId: number) {
    game.sendPacket(npcClose(1, npcUnitId))
    yield* game.delay(300)
  }

  return {
    /** Go to town for the current act. */
    *goToTown() {
      const town = getTown(game.area)
      if (game.area === town) return

      // Use town portal — we should have one active
      // For now, use waypoint to town
      yield* move.useWaypoint(town)
    },

    /** Ensure we're in town. */
    get inTown(): boolean {
      return townAreas.has(game.area)
    },

    /** Heal at NPC if health/mana is low. */
    *heal() {
      if (game.player.hp >= game.player.hpmax && game.player.mp >= game.player.mpmax) return

      const npc = findHealNpc(game.area)
      if (!npc) {
        game.log(`[town] no heal NPC in area ${game.area}`)
        return
      }

      game.log(`[town] healing at ${npc.name}`)
      const unit = yield* goToNpc(npc)
      if (!unit) return

      // Just interacting with a heal NPC heals you
      yield* game.delay(500)

      // Close dialog
      yield* closeNpc(unit.unitId)
    },

    /** Repair all items at the repair NPC. */
    *repair() {
      const npc = findRepairNpc(game.area)
      if (!npc) {
        game.log(`[town] no repair NPC in area ${game.area}`)
        return
      }

      game.log(`[town] repairing at ${npc.name}`)
      const unit = yield* goToNpc(npc)
      if (!unit) return

      // Open repair shop
      game.sendPacket(npcSession(1, unit.unitId))
      const ok: unknown = yield* waitForShop()
      if (!ok) {
        game.log(`[town] repair shop didn't open`)
        yield* closeNpc(unit.unitId)
        return
      }

      // Repair all: itemId=0, cost=0x80000000
      game.sendPacket(npcRepair(unit.unitId, 0, 0, 0x80000000 | 0))
      yield* game.delay(300)

      yield* closeNpc(unit.unitId)
      game.log(`[town] repair done`)
    },

    /** Open trade with an NPC. Returns the unit or null. */
    *openTrade(npc: NpcInfo) {
      const unit = yield* goToNpc(npc)
      if (!unit) return null

      // Send open-trade packet
      game.sendPacket(npcSession(0, unit.unitId))
      const ok: unknown = yield* waitForShop()
      if (!ok) {
        game.log(`[town] trade didn't open with ${npc.name}`)
        yield* closeNpc(unit.unitId)
        return null
      }

      return unit
    },

    /** Close the current trade/NPC interaction */
    *closeTrade(npcUnitId: number) {
      yield* closeNpc(npcUnitId)
    },

    /** Full town routine: heal, repair, then return. */
    *doTownChores() {
      if (!townAreas.has(game.area)) {
        yield* this.goToTown()
      }

      game.log(`[town] doing chores in area ${game.area}`)
      yield* this.heal()
      yield* this.repair()
      game.log(`[town] chores complete`)
    },

    /** Identify all items at Cain. */
    *identify() {
      const npc = findNpc(game.area, NpcService.Identify)
      if (!npc) {
        game.log(`[town] no identify NPC in area ${game.area}`)
        return
      }

      game.log(`[town] identifying at ${npc.name}`)
      const unit = yield* goToNpc(npc)
      if (!unit) return

      // Cain identifies automatically on interaction
      yield* game.delay(1000)
      yield* closeNpc(unit.unitId)
    },
  }
})
