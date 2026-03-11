import { log, exitGame, inGame } from "diablo:native"
import { Game } from "../game/game.js"
import { __getTests } from "diablo:test"

const game = new Game()

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
      currentGen = entry.fn(game)
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
