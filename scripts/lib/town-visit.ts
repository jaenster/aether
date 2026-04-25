/**
 * Town visit — clean wrapper around existing town service + npc helpers.
 */

import { type Game } from "diablo:game"
import { healInTown, getAct } from "./npc.js"
import { autoEquip } from "./auto-equip.js"
import { shop } from "./shopping.js"

/** Full town visit: heal → sell junk → buy pots → equip upgrades */
export function* townVisit(game: Game): Generator<void> {
  // 1. Heal (always free)
  if (game.player.hp < game.player.maxHp || game.player.mp < game.player.mpmax) {
    yield* healInTown(game)
  }

  // 2. Sell junk + buy potions
  yield* shop(game)

  // 3. Auto-equip any inventory upgrades
  yield* autoEquip(game)
}
