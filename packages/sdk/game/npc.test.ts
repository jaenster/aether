import { test } from "node:test"
import assert from "node:assert/strict"
import { UiFlags, MenuOption } from "diablo:constants"
import { __mockNative } from "../test/native-stub.js"
import { NPC } from "./unit.js"
import { runGenerator } from "../test/mock-game.js"

test("NPC.openTrade: picks Trade by menu ID, returns true when Shop opens", () => {
  __mockNative.reset()
  const npc = new NPC(100)

  // interact() polls NPCMenu/Shop. We trigger NPCMenu after interact fires.
  __mockNative.setMenuIdResult(MenuOption.Trade, true,
    () => __mockNative.setUIFlag(UiFlags.Shop, true))

  let result: boolean | undefined
  const wrapped = (function* () { result = yield* npc.openTrade() })()

  // Step gen until interact is captured, then unblock NPCMenu
  for (let i = 0; i < 200; i++) {
    if (wrapped.next().done) break
    if (__mockNative.getInteracts().length === 1 && !__mockNative.getMenuIdCalls().length) {
      __mockNative.setUIFlag(UiFlags.NPCMenu, true)
    }
  }

  assert.equal(result, true)
  assert.equal(__mockNative.getInteracts().length, 1)
  assert.deepEqual(__mockNative.getInteracts()[0], { type: 1, unitId: 100 })
  assert.deepEqual(__mockNative.getMenuIdCalls(), [MenuOption.Trade])
})

test("NPC.openTrade: falls back to TradeRepair when Trade unavailable", () => {
  __mockNative.reset()
  const npc = new NPC(154) // Charsi-like

  __mockNative.setMenuIdResult(MenuOption.Trade, false)
  __mockNative.setMenuIdResult(MenuOption.TradeRepair, true,
    () => __mockNative.setUIFlag(UiFlags.Shop, true))

  let result: boolean | undefined
  const wrapped = (function* () { result = yield* npc.openTrade() })()

  for (let i = 0; i < 200; i++) {
    if (wrapped.next().done) break
    if (__mockNative.getInteracts().length === 1 && !__mockNative.getMenuIdCalls().length) {
      __mockNative.setUIFlag(UiFlags.NPCMenu, true)
    }
  }

  assert.equal(result, true)
  assert.deepEqual(__mockNative.getMenuIdCalls(), [MenuOption.Trade, MenuOption.TradeRepair])
})

test("NPC.openTrade: returns false if interact never sees menu/shop", () => {
  __mockNative.reset()
  const npc = new NPC(200)

  let result: boolean | undefined
  const wrapped = (function* () { result = yield* npc.openTrade() })()
  runGenerator(wrapped)

  assert.equal(result, false)
  assert.equal(__mockNative.getMenuIdCalls().length, 0, "no menu select on failed interact")
})

test("NPC.repair: interacts, picks TradeRepair, sends repair packet", () => {
  __mockNative.reset()
  const npc = new NPC(154)

  __mockNative.setMenuIdResult(MenuOption.TradeRepair, true)

  const wrapped = npc.repair()

  for (let i = 0; i < 200; i++) {
    if (wrapped.next().done) break
    // Unblock interact's waitUntil
    if (__mockNative.getInteracts().length === 1) {
      __mockNative.setUIFlag(UiFlags.NPCMenu, true)
    }
  }

  assert.equal(__mockNative.getInteracts().length, 1)
  assert.deepEqual(__mockNative.getMenuIdCalls(), [MenuOption.TradeRepair])
  assert.equal(__mockNative.getSentPackets().length, 1, "should have sent NpcRepair packet")
  assert.equal(__mockNative.getCloseCount(), 1, "should have closed dialog")
})
