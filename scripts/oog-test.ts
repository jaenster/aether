import { createBot, FormType } from "diablo:game"

const CHAR_NAME = 'RyukBot'

export default createBot('oog-test', function*(game, _svc) {
  game.log('[oog] starting OOG controller')

  let phase = 'splash'

  while (true) {
    yield

    if (game.inGame) {
      game.log('[oog] IN GAME! area=' + game.area + ' level=' + game.charLevel)
      game.log('[oog] class=' + game.classId + ' expansion=' + game.isExpansion)
      // Stay in game forever
      while (game.inGame) yield
      game.log('[oog] left game')
      phase = 'char_select'
      continue
    }

    const controls = game.getControls()
    const buttons = controls.filter(c => c.type === FormType.Button)

    // ── SPLASH ──
    if (phase === 'splash') {
      if (buttons.length > 0) {
        phase = 'main_menu'
        continue
      }
      if (controls.length > 0) {
        const clickable = controls.find(c => c.type === FormType.TextBox || c.type === FormType.Image)
        if (clickable) game.clickControl(clickable.i)
      }
      yield* game.delay(500)
      continue
    }

    // ── MAIN MENU ──
    if (phase === 'main_menu') {
      const spBtn = buttons.find(b => b.text?.includes('SINGLE'))
      if (spBtn) {
        game.log('[oog] clicking Single Player')
        game.clickControl(spBtn.i)
        phase = 'char_select'
        yield* game.delay(1000)
      }
      yield* game.delay(500)
      continue
    }

    // ── CHAR SELECT ──
    if (phase === 'char_select') {
      // Try existing char first
      if (game.oogSelectChar(CHAR_NAME)) {
        game.log('[oog] selected ' + CHAR_NAME + ', entering game')
        phase = 'wait_game'
        yield* game.delay(3000)
        continue
      }

      // Need to create — must be on char select screen first (with CREATE button)
      const createBtn = buttons.find(b => b.text?.includes('CREATE'))
      if (createBtn) {
        // We're on char select — navigate to create screen, then create directly
        game.log('[oog] no existing char, clicking Create to get to create screen')
        game.clickControl(createBtn.i)
        yield* game.delay(1000)
        phase = 'create_direct'
        continue
      }

      yield* game.delay(500)
      continue
    }

    // ── CREATE DIRECTLY ──
    if (phase === 'create_direct') {
      // We're on the create char screen. Set the name in the editbox first.
      const editboxes = controls.filter(c => c.type === FormType.EditBox)
      if (editboxes.length > 0) {
        game.log('[oog] setting name in editbox: ' + CHAR_NAME)
        game.setControlText(editboxes[0]!.i, CHAR_NAME)
        yield* game.delay(200)
      }

      // Create the save file via native binding (InitSave + Storm WriteSave + EnumSaves)
      game.log('[oog] creating Expansion Sorceress: ' + CHAR_NAME)
      const ok = game.oogCreateChar(CHAR_NAME, 1, true, false) // 1 = Sorceress
      game.log('[oog] oogCreateChar returned: ' + ok)

      // ConfirmCreate was called — check if a popup appeared
      yield* game.delay(1000)
      const afterControls = game.getControls()
      game.log('[oog] after create: ' + afterControls.length + ' controls')
      for (const c of afterControls) {
        if (c.type === FormType.Button || c.type === FormType.Popup || c.type === FormType.TextBox) {
          const tName = c.type === FormType.Button ? 'BTN' : c.type === FormType.Popup ? 'POP' : 'TEXT'
          game.log('[oog]   [' + c.i + '] ' + tName + ' (' + c.x + ',' + c.y + ' ' + c.w + 'x' + c.h + ') s=' + c.state + ' "' + (c.text || '') + '"')
        }
      }
      // If there's a popup "OK" button, click it
      const popupOk = afterControls.find(c => c.type === FormType.Button && c.text?.includes('OK') && c.state === 5)
      if (popupOk) {
        game.log('[oog] clicking popup OK')
        game.clickControl(popupOk.i)
        yield* game.delay(500)
      }
      phase = 'wait_game'
      yield* game.delay(3000)
      continue
    }

    // ── WAIT GAME ──
    if (phase === 'wait_game') {
      if (game.inGame) continue
      game.log('[oog] waiting for game to load...')

      // Check if we're back on char select (maybe create/select worked, game loading)
      const hasCreate = buttons.find(b => b.text?.includes('CREATE'))
      if (hasCreate) {
        game.log('[oog] back on char select, trying select again')
        phase = 'char_select'
        continue
      }

      yield* game.delay(1000)
      continue
    }

    yield* game.delay(500)
  }
})
