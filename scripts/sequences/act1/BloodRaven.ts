/**
 * Blood Raven — wp to ColdPlains, walk to BurialGrounds, kill Blood Raven.
 * Blood Raven is a SuperUnique (preset type 1, classid 805).
 * She dies as part of area clearing — no special kill needed.
 */

import { type Game, Area } from "diablo:game"
import { moveTo, moveToExit } from "../../lib/walk-clear.js"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"
import { healInTown } from "../../lib/npc.js"
import { haveWp, townAreas } from "./util.js"

export function* bloodRaven(game: Game, svc: any): Generator<void> {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const pickit = svc.get(Pickit)

  // Heal in town
  if (townAreas.has(game.area)) {
    yield* healInTown(game)
  }

  // Navigate to Cold Plains
  if (townAreas.has(game.area) || game.area === Area.BloodMoor) {
    if (haveWp(game, Area.ColdPlains)) {
      game.log('[blood-raven] wp to Cold Plains')
      yield* move.useWaypoint(Area.ColdPlains)
    } else {
      game.log('[blood-raven] walking to Cold Plains')
      yield* move.journeyTo(Area.ColdPlains)
    }
  }

  // Walk to Burial Grounds
  if (game.area === Area.ColdPlains) {
    game.log('[blood-raven] heading to Burial Grounds')
    yield* moveToExit(game, atk, pickit, Area.BurialGrounds)
  }

  // Clear Burial Grounds — Blood Raven is here, she'll die as part of the clear
  if (game.area === Area.BurialGrounds) {
    game.log('[blood-raven] clearing Burial Grounds')

    // Walk to Blood Raven's preset location (type=1, classid=805)
    const preset = game.findPreset(1, 805)
    if (preset) {
      game.log('[blood-raven] preset at (' + preset.x + ',' + preset.y + ')')
      yield* moveTo(game, atk, pickit, preset.x, preset.y)
    } else {
      // No preset found — just clear toward an exit
      game.log('[blood-raven] no preset, clearing area')
      const exits = game.getExits()
      if (exits.length > 0) {
        yield* moveTo(game, atk, pickit, exits[0]!.x, exits[0]!.y)
      }
    }

    yield* pickit.lootGround()
    game.log('[blood-raven] Burial Grounds cleared')
  }

  // Return to town — DON'T exit game
}
