/**
 * Test helper for orchestration-level (generator) tests. Builds a minimal
 * `Game`-shaped object with the surface area used by `scripts/lib/*` flows
 * (shopping, npc, potions). Tests configure starting state and assert on
 * captured side-effects.
 *
 * Drive a generator with `runGenerator(gen)` — it advances frame-by-frame,
 * incrementing `_frame`, until the generator finishes or hits the safety cap.
 */

import type { Game } from "../game/index.d.js"
import { __mockNative } from "./native-stub.js"

/** Minimal item shape — matches what shopping/potions code reads. */
export interface MockItem {
  unitId: number
  code: string
  name?: string
  location: number
  quality?: number
  durability?: number
  maxdurability?: number
}

/** Minimal NPC shape used by interactNPC. */
export interface MockNpc {
  type: number
  unitId: number
  classid: number
  x: number
  y: number
  distance: number
  name?: string
  canTrade?: boolean
  canRepair?: boolean
}

export interface MockGameInit {
  area?: number
  gold?: number
  hp?: number
  hpmax?: number
  mp?: number
  mpmax?: number
  charLevel?: number
  items?: MockItem[]
  npcs?: MockNpc[]
}

export interface MockGameAPI {
  game: Game
  /** Captured `game.log` calls. */
  logs: string[]
  /** Set HP at runtime (e.g. simulate heal). */
  setHp(hp: number): void
  /** Push an item into game.items. */
  addItem(item: MockItem): void
  /** Step a generator one frame. Returns done. */
  step(gen: Generator<void>): boolean
}

/** Run a generator to completion. Caps at 1000 frames to avoid hangs. */
export function runGenerator(gen: Generator<void>, maxFrames = 1000): number {
  for (let i = 0; i < maxFrames; i++) {
    if (gen.next().done) return i
  }
  throw new Error(`runGenerator: hit ${maxFrames}-frame safety cap`)
}

export function makeMockGame(init: MockGameInit = {}): MockGameAPI {
  __mockNative.reset()

  const state = {
    area: init.area ?? 1,
    gold: init.gold ?? 0,
    hp: init.hp ?? 100,
    hpmax: init.hpmax ?? 100,
    mp: init.mp ?? 100,
    mpmax: init.mpmax ?? 100,
    charLevel: init.charLevel ?? 1,
    items: init.items ?? [],
    npcs: init.npcs ?? [],
    frame: 0,
  }
  const logs: string[] = []

  const player = {
    get hp() { return state.hp },
    get hpmax() { return state.hpmax },
    get mp() { return state.mp },
    get mpmax() { return state.mpmax },
    get x() { return 0 },
    get y() { return 0 },
    get area() { return state.area },
    get mode() { return 1 },
    get classid() { return 0 },
    get charname() { return "TestChar" },
    get charlvl() { return state.charLevel },
  }

  const game: Partial<Game> = {
    get area() { return state.area },
    get inGame() { return true },
    get charLevel() { return state.charLevel },
    get gold() { return state.gold },
    get _frame() { return state.frame },
    get player() { return player as Game["player"] },
    get items() { return state.items as unknown as Game["items"] },
    get npcs() { return state.npcs as unknown as Game["npcs"] },
    log(msg: string) { logs.push(msg) },
    sendPacket(_data: Uint8Array): void {
      // delegate to native stub so tests can inspect via __mockNative
      __mockNative.getSentPackets().push(new Uint8Array(_data))
    },
    *delay(ms: number): Generator<void> {
      const ticks = Math.ceil(ms / 40)
      for (let i = 0; i < ticks; i++) yield
    },
    *waitUntil(predicate: () => boolean, maxFrames = 150): Generator<void, boolean> {
      for (let i = 0; i < maxFrames; i++) {
        if (predicate()) return true
        yield
      }
      return false
    },
  }

  return {
    game: game as Game,
    logs,
    setHp(hp: number) { state.hp = hp },
    addItem(item: MockItem) { state.items.push(item) },
    step(gen: Generator<void>) {
      const r = gen.next()
      state.frame++
      return Boolean(r.done)
    },
  }
}
