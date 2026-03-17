/**
 * Potion management: counting, drinking, buying.
 * Belt layout: 4 columns, rows depend on belt type (2-4).
 */

import { type Game, ItemContainer, createScript } from "diablo:game"
import { getUnitStat } from "diablo:native"

const HP_POTS = new Set(['hp1', 'hp2', 'hp3', 'hp4', 'hp5', 'rvs', 'rvl'])
const MP_POTS = new Set(['mp1', 'mp2', 'mp3', 'mp4', 'mp5', 'rvs', 'rvl'])
const STAMINA_POT = 'vps'

// Best HP pot by char level
function bestHpPot(level: number): string {
  if (level >= 25) return 'hp4'
  if (level >= 17) return 'hp3'
  if (level >= 9) return 'hp2'
  return 'hp1'
}

function bestMpPot(level: number): string {
  if (level >= 25) return 'mp4'
  if (level >= 17) return 'mp3'
  if (level >= 9) return 'mp2'
  return 'mp1'
}

/** Count potions in belt by type */
export function countBeltPots(game: Game) {
  let hp = 0, mp = 0, rv = 0, stamina = 0, total = 0
  for (const item of game.items) {
    if (item.location !== ItemContainer.Belt) continue
    total++
    const code = item.code
    if (code.startsWith('hp')) hp++
    else if (code.startsWith('mp')) mp++
    else if (code === 'rvs' || code === 'rvl') rv++
    else if (code === 'vps') stamina++
  }
  return { hp, mp, rv, stamina, total }
}

/** Get belt capacity (4 columns × rows). Rows from belt item type. */
export function getBeltCapacity(game: Game): number {
  // Default: 4 columns × 2 rows = 8 (sash)
  // Light belt = 12, belt = 12, heavy belt = 16, plated belt = 16
  // Read from equipped belt item's belt rows stat
  // Simplified: check char level as proxy
  const level = game.charLevel
  if (level >= 20) return 16  // likely have a belt by now
  if (level >= 10) return 12
  return 8
}

/** Does the player need HP potions? */
export function needsHpPots(game: Game): boolean {
  const pots = countBeltPots(game)
  const capacity = getBeltCapacity(game)
  return pots.hp + pots.rv < Math.floor(capacity / 2) // half belt should be HP
}

/** Does the player need MP potions? */
export function needsMpPots(game: Game): boolean {
  const pots = countBeltPots(game)
  const capacity = getBeltCapacity(game)
  return pots.mp < Math.floor(capacity / 4) // quarter belt MP
}

/** Drink an HP potion from belt */
export function drinkHpPot(game: Game): boolean {
  for (const item of game.items) {
    if (item.location === ItemContainer.Belt && HP_POTS.has(item.code)) {
      game.clickItem(0, item.unitId)
      return true
    }
  }
  return false
}

/** Drink an MP potion from belt */
export function drinkMpPot(game: Game): boolean {
  for (const item of game.items) {
    if (item.location === ItemContainer.Belt && MP_POTS.has(item.code)) {
      game.clickItem(0, item.unitId)
      return true
    }
  }
  return false
}

/** Background thread: drink HP pot when low, MP pot when low */
export const PotionDrinker = createScript(function*(game, _svc) {
  let lastHpDrink = 0
  let lastMpDrink = 0

  while (true) {
    yield
    if (!game.inGame || game.player.hp <= 0) continue

    const area = game.player.area
    if (area === 1 || area === 40 || area === 75 || area === 103 || area === 109) continue // town

    // HP pot at 30% HP (1s cooldown)
    if (game.player.hp < game.player.maxHp * 0.3 && game._frame - lastHpDrink > 25) {
      if (drinkHpPot(game)) {
        lastHpDrink = game._frame
      }
    }

    // MP pot at 15% MP (2s cooldown)
    if (game.player.mp < game.player.mpmax * 0.15 && game._frame - lastMpDrink > 50) {
      if (drinkMpPot(game)) {
        lastMpDrink = game._frame
      }
    }
  }
})
