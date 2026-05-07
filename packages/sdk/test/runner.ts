import { log, exitClient, inGame } from "diablo:native"
import { __getTests } from "diablo:test"
import { Game, FormType } from "../game/game.js"

const game = new Game()

const CHAR_NAME = "EpicSorc"

let started = false
let finished = false
let currentTest = 0
let currentGen: Generator<void> | null = null
let passed = 0
let failed = 0
let failedNames: string[] = []

// OOG flow — drives splash → main menu → char select → join.
// Mirrors main.ts's existing-char path (no create-char, since e2e expects
// the EpicSorc save to exist).
let oogGen: Generator<void> | null = null

function* oogFlow(): Generator<void> {
  while (!game.inGame) {
    yield
    const controls = game.getControls()
    const buttons = controls.filter(c => c.type === FormType.Button)

    // Splash → click any text/image to dismiss
    if (buttons.length === 0 && controls.length > 0) {
      const c = controls.find(c => c.type === FormType.TextBox || c.type === FormType.Image)
      if (c) game.clickControl(c.i)
      yield* game.delay(500)
      continue
    }

    // Main menu → SINGLE PLAYER
    const sp = buttons.find(b => b.text?.includes("SINGLE"))
    if (sp) { game.clickControl(sp.i); yield* game.delay(1000); continue }

    // Char select → pick existing
    if (game.oogSelectChar(CHAR_NAME)) {
      yield* game.delay(3000)
      continue
    }

    yield* game.delay(500)
  }
}

function stepOog() {
  if (finished) return
  if (game.inGame) return
  if (!oogGen) {
    oogGen = oogFlow()
    log("=== Aether Test Runner: OOG flow ===")
  }
  try {
    const r = oogGen.next()
    if (r.done) oogGen = null
  } catch (e: any) {
    log("OOG error: " + (e.message || String(e)))
    oogGen = null
  }
}

;(globalThis as any).__onOogTick = stepOog

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
      exitClient()
      finished = true
      return
    }
  }

  const tests = __getTests()

  if (currentGen) {
    try {
      const result = currentGen.next()
      if (!result.done) return
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

  log("")
  log("Results: " + passed + " passed, " + failed + " failed")
  if (failedNames.length > 0) {
    for (const n of failedNames) {
      log("  FAILED: " + n)
    }
  }
  finished = true
  exitClient()
}
