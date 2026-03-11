import { game } from "./runtime.js"
import { ServiceContainer } from "./service.js"
import { __getTests, AssertionError } from "diablo:test"
import { log as nativeLog, exitGame } from "diablo:native"

const __g = Function('return this')()
let runnerGenerator: Generator<void> | null = null

function* runAllTests(): Generator<void> {
  // Wait until we're in game
  while (!game.inGame) yield

  const tests = __getTests()
  const total = tests.length
  let passed = 0
  let failed = 0

  nativeLog("=== Test Run: " + total + " tests ===")

  for (const t of tests) {
    nativeLog("[RUN]  " + t.name)
    const container = new ServiceContainer(game)
    try {
      yield* t.fn(game, container)
      nativeLog("[PASS] " + t.name)
      passed++
    } catch (e) {
      const msg = e instanceof AssertionError ? e.message : String(e)
      nativeLog("[FAIL] " + t.name + " \u2014 " + msg)
      failed++
    }
    // One tick pause between tests
    yield
  }

  nativeLog("=== Results: " + passed + "/" + total + " passed, " + failed + " failed ===")
}

// Override __onTick set by runtime.ts (which is a no-op until __setRoot is called).
// Since test-runner.ts imports runtime.ts, runtime evaluates first, then we overwrite.
__g.__onTick = () => {
  if (!runnerGenerator) {
    runnerGenerator = runAllTests()
  }
  try {
    const result = runnerGenerator.next()
    if (result.done) {
      nativeLog("Test run complete.")
      runnerGenerator = null
      // Exit the game process — CI and headless runs need a clean shutdown
      exitGame()
    }
  } catch (e) {
    nativeLog("Runner error: " + String(e))
    runnerGenerator = null
    __g.__onTick = () => {}
  }
}
