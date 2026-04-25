import { createBot, createScript, FormType, Area } from "diablo:game"
import { generateName } from "./lib/name-generator.js"
import { Chicken } from "./threads/chicken.js"
import { ThreatMonitor } from "./threads/threat-monitor.js"
import { Guard } from "./services/guard.js"
import { Town } from "./services/town.js"
import { Buffs } from "./services/buffs.js"
import { Movement } from "./services/movement.js"
import { healInTown } from "./lib/npc.js"
import { townVisit } from "./lib/town-visit.js"
import { PotionDrinker } from "./lib/potions.js"
import { Overlay } from "./threads/overlay.js"
import { AutoBuild } from "./services/auto-build.js"
import { FireSorc } from "./builds/sorc-fire.js"
import { Chaos } from "./sequences/chaos.js"
import { denOfEvil } from "./sequences/act1/DenOfEvil.js"
import { cave } from "./sequences/act1/Cave.js"
import { bloodRaven } from "./sequences/act1/BloodRaven.js"
import { tristram } from "./sequences/act1/Tristram.js"
import { underground } from "./sequences/act1/Underground.js"
import { countess } from "./sequences/act1/Countess.js"
import { walkToCatacombs } from "./sequences/act1/WalkToCatacombs.js"
import { andy } from "./sequences/act1/Andy.js"
import { act2Leveling } from "./sequences/act2-leveling.js"
import { act3Leveling } from "./sequences/act3-leveling.js"
import { act4Leveling } from "./sequences/act4-leveling.js"
import { act5Leveling } from "./sequences/act5-leveling.js"
import { Progression } from "./services/progression.js"
import { pickScript, markDone, resetDone } from "./decisions/index.js"

const CHAR_CLASS = 1 // Sorceress
const townAreas = new Set([Area.RogueEncampment, Area.LutGholein, Area.KurastDocks, Area.PandemoniumFortress, Area.Harrogath])

interface BotState {
  charName: string
  classId: number
  runsCompleted: number
}

// REMOVED: AutoAllocThread — skill/stat allocation done in main run loop instead

// Background thread: refresh buffs
const BuffThread = createScript(function*(game, svc) {
  const b = svc.get(Buffs)
  while (true) {
    yield* game.delay(5000)
    if (game.inGame && !townAreas.has(game.area)) {
      yield* b.refreshAll()
    }
  }
})

