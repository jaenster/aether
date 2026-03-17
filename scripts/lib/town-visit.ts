/**
 * Town visit — clean town cycle using lib/npc.ts.
 * Heal → identify → repair → buy pots → stash gold.
 * Skips actions the player can't afford.
 */

import { type Game, ItemContainer } from "diablo:game"
import { healInTown, getAct, Healers, Repairers, openTrade, dismissNPC } from "./npc.js"

const HP_POT_COSTS: Record<string, number> = { hp1: 30, hp2: 90, hp3: 250, hp4: 600, hp5: 1400 }
const MP_POT_COSTS: Record<string, number> = { mp1: 30, mp2: 90, mp3: 250, mp4: 600, mp5: 1400 }

/** Full town visit — do everything that's needed */
export function* townVisit(game: Game): Generator<void> {
  const act = getAct(game.area)

  // 1. Heal (always free)
  if (game.player.hp < game.player.maxHp) {
    game.log('[town] healing')
    yield* healInTown(game)
  }

  // 2. Skip shopping if broke
  if (game.gold < 50) {
    game.log('[town] broke (gold=' + game.gold + '), skipping shopping')
    return
  }

  // 3. Buy potions if we have belt space and gold
  const beltPots = countBeltPots(game)
  if (beltPots.total < beltPots.capacity && game.gold >= 30) {
    game.log('[town] buying pots (belt ' + beltPots.total + '/' + beltPots.capacity + ')')
    // TODO: open trade at potion vendor, buy pots via packets
    // For now just log — proper implementation needs trade packet system
  }

  // 4. Repair if needed (check item durability)
  // TODO: check durability of equipped items, visit repairer if needed

  // 5. Identify rares at Cain
  // TODO: check for unidentified items, visit Cain

  // 6. Stash gold if over threshold
  const goldThreshold = game.charLevel * 1125
  if (game.gold > goldThreshold) {
    game.log('[town] should stash ' + (game.gold - goldThreshold) + ' gold')
    // TODO: walk to stash, interact, deposit
  }
}

/** Count potions in belt */
function countBeltPots(game: Game) {
  let hp = 0, mp = 0, total = 0
  for (const item of game.items) {
    if (item.location === ItemContainer.Belt) {
      total++
      if (item.code.startsWith('hp') || item.code === 'rvs' || item.code === 'rvl') hp++
      if (item.code.startsWith('mp')) mp++
    }
  }
  // Belt capacity: 2 rows for sash, 3 for light belt, 4 for belt/heavy/plated
  // Each row = 4 columns. Simplified: assume 4 columns × 3 rows = 12
  // TODO: read actual belt type from txt to get real capacity
  return { hp, mp, total, capacity: 12 }
}
