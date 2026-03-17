/**
 * Automap + screen overlay — shows bot state visually.
 * Runs as a background script, updates draw hooks each frame.
 */

import { createScript, Text, Box } from "diablo:game"

export const Overlay = createScript(function*(game, _svc) {
  // Status text on screen
  const statusText = new Text({ text: '', x: 10, y: 50, color: 0x00, font: 1 })
  const objectiveText = new Text({ text: '', x: 10, y: 65, color: 0x04, font: 1 })
  const statsText = new Text({ text: '', x: 10, y: 80, color: 0x05, font: 1 })

  let lastLevel = 0

  while (true) {
    yield

    if (!game.inGame) {
      statusText.visible = false
      objectiveText.visible = false
      statsText.visible = false
      continue
    }

    statusText.visible = true
    objectiveText.visible = true
    statsText.visible = true

    const level = game.charLevel
    if (level !== lastLevel) {
      if (lastLevel > 0) game.log('[overlay] LEVEL UP! ' + lastLevel + ' → ' + level)
      lastLevel = level
    }

    // Status line
    statusText.text = 'Aether | Level ' + level + ' | Area ' + game.area + ' | Gold ' + game.gold

    // HP/MP bars as text
    const hpPct = Math.round(game.player.hp / game.player.maxHp * 100)
    const mpPct = game.player.mpmax > 0 ? Math.round(game.player.mp / game.player.mpmax * 100) : 0
    // Read run count from persisted state
    const state = game.readState<{ runsCompleted?: number }>()
    const runs = state?.runsCompleted ?? 0
    statsText.text = 'HP ' + hpPct + '% | MP ' + mpPct + '% | Run ' + runs
  }
})
