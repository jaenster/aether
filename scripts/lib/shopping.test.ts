import { test } from "node:test"
import assert from "node:assert/strict"
import { UiFlags, MenuOption } from "diablo:game"
import { __mockNative } from "../../packages/sdk/test/native-stub.js"
import { makeMockGame, runGenerator } from "../../packages/sdk/test/mock-game.js"
import { shouldKeep, openTradeUI } from "./shopping.js"

// ── shouldKeep (pure) ─────────────────────────────────────────────────

test("shouldKeep: keep TP/ID scrolls", () => {
  assert.equal(shouldKeep("tsc"), true)
  assert.equal(shouldKeep("isc"), true)
})

test("shouldKeep: keep tomes + keys", () => {
  assert.equal(shouldKeep("tbk"), true)
  assert.equal(shouldKeep("ibk"), true)
  assert.equal(shouldKeep("key"), true)
})

test("shouldKeep: keep utility pots", () => {
  assert.equal(shouldKeep("vps"), true) // stamina
  assert.equal(shouldKeep("yps"), true) // antidote
  assert.equal(shouldKeep("wms"), true) // thawing
})

test("shouldKeep: keep rejuvs", () => {
  assert.equal(shouldKeep("rvs"), true)
  assert.equal(shouldKeep("rvl"), true)
})

test("shouldKeep: keep all rune codes (r01-r39 by current regex)", () => {
  assert.equal(shouldKeep("r01"), true)  // El
  assert.equal(shouldKeep("r15"), true)  // Hel
  assert.equal(shouldKeep("r33"), true)  // Zod
  assert.equal(shouldKeep("r40"), false) // out of [0-3][0-9] range
  assert.equal(shouldKeep("rxx"), false) // non-numeric
})

test("shouldKeep: keep gems (gld, gpv, etc.)", () => {
  assert.equal(shouldKeep("gld"), true)
  assert.equal(shouldKeep("gpv"), true)
  assert.equal(shouldKeep("gza"), true)
})

test("shouldKeep: don't keep junk weapons / pots / armor", () => {
  assert.equal(shouldKeep("hax"), false)        // hand axe
  assert.equal(shouldKeep("hp1"), false)        // minor healing pot
  assert.equal(shouldKeep("mp1"), false)        // minor mana pot
  assert.equal(shouldKeep("lbt"), false)        // light boots
  assert.equal(shouldKeep("aqv"), false)        // arrows
})

// ── openTradeUI ───────────────────────────────────────────────────────

test("openTradeUI: returns true immediately if Shop UI already up", () => {
  const { game, logs } = makeMockGame()
  __mockNative.setUIFlag(UiFlags.Shop, true)

  let result: boolean | undefined
  const wrapped = (function* () { result = yield* openTradeUI(game, 1) })()
  runGenerator(wrapped)

  assert.equal(result, true)
  assert.equal(__mockNative.getMenuIdCalls().length, 0, "should not need to open menu")
  assert.equal(__mockNative.getSentPackets().length, 0, "should not need to send session packet")
  assert.deepEqual(logs, [])
})

test("openTradeUI: NPCMenu appears, picks Trade, Shop opens", () => {
  const { game } = makeMockGame()
  __mockNative.setUIFlag(UiFlags.NPCMenu, true)
  // When Trade is invoked, Shop opens
  __mockNative.setMenuIdResult(MenuOption.Trade, true,
    () => __mockNative.setUIFlag(UiFlags.Shop, true))

  let result: boolean | undefined
  const wrapped = (function* () { result = yield* openTradeUI(game, 42) })()
  runGenerator(wrapped)

  assert.equal(result, true)
  assert.deepEqual(__mockNative.getMenuIdCalls(), [MenuOption.Trade])
  assert.equal(__mockNative.getSentPackets().length, 0, "should not need fallback packet")
})

test("openTradeUI: Trade menu missing → falls back to TradeRepair", () => {
  const { game } = makeMockGame()
  __mockNative.setUIFlag(UiFlags.NPCMenu, true)
  __mockNative.setMenuIdResult(MenuOption.Trade, false)
  __mockNative.setMenuIdResult(MenuOption.TradeRepair, true,
    () => __mockNative.setUIFlag(UiFlags.Shop, true))

  let result: boolean | undefined
  const wrapped = (function* () { result = yield* openTradeUI(game, 42) })()
  runGenerator(wrapped)

  assert.equal(result, true)
  assert.deepEqual(__mockNative.getMenuIdCalls(), [MenuOption.Trade, MenuOption.TradeRepair])
})

test("openTradeUI: no menu, falls back to npcSession packet, Shop opens", () => {
  const { game } = makeMockGame()
  // Neither Shop nor NPCMenu appear in the first waitUntil window — it
  // times out, then sendPacket is called. We watch for the packet, then
  // simulate Shop opening so the second waitUntil resolves.
  let result: boolean | undefined
  const wrapped = (function* () { result = yield* openTradeUI(game, 42) })()

  for (let i = 0; i < 200; i++) {
    if (wrapped.next().done) break
    if (__mockNative.getSentPackets().length === 1 && !__mockNative.getMenuIdCalls().length) {
      __mockNative.setUIFlag(UiFlags.Shop, true)
    }
  }

  assert.equal(result, true)
  assert.equal(__mockNative.getMenuIdCalls().length, 0, "should not have invoked menu")
  assert.equal(__mockNative.getSentPackets().length, 1, "should have sent session packet")
})

test("openTradeUI: total failure → returns false", () => {
  const { game } = makeMockGame()
  // No flags, no menu, packet fallback also fails

  let result: boolean | undefined
  const wrapped = (function* () { result = yield* openTradeUI(game, 42) })()
  runGenerator(wrapped, 200)

  assert.equal(result, false)
  assert.equal(__mockNative.getSentPackets().length, 1, "should have tried session packet")
})
