/**
 * Quest object interaction helpers.
 * Find preset → moveTo → interact with the actual unit.
 * Reusable building blocks for quest scripts.
 */

import { type Game, type ObjectUnit } from "diablo:game"
import { moveTo } from "./walk-clear.js"
import { walkTo } from "./walk-clear.js"
import type { AttackFn } from "./walk-clear.js"

/**
 * Find a preset unit in the current area, walk to it (clearing along the way),
 * and return the actual unit for interaction.
 */
export function* findAndApproach(
  game: Game,
  atk: AttackFn,
  pickit: { lootGround(): Generator<void> },
  unitType: number,
  classId: number,
): Generator<void, { x: number, y: number, unit: any } | null> {
  const preset = game.findPreset(unitType, classId)
  if (!preset) {
    game.log('[quest] preset not found: type=' + unitType + ' classid=' + classId)
    return null
  }

  game.log('[quest] walking to preset (' + preset.x + ',' + preset.y + ') type=' + unitType + ' classid=' + classId)
  yield* moveTo(game, atk, pickit, preset.x, preset.y)

  // Find the actual unit near the preset coords
  let unit: any = null
  if (unitType === 2) {
    // Object
    unit = game.objects.find(o => o.classid === classId && dist(o.x, o.y, preset.x, preset.y) < 20)
  } else if (unitType === 1) {
    // Monster (quest NPCs, special monsters)
    unit = game.monsters.find(m => m.classid === classId && dist(m.x, m.y, preset.x, preset.y) < 20)
  } else if (unitType === 5) {
    // Tile
    unit = game.tiles.find(t => dist(t.x, t.y, preset.x, preset.y) < 20)
  }

  if (!unit) {
    game.log('[quest] unit not found near preset')
    return null
  }

  // Walk close
  if (unit.distance > 5) {
    yield* walkTo(game, unit.x, unit.y)
  }

  return { x: unit.x, y: unit.y, unit }
}

/**
 * Find a quest object and interact with it.
 * Returns true if interaction succeeded.
 */
export function* interactQuestObject(
  game: Game,
  atk: AttackFn,
  pickit: { lootGround(): Generator<void> },
  unitType: number,
  classId: number,
): Generator<void, boolean> {
  const result = yield* findAndApproach(game, atk, pickit, unitType, classId)
  if (!result) return false

  game.interact(result.unit)
  yield* game.delay(500)
  return true
}

/**
 * Find and kill a specific monster (quest boss).
 * Walks to preset, then attacks until the target is dead.
 */
export function* killQuestBoss(
  game: Game,
  atk: AttackFn,
  pickit: { lootGround(): Generator<void> },
  classId: number,
): Generator<void, boolean> {
  const result = yield* findAndApproach(game, atk, pickit, 1, classId)
  if (!result) return false

  // Fight until this specific monster is dead
  for (let casts = 0; casts < 100; casts++) {
    const target = game.monsters.find(m => m.classid === classId && m.isAttackable)
    if (!target) {
      game.log('[quest] boss classid=' + classId + ' dead')
      yield* pickit.lootGround()
      return true
    }

    yield* atk.clear({ killRange: 25, maxCasts: 10 })
    yield

    if (game.player.hp <= 0 || game.player.mode === 0 || game.player.mode === 17) return false
  }

  return false
}

/**
 * Interact with multiple preset objects of the same type.
 * E.g. Cairn Stones in Stony Field (5 stones, classids 17-21).
 */
export function* interactMultiplePresets(
  game: Game,
  atk: AttackFn,
  pickit: { lootGround(): Generator<void> },
  unitType: number,
  classIds: number[],
): Generator<void, number> {
  let count = 0
  for (const classId of classIds) {
    const ok = yield* interactQuestObject(game, atk, pickit, unitType, classId)
    if (ok) count++
    yield* game.delay(300)
  }
  return count
}

/**
 * Wait for a specific area to become available (e.g. Tristram portal opening)
 * by checking tiles for a destination area.
 */
export function* waitForPortal(
  game: Game,
  destArea: number,
  maxFrames = 150,
): Generator<void, boolean> {
  for (let i = 0; i < maxFrames; i++) {
    yield
    const tile = game.tiles.find(t => t.destArea === destArea)
    if (tile) return true
  }
  return false
}

/**
 * Pick up a ground item by code (e.g. ScrollOfInifuss after killing the tree).
 */
export function* pickupGroundItem(
  game: Game,
  itemCode: string,
  maxWait = 50,
): Generator<void, boolean> {
  for (let i = 0; i < maxWait; i++) {
    const item = game.items.find(it => it.code === itemCode && it.location === 5) // ground
    if (item) {
      if (item.distance > 5) {
        yield* walkTo(game, item.x, item.y)
      }
      game.clickMap(0, item.x, item.y)
      yield* game.delay(500)
      return true
    }
    yield
  }
  return false
}

function dist(x1: number, y1: number, x2: number, y2: number) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2)
}
