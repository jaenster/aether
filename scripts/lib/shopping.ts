/**
 * Shopping: sell inventory junk + buy potions at NPC.
 */

import { type Game } from "diablo:game"
import { npcBuy, npcSell, npcSession } from "./packets.js"
import { interactNPC, dismissNPC, getAct } from "./npc.js"

const INVENTORY = 0
const BELT = 2
const VENDOR = 6  // items in vendor's shop window

// Items to KEEP (don't sell)
const KEEP_CODES = new Set([
  'tsc', 'isc', 'tbk', 'ibk', 'key', // scrolls, tomes, keys
  'vps', 'yps', 'wms',                // utility pots
  'rvs', 'rvl',                        // rejuvs
])
const KEEP_PATTERNS = [/^r[0-3][0-9]$/, /^g[a-z][a-z]$/] // runes, gems

function shouldKeep(code: string): boolean {
  if (KEEP_CODES.has(code)) return true
  for (const p of KEEP_PATTERNS) { if (p.test(code)) return true }
  return false
}

// NPC classids for selling
const sellVendors: Record<number, number> = {
  1: 154, 2: 178, 3: 253, 4: 405, 5: 511,
}

// NPC classids for potion vendors
const potVendors: Record<number, number> = {
  1: 148, 2: 178, 3: 255, 4: 405, 5: 513,
}

/** Sell junk from inventory */
export function* sellJunk(game: Game): Generator<void> {
  const act = getAct(game.area)
  const vendorId = sellVendors[act]
  if (!vendorId) return

  // Collect items to sell
  const toSell: any[] = []
  for (const item of game.items) {
    if (item.location !== INVENTORY) continue
    if (shouldKeep(item.code)) continue
    // Sell everything else (equipment, junk)
    toSell.push(item)
  }

  if (toSell.length === 0) return

  game.log('[shop] selling ' + toSell.length + ' items')

  const npc = yield* interactNPC(game, vendorId)
  if (!npc) { game.log('[shop] vendor not found'); return }

  // Open trade session
  game.sendPacket(npcSession(0, npc.unitId))
  yield* game.delay(500)

  for (const item of toSell) {
    game.log('[shop] sell ' + (item.name ?? item.code))
    game.sendPacket(npcSell(npc.unitId, item.unitId, 0, 0))
    yield* game.delay(200)
  }

  dismissNPC()
  yield* game.delay(300)
  game.log('[shop] done, gold=' + game.gold)
}

/** Buy HP potions to fill belt */
export function* buyPotions(game: Game): Generator<void> {
  if (game.gold < 30) return

  const act = getAct(game.area)
  const vendorId = potVendors[act]
  if (!vendorId) return

  // Count belt pots
  let beltCount = 0
  for (const item of game.items) {
    if (item.location === BELT) beltCount++
  }
  if (beltCount >= 8) return // belt full enough

  game.log('[shop] buying pots (belt=' + beltCount + ' gold=' + game.gold + ')')

  const npc = yield* interactNPC(game, vendorId)
  if (!npc) return

  // Open trade
  game.sendPacket(npcSession(0, npc.unitId))
  yield* game.delay(500)

  // Look for HP pots in vendor's inventory (location = VENDOR = 6)
  const vendorPots: any[] = []
  for (const item of game.items) {
    if (item.location === VENDOR && item.code.startsWith('hp')) {
      vendorPots.push(item)
    }
  }

  if (vendorPots.length === 0) {
    game.log('[shop] no pots in vendor inventory')
    dismissNPC()
    return
  }

  // Buy pots until belt is full or gold runs out
  const potsToBuy = Math.min(8 - beltCount, Math.floor(game.gold / 30))
  for (let i = 0; i < potsToBuy && vendorPots.length > 0; i++) {
    const pot = vendorPots[0]! // buy the same pot repeatedly (vendor restocks)
    game.log('[shop] buy ' + pot.code)
    game.sendPacket(npcBuy(npc.unitId, pot.unitId, 0, 0))
    yield* game.delay(200)
  }

  dismissNPC()
  yield* game.delay(300)
  game.log('[shop] bought pots, gold=' + game.gold)
}

/** Full shop cycle: sell → buy pots */
export function* shop(game: Game): Generator<void> {
  yield* sellJunk(game)
  yield* buyPotions(game)
}
