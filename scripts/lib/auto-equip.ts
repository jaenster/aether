/**
 * Auto-equip: check inventory for items better than equipped, swap them in.
 * Body locations: 1=head, 2=neck, 3=torso, 4=rarm, 5=larm,
 *   6=rring, 7=lring, 8=belt, 9=boots, 10=gloves, 11=rhand, 12=lhand
 */

import { type Game, type ItemUnit, ItemContainer } from "diablo:game"
import { getBaseStat } from "./txt.js"
import { isBetterThanEquipped, meetsRequirements } from "./item-eval.js"
import { Packet } from "./packets.js"

// Body location for item types — simplified mapping
// Full mapping would read from ItemTypes.txt BodyLoc1/BodyLoc2 fields
function getBodyLoc(item: ItemUnit): number {
  const type = getBaseStat("items", item.classid, "wType")
  // Weapons: type 1-24 roughly
  if (type >= 1 && type <= 24) return 4 // right hand
  // Shields: type 25-30
  if (type >= 25 && type <= 30) return 5 // left arm
  // Helmets: type 31-37
  if (type >= 31 && type <= 37) return 1 // head
  // Body armor: type 38-43
  if (type >= 38 && type <= 43) return 3 // torso
  // Boots: type 51-53
  if (type >= 51 && type <= 53) return 9 // boots
  // Gloves: type 54-56
  if (type >= 54 && type <= 56) return 10 // gloves
  // Belt: type 57-58
  if (type >= 57 && type <= 58) return 8 // belt
  // Rings: type 59
  if (type === 59) return 6 // right ring
  // Amulets: type 60
  if (type === 60) return 2 // neck

  return 0 // unknown
}

/**
 * Scan inventory for equipment upgrades and equip them.
 * Call from town (not during combat).
 */
export function* autoEquip(game: Game): Generator<void> {
  for (const item of game.items) {
    if (item.location !== ItemContainer.Inventory) continue

    const bodyLoc = getBodyLoc(item)
    if (bodyLoc === 0) continue // not equipment

    if (!meetsRequirements(item, game.charLevel)) continue
    if (!isBetterThanEquipped(item, game.charLevel)) continue

    game.log('[equip] equipping ' + item.name + ' to slot ' + bodyLoc)

    // Equip: packet 0x1A — place item from inventory to body location
    // Actually: pick to cursor (0x19) then place to body (0x1A)
    const pickPkt = new Packet().byte(0x19).dword(item.unitId).toUint8Array()
    game.sendPacket(pickPkt)
    yield* game.delay(300)

    const placePkt = new Packet().byte(0x1A).word(bodyLoc).toUint8Array()
    game.sendPacket(placePkt)
    yield* game.delay(300)
  }
}
