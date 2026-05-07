import { test } from "node:test"
import assert from "node:assert/strict"
import { ItemContainer } from "diablo:game"
import { makeMockGame } from "../../packages/sdk/test/mock-game.js"
import { countBeltPots, getBeltCapacity, needsHpPots, needsMpPots } from "./potions.js"

test("countBeltPots: empty belt", () => {
  const { game } = makeMockGame()
  const counts = countBeltPots(game)
  assert.deepEqual(counts, { hp: 0, mp: 0, rv: 0, stamina: 0, total: 0 })
})

test("countBeltPots: mixed belt is counted by code prefix", () => {
  const { game } = makeMockGame({
    items: [
      { unitId: 1, code: "hp1", location: ItemContainer.Belt },
      { unitId: 2, code: "hp3", location: ItemContainer.Belt },
      { unitId: 3, code: "mp1", location: ItemContainer.Belt },
      { unitId: 4, code: "rvs", location: ItemContainer.Belt },
      { unitId: 5, code: "vps", location: ItemContainer.Belt },
      // not in belt — should be ignored
      { unitId: 6, code: "hp1", location: ItemContainer.Inventory },
    ],
  })
  const counts = countBeltPots(game)
  assert.equal(counts.hp, 2)
  assert.equal(counts.mp, 1)
  assert.equal(counts.rv, 1)
  assert.equal(counts.stamina, 1)
  assert.equal(counts.total, 5)
})

test("getBeltCapacity: scales with charLevel proxy", () => {
  // <10 → sash (8 slots)
  assert.equal(getBeltCapacity(makeMockGame({ charLevel: 5 }).game), 8)
  // 10–19 → light/regular belt (12)
  assert.equal(getBeltCapacity(makeMockGame({ charLevel: 12 }).game), 12)
  // 20+ → heavy/plated belt (16)
  assert.equal(getBeltCapacity(makeMockGame({ charLevel: 25 }).game), 16)
})

test("needsHpPots: true when belt has fewer than half-capacity HP+rejuv", () => {
  const setup = (hpCount: number, rvCount: number) => makeMockGame({
    charLevel: 5, // capacity 8 → half = 4
    items: Array.from({ length: hpCount }, (_, i) => ({
      unitId: i, code: "hp1", location: ItemContainer.Belt,
    })).concat(Array.from({ length: rvCount }, (_, i) => ({
      unitId: 100 + i, code: "rvs", location: ItemContainer.Belt,
    }))),
  })

  assert.equal(needsHpPots(setup(0, 0).game), true,  "0 hp = needs")
  assert.equal(needsHpPots(setup(3, 0).game), true,  "3 hp = needs (< 4)")
  assert.equal(needsHpPots(setup(2, 1).game), true,  "2 hp + 1 rv = needs (rv counts)")
  assert.equal(needsHpPots(setup(2, 2).game), false, "2 hp + 2 rv = enough")
  assert.equal(needsHpPots(setup(4, 0).game), false, "4 hp = enough")
})

test("needsMpPots: true when belt has fewer than quarter-capacity MP", () => {
  const setup = (mpCount: number) => makeMockGame({
    charLevel: 5, // capacity 8 → quarter = 2
    items: Array.from({ length: mpCount }, (_, i) => ({
      unitId: i, code: "mp1", location: ItemContainer.Belt,
    })),
  })

  assert.equal(needsMpPots(setup(0).game), true)
  assert.equal(needsMpPots(setup(1).game), true)
  assert.equal(needsMpPots(setup(2).game), false)
  assert.equal(needsMpPots(setup(3).game), false)
})
