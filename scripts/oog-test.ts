import { createBot, FormType } from "diablo:game"
import { generateName } from "./lib/name-generator.js"

let CHAR_NAME = generateName()
const CHAR_CLASS = 1 // 0=ama,1=sor,2=nec,3=pal,4=bar,5=dru,6=ass

// Screen coords for class portraits on the create char screen (800x600)
// From control dump: images are 88x184, forms Y system is inverted (dwPosY = bottom)
// Hit test: [dwPosX, dwPosX+dwSizeX) x [dwPosY-dwSizeY, dwPosY)
const CLASS_CLICK_COORDS: Record<number, {x: number, y: number}> = {
  0: { x: 144, y: 245 },  // Amazon     img(100,337)  → center (144, 337-92=245)
  1: { x: 444, y: 238 },  // Sorceress  img(400,330)  → center (444, 330-92=238)
  2: { x: 276, y: 272 },  // Necromancer img(232,364) → center (276, 364-92=272)
  3: { x: 565, y: 247 },  // Paladin    img(521,339)  → center (565, 339-92=247)
  4: { x: 345, y: 241 },  // Barbarian  img(301,333)  → center (345, 333-92=241)
  5: { x: 670, y: 261 },  // Druid      img(626,353)  → center (670, 353-92=261)
  6: { x: 764, y: 278 },  // Assassin   img(720,370)  → center (764, 370-92=278)
}

export default createBot('oog-test', function*(game, _svc) {
  game.log('[oog] starting OOG controller')
  let phase = 'splash'

  while (true) {
    yield

    if (game.inGame) {
      game.log('[oog] IN GAME! area=' + game.area + ' level=' + game.charLevel)
      game.log('[oog] class=' + game.classId + ' expansion=' + game.isExpansion)
      while (game.inGame) yield
      game.log('[oog] left game')
      phase = 'char_select'
      continue
    }

    const controls = game.getControls()
    const buttons = controls.filter(c => c.type === FormType.Button)

    // ── SPLASH ──
    if (phase === 'splash') {
      if (buttons.length > 0) { phase = 'main_menu'; continue }
      if (controls.length > 0) {
        const c = controls.find(c => c.type === FormType.TextBox || c.type === FormType.Image)
        if (c) game.clickControl(c.i)
      }
      yield* game.delay(500)
      continue
    }

    // ── MAIN MENU ──
    if (phase === 'main_menu') {
      const sp = buttons.find(b => b.text?.includes('SINGLE'))
      if (sp) {
        game.log('[oog] clicking Single Player')
        game.clickControl(sp.i)
        phase = 'char_select'
        yield* game.delay(1000)
      }
      yield* game.delay(500)
      continue
    }

    // ── CHAR SELECT ──
    if (phase === 'char_select') {
      if (game.oogSelectChar(CHAR_NAME)) {
        game.log('[oog] selected ' + CHAR_NAME)
        phase = 'wait_game'
        yield* game.delay(3000)
        continue
      }
      const create = buttons.find(b => b.text?.includes('CREATE'))
      if (create) {
        game.log('[oog] clicking Create New')
        game.clickControl(create.i)
        phase = 'create_click_class'
        yield* game.delay(1500)
      }
      yield* game.delay(500)
      continue
    }

    // ── CREATE: SELECT CLASS → TYPE NAME → CLICK OK ──
    if (phase === 'create_click_class') {
      // Step 1: Select class + expansion via native (calls ClickOnClassCreate + sets flag)
      game.log('[oog] selecting class ' + CHAR_CLASS + ' (expansion)')
      game.oogSelectClass(CHAR_CLASS) // expansion=true by default in native
      yield* game.delay(500)

      // Step 2: Type name into editbox
      const fresh1 = game.getControls()
      const editbox = fresh1.find(c => c.type === FormType.EditBox)
      if (editbox) {
        game.log('[oog] typing name: ' + CHAR_NAME)
        game.setControlText(editbox.i, CHAR_NAME)
      }
      yield* game.delay(300)

      // Step 4: Click OK button
      const fresh2 = game.getControls()
      const okBtn = fresh2.find(c => c.type === FormType.Button && c.text?.includes('OK'))
      if (okBtn) {
        game.log('[oog] clicking OK (state=' + okBtn.state + ')')
        game.clickControl(okBtn.i)
        phase = 'wait_game'
        yield* game.delay(5000)
      } else {
        game.log('[oog] OK button not found')
        phase = 'char_select'
        yield* game.delay(2000)
      }
      continue
    }

    // ── POPUP DETECTION (runs every phase) ──
    {
      const popup = controls.find(c => c.type === FormType.Popup)
      const cancelBtn = buttons.find(b => b.text?.includes('CANCEL'))
      if (popup || cancelBtn) {
        // Read popup text if available
        const popupTexts = controls.filter(c => c.type === FormType.TextBox)
        for (const t of popupTexts) {
          const txt = game.getControlText(t.i)
          if (txt) game.log('[oog] POPUP: ' + txt)
        }

        if (cancelBtn) {
          game.log('[oog] dismissing popup via CANCEL')
          game.clickControl(cancelBtn.i)
          yield* game.delay(500)
          // Name was taken — generate a new one and retry
          CHAR_NAME = generateName(Date.now())
          game.log('[oog] trying new name: ' + CHAR_NAME)
          phase = 'create_click_class'
          continue
        }
      }
    }

    // ── WAIT GAME ──
    if (phase === 'wait_game') {
      if (game.inGame) continue
      // Check if we're back on char select
      const create = buttons.find(b => b.text?.includes('CREATE'))
      if (create) {
        game.log('[oog] back on char select — trying select')
        phase = 'char_select'
        continue
      }
      game.log('[oog] waiting for game...')
      yield* game.delay(1000)
      continue
    }

    yield* game.delay(500)
  }
})
