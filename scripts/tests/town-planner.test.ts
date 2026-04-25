import { test, assert, assertEqual } from "diablo:test"
import { NpcFlags, getGroups, getNpcsForAct, actFromArea, npcByClassid } from "../lib/town/npc-flags.js"
import { Urgency } from "../lib/town/enums.js"
import { TownPlan } from "../lib/town/planner.js"
import { townActions } from "../lib/town/registry.js"
import { Area } from "diablo:game"
import type { TownAction, TownContext } from "../lib/town/action.js"

// ── Pure function tests (no game state needed) ─────────────────────

test("actFromArea maps correctly", function*(_game) {
  assertEqual(actFromArea(Area.RogueEncampment), 1)
  assertEqual(actFromArea(Area.LutGholein), 2)
  assertEqual(actFromArea(Area.KurastDocks), 3)
  assertEqual(actFromArea(Area.PandemoniumFortress), 4)
  assertEqual(actFromArea(Area.Harrogath), 5)
  assertEqual(actFromArea(Area.ChaosSanctuary), 4)  // area 108 → act 4
  assertEqual(actFromArea(Area.WorldstoneLvl2), 5)   // area 129 → act 5
})

test("getNpcsForAct returns correct NPCs per act", function*(_game) {
  const a1 = getNpcsForAct(1)
  assert(a1.length === 5, "Act 1 should have 5 NPCs, got " + a1.length)
  assert(a1.some(n => n.name === "Akara"), "Act 1 missing Akara")
  assert(a1.some(n => n.name === "Charsi"), "Act 1 missing Charsi")
  assert(a1.some(n => n.name === "Cain"), "Act 1 missing Cain")

  const a4 = getNpcsForAct(4)
  assert(a4.length === 4, "Act 4 should have 4 NPCs, got " + a4.length)
  assert(a4.some(n => n.name === "Jamella"), "Act 4 missing Jamella")
  assert(a4.some(n => n.name === "Halbu"), "Act 4 missing Halbu")
})

test("npcByClassid has all entries", function*(_game) {
  assert(npcByClassid.has(148), "Missing Akara (148)")
  assertEqual(npcByClassid.get(148)!.name, "Akara")
  assert(npcByClassid.has(405), "Missing Jamella (405)")
  assertEqual(npcByClassid.get(405)!.act, 4)
})

test("getGroups: act 1, HEAL only → Akara", function*(_game) {
  const groups = getGroups(1, NpcFlags.HEAL)
  assert(groups.length >= 1, "Expected at least 1 group")
  // Minimum cover for HEAL is 1 NPC
  assertEqual(groups[0]!.length, 1)
  assertEqual(groups[0]![0]!.name, "Akara")
})

test("getGroups: act 1, HEAL|REPAIR → Akara+Charsi or similar 2-NPC set", function*(_game) {
  const groups = getGroups(1, (NpcFlags.HEAL | NpcFlags.REPAIR) as NpcFlags)
  assert(groups.length >= 1, "Expected at least 1 group")
  // Need 2 NPCs — no single act 1 NPC has both HEAL and REPAIR
  assertEqual(groups[0]!.length, 2)
  const names = groups[0]!.map(n => n.name).sort()
  assert(names.includes("Akara") || names.includes("Charsi"),
    "Expected Akara or Charsi in cover, got " + names.join(", "))
})

test("getGroups: act 2, HEAL|REPAIR → Fara alone (she has both)", function*(_game) {
  const groups = getGroups(2, (NpcFlags.HEAL | NpcFlags.REPAIR) as NpcFlags)
  assert(groups.length >= 1, "Expected at least 1 group")
  // Fara has HEAL|REPAIR, so 1 NPC suffices
  assertEqual(groups[0]!.length, 1)
  assertEqual(groups[0]![0]!.name, "Fara")
})

test("getGroups: act 4, HEAL|REPAIR|POTS|CAIN_ID → covers all", function*(_game) {
  const flags = (NpcFlags.HEAL | NpcFlags.REPAIR | NpcFlags.POTS | NpcFlags.CAIN_ID) as NpcFlags
  const groups = getGroups(4, flags)
  assert(groups.length >= 1, "Expected at least 1 group")
  // Act 4: Jamella has HEAL|POTS, Halbu has REPAIR, Cain has CAIN_ID → 3 NPCs min?
  // Actually Jamella has HEAL|TRADE|GAMBLE|POTS|SCROLL|KEYS → covers HEAL+POTS
  // Need Halbu for REPAIR, Cain for CAIN_ID → 3 NPCs
  const cover = groups[0]!
  let covered: number = NpcFlags.NONE
  for (const npc of cover) covered |= npc.flags
  assert((covered & flags) === flags, "Cover doesn't satisfy all needed flags")
})

