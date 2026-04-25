/**
 * Tristram — get Scroll of Inifuss (if needed), activate Cairn Stones,
 * enter portal, clear Tristram, rescue Cain, exit.
 * Ryuk: DarkWood tree -> Akara -> StonyField stones -> portal -> clear path -> rescue Cain.
 */

import { type Game, Area } from "diablo:game"
import { moveTo, moveToExit, walkTo, clear } from "../../lib/walk-clear.js"
import { waitForPortal, interactQuestObject } from "../../lib/quest-interact.js"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"
import { healInTown } from "../../lib/npc.js"
import {
  haveWp, townAreas,
  CAIRN_STONES, CAIRN_STONE_PORTAL_PRESET, CAIN_GIBBET, GRISWOLD,
  TREE_OF_INIFUSS
} from "./util.js"

export function* tristram(game: Game, svc: any): Generator<void> {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const pickit = svc.get(Pickit)

  if (townAreas.has(game.area)) {
    yield* healInTown(game)
  }

  // Step 1: Get Scroll of Inifuss if quest not progressed
  // Quest 3 (SearchForCain), sub 3 = scroll decoded, sub 4 = portal opened
  if (!game.getQuest(3, 4)) {
    // Get the scroll from the tree in Dark Wood
    if (!game.getQuest(3, 3)) {
      yield* move.journeyTo(Area.DarkWood)

      if (game.area === Area.DarkWood) {
        const ok: unknown = yield* interactQuestObject(game, atk, pickit, 2, TREE_OF_INIFUSS)
        if (ok) {
          yield* game.delay(500)
          yield* pickit.lootGround()
        }
      }

      // Return to town to decode scroll with Akara
      return
    }
  }

  // Step 2: Go to Stony Field, activate stones, enter Tristram
  if (game.area !== Area.StonyField) {
    if (haveWp(game, Area.StonyField)) {
      yield* move.useWaypoint(Area.StonyField)
    } else {
      yield* move.journeyTo(Area.StonyField)
    }
  }


  // Find Cairn Stones preset
  const ps = game.findPreset(2, CAIRN_STONE_PORTAL_PRESET)

  yield* moveTo(game, atk, pickit, ps.x, ps.y)

  // Activate each stone if quest not complete
  if (!game.getQuest(3, 4)) {
    for (const stoneId of CAIRN_STONES) {
      const stone = game.objects.find(o => o.classid === stoneId)
      if (stone && stone.mode === 0) {
        yield* walkTo(game, stone.x, stone.y)
        game.interact(stone)
        yield* game.delay(300)
        yield* clear(game, atk, { range: 10, maxCasts: 30 })
      }
    }
  }

  // Wait for portal and enter Tristram
  const portalOk = yield* waitForPortal(game, Area.Tristram, 200)

  const tile = game.tiles.find(t => t.destArea === Area.Tristram)

  for (let i = 0; i < 5; i++) {
    yield* walkTo(game, tile.x, tile.y)
    game.interact(tile)
    if (yield* game.waitForArea(Area.Tristram, 100)) break
  }

  // Clear Tristram along hardcoded path (from Ryuk)
  const path = [
    { x: 25132, y: 5070 }, { x: 25092, y: 5054 }, { x: 25046, y: 5080 },
    { x: 25048, y: 5126 }, { x: 25050, y: 5163 }, { x: 25052, y: 5192 },
    { x: 25074, y: 5183 }, { x: 25081, y: 5155 }, { x: 25119, y: 5124 },
    { x: 25139, y: 5142 }, { x: 25156, y: 5156 }, { x: 25130, y: 5196 },
  ]

  for (const pt of path) {
    if (!game.inGame || game.player.mode === 0 || game.player.mode === 17) break
    yield* moveTo(game, atk, pickit, pt.x, pt.y)

    // Rescue Cain near gibbet
    if (pt.x === 25139) {
      const gibbet = game.objects.find(o => o.classid === CAIN_GIBBET)
      if (gibbet && gibbet.mode === 0) {
        yield* walkTo(game, gibbet.x, gibbet.y)
        game.interact(gibbet)
        yield* game.delay(500)
      }
    }

    // Check if Griswold is dead -> done
    const gris = game.monsters.find(m => m.classid === GRISWOLD)
    if (gris && !gris.isAttackable) break
  }

  yield* pickit.lootGround()
}
