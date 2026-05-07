/**
 * Shopping: sell inventory junk + buy potions at NPC.
 */

import { type Game, ItemContainer, UiFlags, MenuOption } from "diablo:game"
import { getUIFlag, npcMenuByMenuId } from "diablo:native"
import { npcBuy, npcSell, npcSession } from "./packets.js"
import { interactNPC, dismissNPC, getAct } from "./npc.js"

// Items to KEEP (don't sell)
const KEEP_CODES = new Set([
  'tsc', 'isc', 'tbk', 'ibk', 'key', // scrolls, tomes, keys
  'vps', 'yps', 'wms',                // utility pots
  'rvs', 'rvl',                        // rejuvs
])
const KEEP_PATTERNS = [/^r[0-3][0-9]$/, /^g[a-z][a-z]$/] // runes, gems

export function shouldKeep(code: string): boolean {
  if (KEEP_CODES.has(code)) return true
  for (const p of KEEP_PATTERNS) { if (p.test(code)) return true }
  return false
}

/**
 * Open the trade UI on the currently-interacted NPC. Picks "Trade" from the
 * NPC menu by menu ID (Trade vs Trade/Repair varies per NPC); falls back to
 * an explicit npcSession packet if the menu never appears.
 */
export function* openTradeUI(game: Game, npcId: number): Generator<void, boolean> {
  if (getUIFlag(UiFlags.Shop)) return true

  if (yield* game.waitUntil(() => getUIFlag(UiFlags.Shop) || getUIFlag(UiFlags.NPCMenu), 30)) {
    if (getUIFlag(UiFlags.Shop)) return true
    if (!npcMenuByMenuId(MenuOption.Trade)) npcMenuByMenuId(MenuOption.TradeRepair)
    if (yield* game.waitUntil(() => getUIFlag(UiFlags.Shop), 30)) return true
  }

  game.sendPacket(npcSession(0, npcId))
  return yield* game.waitUntil(() => getUIFlag(UiFlags.Shop), 30)
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
    if (item.location !== ItemContainer.Inventory) continue
    if (shouldKeep(item.code)) continue
    // Sell everything else (equipment, junk)
    toSell.push(item)
  }

  if (toSell.length === 0) return

  game.log('[shop] selling ' + toSell.length + ' items')

  const npc = yield* interactNPC(game, vendorId)
  if (!npc) { game.log('[shop] vendor not found'); return }

  if (!(yield* openTradeUI(game, npc.unitId))) {
    game.log('[shop] trade UI failed to open for sell')
    return
  }

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
    if (item.location === ItemContainer.Belt) beltCount++
  }
  if (beltCount >= 8) return // belt full enough

  game.log('[shop] buying pots (belt=' + beltCount + ' gold=' + game.gold + ')')

  const npc = yield* interactNPC(game, vendorId)
  if (!npc) return

  if (!(yield* openTradeUI(game, npc.unitId))) {
    game.log('[shop] trade UI failed to open for buy')
    return
  }

  // Look for HP pots in vendor's inventory
  const vendorPots: any[] = []
  for (const item of game.items) {
    if (item.location === ItemContainer.Vendor && item.code.startsWith('hp')) {
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
