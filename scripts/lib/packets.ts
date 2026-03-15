import { C2SPacket, UiButton, REPAIR_ALL_FLAG } from "diablo:game"

/**
 * Packet builder for D2GS client→server packets.
 * Uses Uint8Array + DataView for proper binary layout.
 *
 * D2 packet format: [u8:opcode, ...args (little-endian)]
 */
export class Packet {
  private buf: ArrayBuffer
  private view: DataView
  private offset = 0

  constructor(opcode: number, size: number) {
    this.buf = new ArrayBuffer(1 + size)
    this.view = new DataView(this.buf)
    this.view.setUint8(0, opcode)
    this.offset = 1
  }

  byte(val: number): this {
    this.view.setUint8(this.offset, val & 0xFF)
    this.offset += 1
    return this
  }

  word(val: number): this {
    this.view.setUint16(this.offset, val & 0xFFFF, true)
    this.offset += 2
    return this
  }

  dword(val: number): this {
    this.view.setInt32(this.offset, val, true)
    this.offset += 4
    return this
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.buf)
  }
}

// --- Pre-built packet constructors ---

/** Entity interaction (opens NPC menu) */
export function entityInteract(unitType: number, unitId: number) {
  return new Packet(C2SPacket.EntityInteract, 8).dword(unitType).dword(unitId).toUint8Array()
}

/** Close NPC interaction */
export function npcClose(unitType: number, unitId: number) {
  return new Packet(C2SPacket.NpcClose, 8).dword(unitType).dword(unitId).toUint8Array()
}

/**
 * NPC session actions
 *   mode 0 = open trade, mode 1 = repair, mode 2 = gamble
 */
export function npcSession(mode: number, npcId: number, extra = 0) {
  return new Packet(C2SPacket.NpcSession, 12).dword(mode).dword(npcId).dword(extra).toUint8Array()
}

/** Buy item from NPC */
export function npcBuy(npcId: number, itemId: number, flags: number, cost: number) {
  return new Packet(C2SPacket.NpcBuy, 16).dword(npcId).dword(itemId).dword(flags).dword(cost).toUint8Array()
}

/** Sell item to NPC */
export function npcSell(npcId: number, itemId: number, animMode: number, cost: number) {
  return new Packet(C2SPacket.NpcSell, 16).dword(npcId).dword(itemId).dword(animMode).dword(cost).toUint8Array()
}

/** Repair item(s). itemId=0 + cost=REPAIR_ALL_FLAG for repair-all */
export function npcRepair(npcId: number, itemId: number, animMode: number, cost: number) {
  return new Packet(C2SPacket.NpcRepair, 16).dword(npcId).dword(itemId).dword(animMode).dword(cost).toUint8Array()
}

/** NPC interact — triggers heal for healing NPCs (Akara, Fara, Ormus, Jamella, Malah, Atma).
 *  Server calls HealByPlayerByNPC: restores HP, MP, stamina, removes poison+freeze. */
export function npcHeal(npcId: number) {
  return new Packet(C2SPacket.NpcHeal, 8).dword(1).dword(npcId).toUint8Array()
}

/** Pick up item to cursor buffer */
export function itemToBuffer(itemId: number) {
  return new Packet(C2SPacket.ItemToBuffer, 4).dword(itemId).toUint8Array()
}

/** Place cursor item into storage container.
 *  storageId: 1=inventory, 3=cube, 4=stash */
export function bufferToStorage(itemId: number, x: number, y: number, storageId: number) {
  return new Packet(C2SPacket.BufferToStorage, 16).dword(itemId).dword(x).dword(y).dword(storageId).toUint8Array()
}

/** Use item at current location (right-click tome/scroll in inventory).
 *  Sends itemId + player world coords. */
export function useItem(itemId: number, x: number, y: number) {
  return new Packet(C2SPacket.UseItem, 12).dword(itemId).dword(x).dword(y).toUint8Array()
}

/** Transmute items in the Horadric Cube */
export function cubeTransmute() {
  return new Packet(C2SPacket.CubeTransmute, 4).dword(0).toUint8Array()
}

/** Click UI button. Used for gold stash/withdraw, trade accept, etc. */
export function clickButton(button: UiButton, complement: number) {
  return new Packet(C2SPacket.ClickButton, 6).word(button).dword(complement).toUint8Array()
}

/** Drop gold on the ground */
export function dropGold(playerId: number, amount: number) {
  return new Packet(C2SPacket.DropGold, 8).dword(playerId).dword(amount).toUint8Array()
}
