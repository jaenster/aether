import { createScript, Area } from "diablo:game"
import { Movement } from "../../services/movement.js"
import { Attack } from "../../services/attack.js"
import { Pickit } from "../../services/pickit.js"
import { Town } from "../../services/town.js"

const SCROLL_OF_INIFUSS = 524
const TREE_OF_INIFUSS = 30
const CAIRN_STONES = [17, 18, 19, 20, 21]
const GIBBET_CLASSID = 26
const GRISWOLD_CLASSID = 365

/**
 * Tristram — fetch scroll from Dark Wood, activate cairn stones, rescue Cain.
 * Clears Tristram and kills Griswold.
 */
export const Tristram = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)
  const town = svc.get(Town)

  game.log('[tristram] starting')

  // Step 1: Get Scroll of Inifuss from Dark Wood tree
  game.log('[tristram] getting scroll from Dark Wood')
  yield* move.journeyTo(Area.DarkWood)

  const treePreset = game.findPreset(2, TREE_OF_INIFUSS)
  if (treePreset) {
    yield* move.moveTo(treePreset.x, treePreset.y)
    // Interact with tree to get scroll
    const tree = game.objects.find(o => o.classid === TREE_OF_INIFUSS)
    if (tree) {
      game.interact(tree)
      yield* game.delay(500)
    }
    // Pick up scroll
    yield* loot.lootGround()
  }

  // Return to town to talk to Akara (she deciphers the scroll)
  yield* town.goToTown()

  const AKARA_CLASSID = 148
  const akara = game.objects.find(o => o.classid === AKARA_CLASSID)
  if (akara) {
    yield* move.walkTo(akara.x, akara.y)
    game.interact(akara)
    yield* game.delay(1000)
  }

  // Step 2: Go to Stony Field and activate cairn stones
  game.log('[tristram] activating cairn stones')
  yield* move.useWaypoint(Area.StonyField)

  // Find the portal to Tristram (preset 61 is the cairn stones portal area)
  const portalPreset = game.findPreset(2, 61)
  if (portalPreset) {
    yield* move.moveTo(portalPreset.x, portalPreset.y)
  }

  // Click all 5 cairn stones
  for (const stoneId of CAIRN_STONES) {
    const stone = game.objects.find(o => o.classid === stoneId)
    if (stone && stone.mode === 0) {
      yield* move.walkTo(stone.x, stone.y)
      game.interact(stone)
      yield* game.delay(300)
    }
  }

  // Wait for the red portal to appear, then use it
  yield* game.delay(1000)
  const portal = game.objects.find(o => o.classid === 60 && o.mode !== 0)
  if (portal) {
    yield* move.moveTo(portal.x, portal.y)
    game.interact(portal)
    yield* game.waitForArea(Area.Tristram)
  }

  // Step 3: Clear Tristram and rescue Cain
  game.log('[tristram] clearing Tristram')

  // Tristram patrol points
  const patrol = [
    { x: 25132, y: 5070 },
    { x: 25092, y: 5054 },
    { x: 25046, y: 5080 },
    { x: 25026, y: 5103 },
    { x: 25048, y: 5126 },
    { x: 25050, y: 5163 },
    { x: 25074, y: 5183 },
    { x: 25098, y: 5183 },
    { x: 25113, y: 5170 },
    { x: 25081, y: 5155 },
    { x: 25119, y: 5124 },
    { x: 25134, y: 5096 },
  ]

  for (const pos of patrol) {
    yield* move.moveTo(pos.x, pos.y)
    yield* atk.clear({ killRange: 20, maxCasts: 15 })

    // Check for Griswold death
    const gris = game.monsters.find(m => m.classid === GRISWOLD_CLASSID)
    if (gris && !atk.alive(gris)) break
  }

  // Rescue Cain from gibbet
  const gibbet = game.objects.find(o => o.classid === GIBBET_CLASSID)
  if (gibbet && gibbet.mode === 0) {
    game.log('[tristram] rescuing Cain')
    yield* move.moveTo(gibbet.x, gibbet.y)
    game.interact(gibbet)
    yield* game.delay(500)
  }

  // Kill Griswold if still alive
  const gris = game.monsters.find(m => m.classid === GRISWOLD_CLASSID && atk.alive(m))
  if (gris) {
    game.log('[tristram] killing Griswold')
    yield* atk.kill(gris)
  }

  game.log('[tristram] looting')
  yield* loot.lootGround()

  game.log('[tristram] complete')
})
