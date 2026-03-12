import { createService, type Game, type NPC, UiFlags } from "diablo:game"
import { Config, townAreas } from "../config.js"
import { Movement } from "./movement.js"
import { getTown } from "../lib/waypoints.js"
import { npcClose } from "../lib/packets.js"

export const Town = createService((game: Game, services) => {
  const cfg = services.get(Config)
  const move = services.get(Movement)

  return {
    *goToTown() {
      const town = getTown(game.area)
      if (game.area === town) return
      yield* move.useWaypoint(town)
    },

    get inTown(): boolean {
      return townAreas.has(game.area)
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

      // If this NPC also heals (e.g. Fara), heal first
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
      // Use a temporary NPC wrapper to close
      const npc = game.npcs.find(n => n.unitId === npcUnitId)
      if (npc) {
        yield* npc.close()
      }
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
      const npc = game.npcs.find(n => n.canIdentify)
      if (!npc) {
        game.log(`[town] no identify NPC in area ${game.area}`)
        return
      }

      game.log(`[town] identifying at ${npc.name}`)
      yield* move.walkTo(npc.x, npc.y)
      yield* npc.interact()
      // Cain identifies automatically on interaction
      yield* game.delay(1000)
      yield* npc.close()
    },
  }
})
