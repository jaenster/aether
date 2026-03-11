import {
  log, exitGame, inGame, getArea, getAct, getDifficulty, getTickCount,
  getUnitX, getUnitY, getUnitHP, getUnitMaxHP, getUnitMP, getUnitMaxMP,
  getUnitStat, meGetCharName, clickMap, move as nativeMove,
  selectSkill, castSkillAt, getUIFlag as nativeGetUIFlag, say as nativeSay,
  getExits as nativeGetExits, findPath as nativeFindPath,
  findPreset as nativeFindPreset, interact as nativeInteract,
} from "diablo:native"
import { __getTests } from "diablo:test"

// Minimal Game object for test runner — avoids importing diablo:game barrel
// which pulls in constants and exceeds the WS buffer.
const me = {
  get charname() { return meGetCharName() },
  get x() { return getUnitX(0, 0) },
  get y() { return getUnitY(0, 0) },
  get hp() { return getUnitHP(0, 0) },
  get hpmax() { return getUnitMaxHP(0, 0) },
  get mp() { return getUnitMP(0, 0) },
  get mpmax() { return getUnitMaxMP(0, 0) },
  getStat(stat: number, layer: number) { return getUnitStat(stat, layer) },
}

const game = {
  get inGame() { return inGame() },
  get area() { return getArea() },
  get act() { return getAct() },
  get difficulty() { return getDifficulty() },
  get tickCount() { return getTickCount() },
  get me() { return me },
  log(...args: any[]) { log(args.map((a: any) => String(a)).join(' ')) },
  getExits() {
    const raw = nativeGetExits()
    if (!raw) return []
    return raw.split(',').map(function(entry: string) {
      const parts = entry.split(':')
      return { area: parseInt(parts[0]!, 10), x: parseInt(parts[1]!, 10), y: parseInt(parts[2]!, 10) }
    })
  },
  *delay(ms: number) {
    const ticks = Math.ceil(ms / 40)
    for (let i = 0; i < ticks; i++) yield
  },
}

let started = false
let finished = false
let currentTest = 0
let currentGen: Generator<void> | null = null
let passed = 0
let failed = 0
let failedNames: string[] = []

;(globalThis as any).__onTick = function onTick() {
  if (finished) return
  if (!inGame()) return

  if (!started) {
    started = true
    const tests = __getTests()
    log("=== Aether Test Runner ===")
    log("Tests discovered: " + tests.length)
    if (tests.length === 0) {
      log("Results: 0 passed, 0 failed")
      exitGame(0)
      finished = true
      return
    }
  }

  const tests = __getTests()

  // Advance current generator
  if (currentGen) {
    try {
      const result = currentGen.next()
      if (!result.done) return // yield — wait for next tick
      // Test passed
      passed++
      log("  PASS: " + tests[currentTest]!.name)
    } catch (e: any) {
      failed++
      const name = tests[currentTest]!.name
      failedNames.push(name)
      log("  FAIL: " + name + " — " + (e.message || String(e)))
    }
    currentGen = null
    currentTest++
  }

  // Start next test
  if (currentTest < tests.length) {
    const entry = tests[currentTest]!
    try {
      currentGen = entry.fn(game as any)
    } catch (e: any) {
      failed++
      failedNames.push(entry.name)
      log("  FAIL: " + entry.name + " — " + (e.message || String(e)))
      currentGen = null
      currentTest++
    }
    return
  }

  // All tests done
  log("")
  log("Results: " + passed + " passed, " + failed + " failed")
  if (failedNames.length > 0) {
    for (const n of failedNames) {
      log("  FAILED: " + n)
    }
  }
  finished = true
  exitGame(failed > 0 ? 1 : 0)
}
