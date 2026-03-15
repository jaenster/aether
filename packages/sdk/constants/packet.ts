/** Client→Server (C2S) packet opcodes */
export const enum C2SPacket {
  EntityInteract = 0x13,
  ItemToBuffer = 0x18,
  BufferToStorage = 0x19,
  UseItem = 0x20,
  NpcHeal = 0x2F,
  NpcClose = 0x30,
  NpcBuy = 0x32,
  NpcSell = 0x33,
  NpcRepair = 0x35,
  HireMerc = 0x36,
  NpcSession = 0x38,
  CubeTransmute = 0x44,
  ClickButton = 0x4F,
  DropGold = 0x50,
}

/** NPC session modes (param for 0x38 packet) */
export const enum NpcSessionMode {
  Trade = 0,
  Repair = 1,
  Gamble = 2,
}

/** UI button IDs for clickButton (0x4F) packet */
export const enum UiButton {
  CloseStash = 0x12,
  WithdrawGold = 0x13,
  StashGold = 0x14,
}

/** Storage container IDs for bufferToStorage (0x19) packet */
export const enum StorageId {
  Inventory = 1,
  Cube = 3,
  Stash = 4,
}

/** Repair-all cost flag (OR'd with cost in 0x35 packet) */
export const REPAIR_ALL_FLAG = 0x80000000
