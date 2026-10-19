import { test, assert } from "diablo:test"
import { UiFlags } from "diablo:constants"
import type { Game, NPC } from "diablo:game"
import { shouldKeep, openTradeUI } from "../lib/shopping.js"
import { townAreas } from "../config.js"
import { NpcFlags, actFromArea, getNpcsForAct } from "../lib/town/npc-flags.js"

// ── Pure functions ─────────────────────────────────────────────

test("shouldKeep: scrolls/tomes/keys", function*(_game) {
  assert(shouldKeep("tsc"), "TP scroll should be kept")
  assert(shouldKeep("isc"), "ID scroll should be kept")
  assert(shouldKeep("tbk"), "TP tome should be kept")
  assert(shouldKeep("ibk"), "ID tome should be kept")
  assert(shouldKeep("key"), "key should be kept")
})

test("shouldKeep: utility pots + rejuvs", function*(_game) {
  assert(shouldKeep("vps"), "stamina pot should be kept")
  assert(shouldKeep("yps"), "antidote should be kept")
  assert(shouldKeep("wms"), "thawing pot should be kept")
  assert(shouldKeep("rvs"), "rejuv should be kept")
  assert(shouldKeep("rvl"), "full rejuv should be kept")
})

test("shouldKeep: runes + gems", function*(_game) {
  assert(shouldKeep("r01"), "El rune should be kept")
  assert(shouldKeep("r33"), "Zod rune should be kept")
  assert(shouldKeep("gld"), "diamond should be kept")
  assert(shouldKeep("gpv"), "perfect ruby should be kept")
})

test("shouldKeep: rejects junk weapons/pots/armor", function*(_game) {
  assert(!shouldKeep("hax"), "hand axe should be sold")
  assert(!shouldKeep("hp1"), "minor healing pot should be sold")
  assert(!shouldKeep("mp1"), "minor mana pot should be sold")
  assert(!shouldKeep("aqv"), "arrows should be sold")
})

// ── Live game tests ────────────────────────────────────────────
// game.npcs only holds units in the rooms the client has loaded around the
// player, so a character that joins in a corner of town sees no trader.
// Each live test first walks the character into range of one of the act's
// traders, located through the level's NPC preset units.

function closestTrader(game: Game): NPC | undefined {
  return game.npcs.closest(n => n.canTrade)
}

/** Walk until a trade-capable NPC is loaded; returns it or undefined. */
function* approachTrader(game: Game): Generator<void, NPC | undefined> {
  const visible = closestTrader(game)
  if (visible) return visible

  assert(townAreas.has(game.area), "Character must be in town, area=" + game.area)

  const px = game.player.x, py = game.player.y
  const spots: Array<{ name: string, x: number, y: number, d: number }> = []
  for (const npc of getNpcsForAct(actFromArea(game.area))) {
    if ((npc.flags & NpcFlags.TRADE) === 0) continue
    const pos = game.findPreset(1, npc.classid)
    game.log("  trader " + npc.name + " (" + npc.classid + ") preset " +
      (pos ? pos.x + "," + pos.y : "none"))
    if (!pos) continue
    spots.push({ name: npc.name, x: pos.x, y: pos.y, d: Math.hypot(pos.x - px, pos.y - py) })
  }
  spots.sort((a, b) => a.d - b.d)

  for (const spot of spots) {
    game.log("  walking to " + spot.name + " at " + spot.x + "," + spot.y + " from " +
      game.player.x + "," + game.player.y)
    yield* game.moveTo(spot.x, spot.y)
    if (yield* game.waitUntil(() => closestTrader(game) !== undefined, 50)) break
  }
  return closestTrader(game)
}

test("game.npcs has a trade-capable NPC nearby", function*(game) {
  yield* approachTrader(game)
  const trader = game.npcs.find(n => n.canTrade)
  assert(trader, "Expected a trade-capable NPC visible in town")
  game.log("  trader classid=" + trader.classid + " at (" + trader.x + "," + trader.y + ")")
})

test("openTrade opens Shop UI at nearest trader", function*(game) {
  const trader = yield* approachTrader(game)
  assert(trader, "No trade NPC found in town")
  game.log("  trader classid=" + trader.classid + " dist=" + Math.round(trader.distance))

  const opened = yield* trader.openTrade()
  assert(opened, "openTrade returned false (dist=" + Math.round(trader.distance) + ")")
  assert(game.getUIFlag(UiFlags.Shop), "Shop UI should be set after openTrade")

  yield* trader.close()
  assert(!game.getUIFlag(UiFlags.Shop), "Shop UI should be closed after close()")
  assert(!game.getUIFlag(UiFlags.NPCMenu), "NPCMenu should be closed after close()")
})

test("openTradeUI helper: returns true immediately if Shop already open", function*(game) {
  const trader = yield* approachTrader(game)
  assert(trader, "No trade NPC found")

  // Open trade first (real interaction)
  const opened = yield* trader.openTrade()
  assert(opened, "Pre-condition: openTrade should succeed")

  // Now openTradeUI should short-circuit
  const result = yield* openTradeUI(game, trader.unitId)
  assert(result, "openTradeUI should return true when Shop already open")

  yield* trader.close()
})
