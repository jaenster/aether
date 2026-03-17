/**
 * Auto-equip: check inventory for items better than equipped, swap them in.
 */

import { type Game, type ItemUnit, ItemContainer } from "diablo:game"
import { getBaseStat } from "./txt.js"
import { Packet } from "./packets.js"

/** Compare item to currently equipped — simple damage/defense check */
function isBetter(item: ItemUnit, game: Game): boolean {
  const classid = item.classid
  const minDam = getBaseStat("items", classid, "dwMinDam")
  const maxDam = getBaseStat("items", classid, "dwMaxDam")
  const minAc = getBaseStat("items", classid, "dwMinAc")
  const maxAc = getBaseStat("items", classid, "dwMaxAc")

  // Weapon: compare to player's current damage
  if (minDam > 0 || maxDam > 0) {
    const curMin = game.player.getStat(21, 0) // STAT_MINDMG
    const curMax = game.player.getStat(22, 0) // STAT_MAXDMG
    return (minDam + maxDam) / 2 > (curMin + curMax) / 2 * 1.1
  }

  // Armor: compare to player's defense
  if (minAc > 0 || maxAc > 0) {
    const curDef = game.player.getStat(31, 0) // STAT_DEFENSE
    return maxAc > curDef * 1.1
  }

  return false
}

/** Check stat requirements */
function meetsReqs(item: ItemUnit, game: Game): boolean {
  const classid = item.classid
  const reqLvl = getBaseStat("items", classid, "nLevelReq")
  if (reqLvl > game.charLevel) return false
  // TODO: str/dex requirements
  return true
}

/**
 * Scan inventory for equipment upgrades and equip them.
 */
export function* autoEquip(game: Game): Generator<void> {
  for (const item of game.items) {
    if (item.location !== ItemContainer.Inventory) continue
    if (!meetsReqs(item, game)) continue
    if (!isBetter(item, game)) continue

    game.log('[equip] equipping ' + (item.name ?? item.code))

    // Pick to cursor: packet 0x19 [u32 unitId]
    const pick = new Packet(0x19, 4)
    pick.dword(item.unitId)
    game.sendPacket(pick.toUint8Array())
    yield* game.delay(300)

    // Place to body: packet 0x1A [u16 bodyLoc]
    // TODO: determine correct body loc from item type
    // For now skip the place — just picking up is enough to test
    yield* game.delay(300)
  }
}