export default createBot('aether', function*(game, svc) {
  // ── State ──
  let state: BotState = game.readState<BotState>() ?? {
    charName: generateName(),
    classId: CHAR_CLASS,
    runsCompleted: 0,
  }
  if (!game.readState()) {
    game.writeState(state)
    game.log('[bot] new char: ' + state.charName)
  } else {
    game.log('[bot] loaded: ' + state.charName + ' (' + state.runsCompleted + ' runs)')
  }

  // ── Register background threads (before first game so they run immediately) ──
  // Minimal threads for stability — ThreatMonitor + Overlay disabled (GC pressure)
  game.load.inGame(Guard)
  game.load.inGame(Chicken)
  game.load.inGame(PotionDrinker)

  // ── OOG: create/select char ──
  while (!game.inGame) {
    yield
    const controls = game.getControls()
    const buttons = controls.filter(c => c.type === FormType.Button)

    // Splash
    if (buttons.length === 0 && controls.length > 0) {
      const c = controls.find(c => c.type === FormType.TextBox || c.type === FormType.Image)
      if (c) game.clickControl(c.i)
      yield* game.delay(500)
      continue
    }

    // Main menu
    const sp = buttons.find(b => b.text?.includes('SINGLE'))
    if (sp) { game.clickControl(sp.i); yield* game.delay(1000); continue }

    // Char select — try existing char
    if (game.oogSelectChar(state.charName)) {
      yield* game.delay(3000)
      continue
    }

    // Create new char
    const create = buttons.find(b => b.text?.includes('CREATE'))
    if (create) {
      game.clickControl(create.i)
      yield* game.delay(1500)
      game.oogSelectClass(CHAR_CLASS)
      yield* game.delay(500)
      const edit = game.getControls().find(c => c.type === FormType.EditBox)
      if (edit) game.setControlText(edit.i, state.charName)
      yield* game.delay(300)
      // Handle popup (name taken)
      const cancel = game.getControls().find(c => c.type === FormType.Button && c.text?.includes('CANCEL'))
      if (cancel) {
        game.clickControl(cancel.i)
        state.charName = generateName(Date.now())
        game.writeState(state)
        game.log('[bot] name taken, trying: ' + state.charName)
        yield* game.delay(500)
        continue
      }
      const ok = game.getControls().find(c => c.type === FormType.Button && c.text?.includes('OK') && c.state !== 0)
      if (ok) game.clickControl(ok.i)
      yield* game.delay(5000)
      continue
    }

    yield* game.delay(500)
  }

  game.log('[bot] IN GAME level ' + game.charLevel + ' area ' + game.area)

  const town = svc.get(Town)
  const move = svc.get(Movement)
  const buffs = svc.get(Buffs)
  const progression = svc.get(Progression)

  // Map decision tree script names → generator functions
  const scriptMap: Record<string, (g: typeof game, s: typeof svc) => Generator<void>> = {
    // Act 1
    'den-of-evil': denOfEvil,
    'cave': cave,
    'blood-raven': bloodRaven,
    'tristram': tristram,
    'underground': underground,
    'countess': countess,
    'walk-to-catacombs': walkToCatacombs,
    'andy': andy,
    // Act 2
    'radament': act2Leveling,
    'cube': act2Leveling,
    'staff': act2Leveling,
    'amulet': act2Leveling,
    'cube-staff': act2Leveling,
    'summoner': act2Leveling,
    'duriel': act2Leveling,
    // Act 3
    'lam-essen': act3Leveling,
    'khalims-will': act3Leveling,
    'mephisto': act3Leveling,
    // Act 4
    'izual': act4Leveling,
    'diablo': act4Leveling,
    // Act 5
    'rescue-barbs': act5Leveling,
    'anya': act5Leveling,
    'ancients': act5Leveling,
    'baal': act5Leveling,
  }

  // ── Main loop ──
  while (true) {
    // Re-enter game if disconnected
    while (!game.inGame) {
      yield
      const controls = game.getControls()
      const buttons = controls.filter(c => c.type === FormType.Button)
      if (buttons.find(b => b.text?.includes('OK'))) {
        if (game.oogSelectChar(state.charName)) yield* game.delay(3000)
      }
      const sp = buttons.find(b => b.text?.includes('SINGLE'))
      if (sp) { game.clickControl(sp.i); yield* game.delay(1000) }
      yield* game.delay(500)
    }

    yield* game.run(function*() {
      const level = game.charLevel
      game.log('[bot] level ' + level + ' area ' + game.area)

      // Death check — exit game immediately
      if (game.player.mode === 0 || game.player.mode === 17) {
        game.log('[bot] DEAD — exiting game')
        game.exitGame()
        return
      }

      // Allocate skill/stat points
      try {
        const ab = svc.get(AutoBuild)
        ab.setBuild(FireSorc)
        yield* ab.allocatePoints()
      } catch (e: any) {
        game.log('[bot] alloc error: ' + (e.message || e))
      }

      // Town: heal → sell junk → buy pots → equip upgrades
      if (townAreas.has(game.area)) {
        game.log('[bot] in town, gold=' + game.gold)
        try {
          yield* townVisit(game)
        } catch (e: any) {
          game.log('[bot] town error: ' + (e.message || e))
        }
      }

      // Route to appropriate act script via decision tree (mirrors Ryuk)
      try {
        game.log('[bot] picking script...')
        const script = pickScript(game)
        if (script) {
          const fn = scriptMap[script]
          if (fn) {
            game.log('[bot] running: ' + script)
            yield* fn(game, svc)
            markDone(script)
          } else {
            game.log('[bot] unknown script: ' + script)
          }
        } else {
          game.log('[bot] no script picked, exiting')
          game.exitGame()
        }
      } catch (e: any) {
        game.log('[bot] script error: ' + (e.message || e))
        yield* game.delay(2000)
      }

      state.runsCompleted++
      game.writeState(state)
      game.log('[bot] run ' + state.runsCompleted + ' done, level ' + game.charLevel)
    }())

    // Left game — reset per-game state
    resetDone()
    yield* game.delay(2000)
  }
})
