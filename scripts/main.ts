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
import { BlizzSorc } from "./builds/sorc-blizz.js"
import { Chaos } from "./sequences/chaos.js"
import { act1Leveling } from "./sequences/act1-leveling.js"
import { act2Leveling } from "./sequences/act2-leveling.js"
import { act3Leveling } from "./sequences/act3-leveling.js"
import { act4Leveling } from "./sequences/act4-leveling.js"
import { act5Leveling } from "./sequences/act5-leveling.js"
import { Progression } from "./services/progression.js"

const CHAR_CLASS = 1 // Sorceress
const townAreas = new Set([Area.RogueEncampment, Area.LutGholein, Area.KurastDocks, Area.PandemoniumFortress, Area.Harrogath])

interface BotState {
  charName: string
  classId: number
  runsCompleted: number
}

// Background thread: allocate skill/stat points
const AutoAllocThread = createScript(function*(game, svc) {
  const ab = svc.get(AutoBuild)
  ab.setBuild(BlizzSorc)
  while (true) {
    yield* game.delay(2000)
    if (game.inGame) yield* ab.allocatePoints()
  }
})

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

  // ── Register threads ──
  game.load.inGame(ThreatMonitor)
  game.load.inGame(Guard)
  game.load.inGame(Chicken)
  game.load.inGame(AutoAllocThread)
  game.load.inGame(BuffThread)
  game.load.inGame(PotionDrinker)
  game.load.inGame(Overlay)

  const town = svc.get(Town)
  const move = svc.get(Movement)
  const buffs = svc.get(Buffs)
  const progression = svc.get(Progression)

  // Map decision tree script names → generator functions
  const scriptMap: Record<string, (g: typeof game, s: typeof svc) => Generator<void>> = {
    // Act 1
    'den-of-evil': act1Leveling,
    'blood-raven': act1Leveling,
    'tristram': act1Leveling,
    'countess': act1Leveling,
    'walk-to-catacombs': act1Leveling,
    'andy': act1Leveling,
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

      // Town: corpse pickup + heal + chores
      if (townAreas.has(game.area)) {
        // Corpse pickup
        for (const p of game.players) {
          if (p.unitId !== game.player.unitId && p.name === game.player.charname && p.mode === 0) {
            game.log('[bot] picking up corpse')
            yield* move.walkTo(p.x, p.y)
            game.interact(p)
            yield* game.delay(1000)
            break
          }
        }
        // Clean town cycle: heal → buy pots → repair → stash
        yield* townVisit(game)
      }

      // ── Route via progression decision tree ──
      const script = progression.evaluate()
      if (script) {
        game.log('[bot] decision tree → ' + script)
        const scriptFn = scriptMap[script]
        if (scriptFn) {
          yield* scriptFn(game, svc)
        } else {
          game.log('[bot] unknown script: ' + script)
          yield* game.delay(2000)
        }
      } else {
        // Decision tree exhausted — all quests done for this difficulty
        // Fall back to farming (Chaos runs for high level, area clear for low level)
        if (level >= 25) {
          yield* buffs.refreshAll()
          yield* Chaos.factory(game, svc)
        } else {
          yield* act1Leveling(game, svc)
        }
      }

      state.runsCompleted++
      game.writeState(state)
      game.log('[bot] run ' + state.runsCompleted + ' done, level ' + game.charLevel)
    }())

    // Left game
    yield* game.delay(2000)
  }
})
