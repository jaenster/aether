import { createScript, Area, type Game, ItemContainer, StorageId } from "diablo:game"
import { Movement } from "../services/movement.js"
import { Attack } from "../services/attack.js"
import { Pickit } from "../services/pickit.js"
import { Buffs } from "../services/buffs.js"
import { Supplies } from "../services/supplies.js"
import { Packet, cubeTransmute, itemToBuffer, bufferToStorage } from "../lib/packets.js"

// Cow King classid (superunique Hell Bovine)
const COW_KING_CLASSID = 391

// Wirt's Leg item code
const WIRTS_LEG_CODE = "leg "
// Tome of Town Portal code
const TP_TOME_CODE = "tbk "

// The red portal object classid for cow level
const COW_PORTAL_CLASSID = 59

export const Cows = createScript(function*(game, svc) {
  const move = svc.get(Movement)
  const atk = svc.get(Attack)
  const loot = svc.get(Pickit)
  const buffs = svc.get(Buffs)
  const supplies = svc.get(Supplies)

  yield* supplies.checkAndResupply()

  game.log('[cows] starting run')

  // Make sure we're in Act 1 town
  if (game.area !== Area.RogueEncampment) {
    yield* move.journeyTo(Area.RogueEncampment)
  }

  // Open cow portal via cube
  const portalOpened: unknown = yield* openCowPortal(game)
  if (!portalOpened) {
    game.log('[cows] failed to open portal, aborting')
    return
  }

  // Buff up before entering
  yield* buffs.refreshAll()

  // Enter the red portal
  const entered: unknown = yield* enterCowPortal(game, move)
  if (!entered) {
    game.log('[cows] failed to enter portal, aborting')
    return
  }

  game.log('[cows] entered cow level')

  // Clear the level — cows are dense, sweep in expanding circles from entry
  yield* clearCowLevel(game, move, atk, loot, buffs)

  game.log('[cows] run complete')
})

function* openCowPortal(game: Game) {
  // Find Wirt's Leg and a TP Tome in inventory/cube/stash
  const leg = game.items.find(i => i.code.trim() === WIRTS_LEG_CODE.trim())
  const tome = game.items.find(i => i.code.trim() === TP_TOME_CODE.trim() && i.location !== ItemContainer.Inventory)

  if (!leg) {
    game.log('[cows] no Wirt\'s Leg found')
    return false
  }
  if (!tome) {
    game.log('[cows] no Tome of Town Portal found')
    return false
  }

  game.log(`[cows] leg=${leg.unitId} (loc=${leg.location}) tome=${tome.unitId} (loc=${tome.location})`)

  // Move both items to cube
  // Pick up leg → place in cube at 0,0
  if (leg.location !== ItemContainer.Cube) {
    game.sendPacket(itemToBuffer(leg.unitId))
    yield* game.delay(300)
    game.sendPacket(bufferToStorage(leg.unitId, 0, 0, StorageId.Cube))
    yield* game.delay(300)
  }

  // Pick up tome → place in cube at 0,2 (leg is 2x4, tome can go beside it)
  if (tome.location !== ItemContainer.Cube) {
    game.sendPacket(itemToBuffer(tome.unitId))
    yield* game.delay(300)
    game.sendPacket(bufferToStorage(tome.unitId, 2, 0, StorageId.Cube))
    yield* game.delay(300)
  }

  // Transmute
  game.log('[cows] transmuting...')
  game.sendPacket(cubeTransmute())
  yield* game.delay(500)

  // Check if portal appeared
  const portal = game.objects.find(o => o.classid === COW_PORTAL_CLASSID)
  if (portal) {
    game.log(`[cows] portal opened at ${portal.x},${portal.y}`)
    return true
  }

  // Portal might take a moment to appear — wait a bit more
  for (let i = 0; i < 20; i++) {
    yield* game.delay(250)
    const p = game.objects.find(o => o.classid === COW_PORTAL_CLASSID)
    if (p) {
      game.log(`[cows] portal opened at ${p.x},${p.y}`)
      return true
    }
  }

  game.log('[cows] portal did not appear after transmute')
  return false
}

function* enterCowPortal(game: Game, move: any) {
  const portal = game.objects.find(o => o.classid === COW_PORTAL_CLASSID)
  if (!portal) return false

  // Move near the portal
  yield* move.moveNear(portal.x, portal.y, 5)

  // Interact with the portal
  for (let attempt = 0; attempt < 5; attempt++) {
    game.interact(portal)
    if (yield* game.waitForArea(Area.MooMooFarm)) return true
    yield* game.delay(200)
  }

  return false
}

function* clearCowLevel(game: Game, move: any, atk: any, loot: any, buffs: any) {
  const entryX = game.player.x
  const entryY = game.player.y

  // Cow level is open terrain — sweep in a grid pattern from entry point
  // The level is roughly 200x200 tiles
  const sweepRadius = 100
  const stepSize = 30

  // Clear immediate area first
  yield* atk.clear({ killRange: 25, maxCasts: 30 })
  yield* loot.lootGround()

  // Spiral outward from entry
  const visited = new Set<string>()
  const positions: Array<{x: number, y: number}> = []

  // Generate grid points in spiral order
  for (let ring = 1; ring <= Math.ceil(sweepRadius / stepSize); ring++) {
    const d = ring * stepSize
    // Top row
    for (let x = -d; x <= d; x += stepSize) positions.push({ x: entryX + x, y: entryY - d })
    // Right column
    for (let y = -d + stepSize; y <= d; y += stepSize) positions.push({ x: entryX + d, y: entryY + y })
    // Bottom row
    for (let x = d - stepSize; x >= -d; x -= stepSize) positions.push({ x: entryX + x, y: entryY + d })
    // Left column
    for (let y = d - stepSize; y >= -d + stepSize; y -= stepSize) positions.push({ x: entryX - d, y: entryY + y })
  }

  let cowsKilled = 0
  let cowKingDead = false

  for (const pos of positions) {
    const key = `${pos.x},${pos.y}`
    if (visited.has(key)) continue
    visited.add(key)

    // Teleport to position
    yield* move.moveTo(pos.x, pos.y)

    // Check for monsters nearby
    const nearbyMonsters = game.monsters.filter((m: any) => atk.alive(m) && m.distance < 30)
    if (nearbyMonsters.length === 0) continue

    // Refresh buffs if needed
    if (buffs.needsRefresh()) {
      yield* buffs.refreshOne()
    }

    // Clear the area
    const before = game.monsters.filter((m: any) => atk.alive(m)).length
    yield* atk.clear({
      killRange: 25,
      maxCasts: 50,
      priority: (a: any, b: any) => {
        // Prioritize Cow King
        if (a.classid === COW_KING_CLASSID && b.classid !== COW_KING_CLASSID) return -1
        if (b.classid === COW_KING_CLASSID && a.classid !== COW_KING_CLASSID) return 1
        return a.distance - b.distance
      },
    })
    const after = game.monsters.filter((m: any) => atk.alive(m)).length
    cowsKilled += (before - after)

    // Check if we killed the cow king
    if (!cowKingDead) {
      const king = game.monsters.find((m: any) => m.classid === COW_KING_CLASSID)
      if (king && !atk.alive(king)) {
        cowKingDead = true
        game.log('[cows] Cow King slain!')
      }
    }

    yield* loot.lootGround()
  }

  game.log(`[cows] cleared ~${cowsKilled} cows, king=${cowKingDead ? 'dead' : 'alive/not found'}`)
}