test("getGroups: act 4, HEAL|POTS → Jamella alone", function*(_game) {
  const flags = (NpcFlags.HEAL | NpcFlags.POTS) as NpcFlags
  const groups = getGroups(4, flags)
  assert(groups.length >= 1, "Expected at least 1 group")
  assertEqual(groups[0]!.length, 1)
  assertEqual(groups[0]![0]!.name, "Jamella")
})

test("getGroups: empty flags → no groups", function*(_game) {
  const groups = getGroups(1, NpcFlags.NONE)
  assertEqual(groups.length, 0)
})

test("getGroups: nonexistent flag in act → no groups", function*(_game) {
  // Act 1 has no STASH NPC
  const groups = getGroups(1, NpcFlags.STASH)
  assertEqual(groups.length, 0)
})

// ── Registry tests ─────────────────────────────────────────────────

test("townActions registry has all 10 actions", function*(_game) {
  assertEqual(townActions.length, 10)
  const types = townActions.map(a => a.type).sort()
  const expected = ['gamble', 'heal', 'identify', 'keys', 'pots', 'repair', 'resurrect', 'scroll', 'sell', 'stash']
  for (let i = 0; i < expected.length; i++) {
    assertEqual(types[i], expected[i], "Missing action: " + expected[i])
  }
})

test("sell depends on identify", function*(_game) {
  const sell = townActions.find(a => a.type === 'sell')!
  assert(sell.dependencies !== undefined, "sell should have dependencies")
  assert(sell.dependencies!.includes('identify'), "sell should depend on identify")
})

test("stash depends on identify and sell", function*(_game) {
  const stash = townActions.find(a => a.type === 'stash')!
  assert(stash.dependencies !== undefined, "stash should have dependencies")
  assert(stash.dependencies!.includes('identify'), "stash should depend on identify")
  assert(stash.dependencies!.includes('sell'), "stash should depend on sell")
})

// ── Mock helpers for planner tests ─────────────────────────────────
// The test runner's game object is minimal (no items/npcs/objects).
// We create a mock game-like object that satisfies TownContext.

function mockCollection() {
  return {
    find(_pred: any) { return undefined },
    filter(_pred: any) { return [] as any[] },
    *[Symbol.iterator]() {},
  }
}

function makeMockCtx(game: any): TownContext {
  return {
    game: {
      ...game,
      area: game.area,
      player: game.player,
      log: (msg: string) => game.log(msg),
      *delay(_ms: number) {},
      items: mockCollection(),
      npcs: { ...mockCollection(), closest(_p?: any) { return undefined } },
      monsters: mockCollection(),
      objects: mockCollection(),
      sendPacket(_d: any) {},
      interact(_u: any) {},
    } as any,
    move: {
      *walkTo(_x: number, _y: number) {},
      *useWaypoint(_a: number) { return false },
      *moveTo(_x: number, _y: number) {},
    },
    grading: {
      shouldPickup() { return false },
      evaluate() { return 2 },  // ItemAction.Ignore
    },
  }
}

// ── Planner tests ──────────────────────────────────────────────────

test("planner calculates without crashing", function*(game) {
  const ctx = makeMockCtx(game)
  const plan = new TownPlan(townActions, ctx)
  plan.calculate()
  game.log("  plan urgency: " + plan.urgency)
  game.log("  plan summary: " + plan.summary())
  assert(true, "planner calculated successfully")
})

test("planner produces route when HP is mocked low", function*(game) {
  // Override player to fake low HP
  const ctx = makeMockCtx(game)
  const origPlayer = ctx.game.player
  Object.defineProperty(ctx.game, 'player', {
    get() {
      return {
        ...origPlayer,
        get hp() { return 50 },
        get hpmax() { return 200 },
        get mp() { return 100 },
        get mpmax() { return 200 },
      }
    }
  })

  const plan = new TownPlan(townActions, ctx)
  plan.calculate()

  game.log("  urgency: " + plan.urgency)
  game.log("  route: " + plan.summary())

  assert(plan.urgency >= Urgency.Needed, "Low HP should trigger Needed urgency")
  assert(plan.summary().includes("heal"), "Low HP should include heal in plan")
})

