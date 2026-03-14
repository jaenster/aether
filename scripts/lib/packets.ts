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

/** 0x13: Entity interaction (opens NPC menu) */
export function entityInteract(unitType: number, unitId: number) {
  return new Packet(0x13, 8).dword(unitType).dword(unitId).toUint8Array()
}

/** 0x30: Close NPC interaction */
export function npcClose(unitType: number, unitId: number) {
  return new Packet(0x30, 8).dword(unitType).dword(unitId).toUint8Array()
}

/**
 * 0x38: NPC session actions
 *   mode 0 = open trade, mode 1 = repair, mode 2 = gamble
 */
export function npcSession(mode: number, npcId: number, extra = 0) {
  return new Packet(0x38, 12).dword(mode).dword(npcId).dword(extra).toUint8Array()
}

/** 0x32: Buy item from NPC */
export function npcBuy(npcId: number, itemId: number, flags: number, cost: number) {
  return new Packet(0x32, 16).dword(npcId).dword(itemId).dword(flags).dword(cost).toUint8Array()
}

/** 0x33: Sell item to NPC */
export function npcSell(npcId: number, itemId: number, animMode: number, cost: number) {
  return new Packet(0x33, 16).dword(npcId).dword(itemId).dword(animMode).dword(cost).toUint8Array()
}

/** 0x35: Repair item(s). itemId=0 + cost=0x80000000 for repair-all */
export function npcRepair(npcId: number, itemId: number, animMode: number, cost: number) {
  return new Packet(0x35, 16).dword(npcId).dword(itemId).dword(animMode).dword(cost).toUint8Array()
}

/** 0x2F: NPC interact — triggers heal for healing NPCs (Akara, Fara, Ormus, Jamella, Malah, Atma).
 *  Server calls HealByPlayerByNPC: restores HP, MP, stamina, removes poison+freeze. */
export function npcHeal(npcId: number) {
  return new Packet(0x2F, 8).dword(1).dword(npcId).toUint8Array()
}

/** 0x18: Pick up item to cursor buffer */
export function itemToBuffer(itemId: number) {
  return new Packet(0x18, 4).dword(itemId).toUint8Array()
}

/** 0x19: Place cursor item into storage container.
 *  storageId: 1=inventory, 3=cube, 4=stash */
export function bufferToStorage(itemId: number, x: number, y: number, storageId: number) {
  return new Packet(0x19, 16).dword(itemId).dword(x).dword(y).dword(storageId).toUint8Array()
}
