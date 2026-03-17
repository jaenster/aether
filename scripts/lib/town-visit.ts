/**
 * Town visit — clean wrapper around existing town service + npc helpers.
 */

import { type Game } from "diablo:game"
import { healInTown, getAct } from "./npc.js"
import { autoEquip } from "./auto-equip.js"

/** Full town visit: heal → equip upgrades → (full chores if gold available) */
export function* townVisit(game: Game): Generator<void> {
  // 1. Heal (always free)
  if (game.player.hp < game.player.maxHp) {
    yield* healInTown(game)
  }

  // 2. Auto-equip any inventory upgrades
  yield* autoEquip(game)

  // Full shopping/repair/identify handled by Town.doTownChores when gold > 0
  // This function is the minimal "just heal and go" version for early game
}