test("planner dependency ordering: identify before sell", function*(game) {
  const log: string[] = []

  const fakeIdentify: TownAction = {
    type: 'identify',
    npcFlag: NpcFlags.CAIN_ID,
    check() { return Urgency.Needed },
    *run(_ctx) { log.push('identify'); return true },
  }

  const fakeSell: TownAction = {
    type: 'sell',
    npcFlag: NpcFlags.TRADE,
    dependencies: ['identify'],
    check() { return Urgency.Needed },
    *run(_ctx) { log.push('sell'); return true },
  }

  const fakeHeal: TownAction = {
    type: 'heal',
    npcFlag: NpcFlags.HEAL,
    check() { return Urgency.Needed },
    *run(_ctx) { log.push('heal'); return true },
  }

  const ctx = makeMockCtx(game)
  const plan = new TownPlan([fakeIdentify, fakeSell, fakeHeal], ctx)
  plan.calculate()
  game.log("  route: " + plan.summary())

  // Execute — NPCs won't be found so planner skips walk, but still runs tasks
  // Actually, planner does `continue` when NPC not found — tasks won't run.
  // We need to mock npcs.find to return a fake NPC for each classid.
  const fakeNpc = {
    x: 5050, y: 5050, unitId: 999, classid: 0, name: "MockNPC", distance: 5,
    canHeal: true, canRepair: true, canTrade: true, canIdentify: true, canResurrect: true,
    *heal() {}, *repair() {}, *interact() { return true }, *close() {},
    *openTrade() { return true },
  }
  ;(ctx.game as any).npcs = {
    find(_pred: any) { return fakeNpc },
    filter(_pred: any) { return [fakeNpc] },
    *[Symbol.iterator]() { yield fakeNpc },
  }

  yield* plan.execute(ctx)
  game.log("  execution order: " + log.join(" → "))

  const idIdx = log.indexOf('identify')
  const sellIdx = log.indexOf('sell')

  assert(idIdx >= 0, "identify should have run")
  assert(sellIdx >= 0, "sell should have run")
  assert(idIdx < sellIdx, "identify should run before sell, got order: " + log.join(" → "))
})

test("planner convenience-only: tasks not dropped", function*(game) {
  const fakeHeal: TownAction = {
    type: 'heal',
    npcFlag: NpcFlags.HEAL,
    check() { return Urgency.Convenience },
    *run() { return true },
  }

  const fakePots: TownAction = {
    type: 'pots',
    npcFlag: NpcFlags.POTS,
    check() { return Urgency.Convenience },
    *run() { return true },
  }

  const ctx = makeMockCtx(game)
  const plan = new TownPlan([fakeHeal, fakePots], ctx)
  plan.calculate()
  game.log("  route: " + plan.summary())
  game.log("  urgency: " + plan.urgency)

  assert(plan.urgency > Urgency.Not, "Convenience tasks should give urgency > Not")
  assert(plan.summary() !== "nothing needed",
    "Convenience-only tasks should produce a route, got: " + plan.summary())
  assert(plan.summary().includes("heal"), "heal should be in plan")
  assert(plan.summary().includes("pots"), "pots should be in plan")
})

test("planner stash appended last", function*(game) {
  const log: string[] = []

  const fakeIdentify: TownAction = {
    type: 'identify',
    npcFlag: NpcFlags.CAIN_ID,
    check() { return Urgency.Needed },
    *run() { log.push('identify'); return true },
  }

  const fakeStash: TownAction = {
    type: 'stash',
    npcFlag: NpcFlags.STASH,
    dependencies: ['identify'],
    check() { return Urgency.Needed },
    *run() { log.push('stash'); return true },
  }

  const ctx = makeMockCtx(game)
  const plan = new TownPlan([fakeStash, fakeIdentify], ctx)
  plan.calculate()
  game.log("  route: " + plan.summary())

  // Stash should be last in the summary
  const parts = plan.summary().split(' → ')
  const last = parts[parts.length - 1]!
  assert(last.includes("stash"), "Stash should be last stop, got: " + plan.summary())
})
