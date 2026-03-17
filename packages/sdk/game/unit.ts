import {
  unitGetX, unitGetY, unitGetMode, unitGetClassId, unitGetStat, unitGetState,
  unitGetName, unitGetArea, unitGetOwnerId, unitGetOwnerType,
  unitValid, meGetUnitId,
  monGetSpecType, monGetEnchants, monGetMaxHP,
  itemGetQuality, itemGetFlags, itemGetLocation, itemGetLocationRaw, itemGetCode, itemGetRunewordIndex,
  tileGetDestArea,
  sendPacket as nativeSendPacket,
  interact as nativeInteract,
  getUIFlag as nativeGetUIFlag,
  closeNPCInteract as nativeCloseNPCInteract,
  npcMenuSelect as nativeNpcMenuSelect,
} from "diablo:native"
import { UnitType, PlayerMode, MonsterMode, UiFlags, MonsterSpecType, MonsterClassId, ItemFlags, C2SPacket, REPAIR_ALL_FLAG } from "diablo:constants";

export abstract class Unit {
  constructor(readonly type: number, readonly unitId: number) {}

  get valid(): boolean { return unitValid(this.type, this.unitId) }
  get x(): number { return unitGetX(this.type, this.unitId) }
  get y(): number { return unitGetY(this.type, this.unitId) }
  get mode(): number { return unitGetMode(this.type, this.unitId) }
  get classid(): number { return unitGetClassId(this.type, this.unitId) }
  get name(): string { return unitGetName(this.type, this.unitId) }
  get area(): number { return unitGetArea(this.type, this.unitId) }

  get hp(): number { return unitGetStat(this.type, this.unitId, 6, 0) >> 8 }
  get hpmax(): number { return unitGetStat(this.type, this.unitId, 7, 0) >> 8 }
  get mp(): number { return unitGetStat(this.type, this.unitId, 8, 0) >> 8 }
  get mpmax(): number { return unitGetStat(this.type, this.unitId, 9, 0) >> 8 }

  getStat(stat: number, layer: number = 0): number {
    return unitGetStat(this.type, this.unitId, stat, layer)
  }
  getState(state: number): boolean {
    return unitGetState(this.type, this.unitId, state)
  }

  get distance(): number {
    const pid = meGetUnitId()
    const mx = unitGetX(0, pid)
    const my = unitGetY(0, pid)
    const dx = mx - this.x
    const dy = my - this.y
    return Math.sqrt(dx * dx + dy * dy)
  }

  get parent(): Unit | undefined {
    const oid = unitGetOwnerId(this.type, this.unitId)
    const otype = unitGetOwnerType(this.type, this.unitId)
    if (oid < 0 || otype < 0) return undefined
    return createUnit(otype, oid)
  }
}

export class PlayerUnit extends Unit {
  constructor(id: number) { super(0, id) }

  get charname(): string { return this.name }
  get charlvl(): number { return this.getStat(12, 0) }
  get charclass(): number { return this.classid }
  get gold(): number { return this.getStat(14, 0) }
  get goldStash(): number { return this.getStat(15, 0) }
  get stamina(): number { return this.getStat(25, 0) }
  get staminamax(): number { return this.getStat(26, 0) }

  get idle(): boolean {
    const m = this.mode
    return m === PlayerMode.Neutral || m === PlayerMode.TownNeutral
  }
  get casting(): boolean { return this.mode === PlayerMode.Cast }
  get canCast(): boolean {
    const m = this.mode
    return m === PlayerMode.Neutral || m === PlayerMode.TownNeutral
      || m === PlayerMode.Walk || m === PlayerMode.Run
      || m === PlayerMode.TownWalk
  }
}

const mercClassIds = new Set([MonsterClassId.MercA1Rogue, MonsterClassId.MercA2Guard, MonsterClassId.MercA3IronWolf, MonsterClassId.MercA5Barb])
// Friendly town monsters (Align=1 in monstats) — rogue scouts, act guards, etc.
const friendlyClassIds = new Set([152, 155, 156, 200, 201, 256, 352, 353, 354, 355, 356, 366, 367, 514, 515, 516, 517, 518, 519, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530, 531, 532, 533])
const summonClassIds = new Set([363, 417, 418, 419, 420, 421, 428, 357, 358, 289, 290, 291, 292, 293])

export class Monster extends Unit {
  constructor(id: number) { super(1, id) }

  /** Monster max HP from txt tables (real value, not encoded 0-128). */
  get hpmax(): number { return monGetMaxHP(this.classid) }

  /** Monster current HP: decoded from the 0-128 encoded client value using txt max HP. */
  get hp(): number {
    const encoded = unitGetStat(this.type, this.unitId, 6, 0) >> 8
    const max = this.hpmax
    if (max <= 0) return encoded
    return (encoded * max / 128) | 0
  }

  get spectype(): number { return monGetSpecType(this.unitId) }
  get isSuperUnique(): boolean { return (this.spectype & MonsterSpecType.SuperUnique) !== 0 }
  get isChampion(): boolean { return (this.spectype & MonsterSpecType.Champion) !== 0 }
  get isUnique(): boolean { return (this.spectype & MonsterSpecType.Unique) !== 0 }
  get isMinion(): boolean { return (this.spectype & MonsterSpecType.Minion) !== 0 }

  get enchants(): number[] {
    const s = monGetEnchants(this.unitId)
    if (!s) return []
    return s.filter((n: number) => n > 0)
  }

  get isNpc(): boolean { return NPC.npcClassIds.has(this.classid) }

  /** True if this monster is hostile and can be attacked (not a merc, summon, NPC, or friendly). */
  get isAttackable(): boolean {
    if (!this.valid || this.hp <= 0 || this.mode === MonsterMode.Death || this.mode === MonsterMode.Dead) return false
    if (this.isNpc) return false
    if (mercClassIds.has(this.classid) || summonClassIds.has(this.classid)) {
      const p = this.parent
      if (p && p.type === 0) return false
    }
    // Friendly check: ownerType=0 (player) means pet/summon/merc,
    // and monsters with Align=1 in monstats are neutral town NPCs.
    // D2BS approach: check if monster has an owner that is a player unit.
    if (this.ownerType === 0 && this.ownerId !== 0xFFFFFFFF) return false
    // Also filter known friendly classids as fallback
    if (friendlyClassIds.has(this.classid)) return false
    return true
  }
}

// NPC classid → service sets (from Ghidra decompilation + monstats)
const healClassIds = new Set([148, 178, 176, 255, 405, 513])    // Akara, Fara, Atma, Ormus, Jamella, Malah
const repairClassIds = new Set([154, 178, 253, 257, 511])        // Charsi, Fara, Hratli, Halbu, Larzuk
const tradeClassIds = new Set([148, 154, 178, 177, 202, 255, 253, 257, 405, 511, 513, 512]) // all who sell
const gambleClassIds = new Set([147, 199, 254, 405, 512])        // Gheed, Elzix, Alkor, Jamella, Anya
const identifyClassIds = new Set([146, 244, 245, 246, 527])      // Cain (all acts)
const resurrectClassIds = new Set([150, 198, 252, 367, 515])     // Kashya, Greiz, Asheara, Tyrael, Qual-Kehk

/** Build a D2GS client→server packet: [u8 opcode, ...dwords LE] */
function buildPacket(opcode: number, ...dwords: number[]): Uint8Array {
  const buf = new ArrayBuffer(1 + dwords.length * 4)
  const view = new DataView(buf)
  view.setUint8(0, opcode)
  for (let i = 0; i < dwords.length; i++) {
    view.setInt32(1 + i * 4, dwords[i]!, true)
  }
  return new Uint8Array(buf)
}

function* delay(ms: number) {
  const ticks = Math.ceil(ms / 40)
  for (let i = 0; i < ticks; i++) yield
}

function* waitUntil(pred: () => boolean, maxFrames = 150) {
  for (let i = 0; i < maxFrames; i++) {
    if (pred()) return true
    yield
  }
  return false
}

export class NPC extends Monster {
  static readonly npcClassIds = new Set([
    ...healClassIds, ...repairClassIds, ...tradeClassIds,
    ...gambleClassIds, ...identifyClassIds, ...resurrectClassIds,
  ])

  get canHeal(): boolean { return healClassIds.has(this.classid) }
  get canRepair(): boolean { return repairClassIds.has(this.classid) }
  get canTrade(): boolean { return tradeClassIds.has(this.classid) }
  get canGamble(): boolean { return gambleClassIds.has(this.classid) }
  get canIdentify(): boolean { return identifyClassIds.has(this.classid) }
  get canResurrect(): boolean { return resurrectClassIds.has(this.classid) }

  /** Open interaction with this NPC (client-side walk + menu). */
  *interact() {
    nativeInteract(this.type, this.unitId)
    const ok: unknown = yield* waitUntil(() =>
      nativeGetUIFlag(UiFlags.NPCMenu) || nativeGetUIFlag(UiFlags.Shop)
    )
    return !!ok
  }

  /** Close any open NPC dialog (client + server). */
  *close() {
    nativeCloseNPCInteract()
    yield* waitUntil(() =>
      !nativeGetUIFlag(UiFlags.NPCMenu) && !nativeGetUIFlag(UiFlags.Shop)
    , 50)
    yield* delay(100)
  }

  /** Select an option from the NPC dialog menu by index. */
  menuSelect(index: number): boolean { return nativeNpcMenuSelect(index) }

  /** Heal at this NPC — the game auto-heals on NPC interaction (HealByPlayerByNPC). */
  *heal() {
    nativeInteract(this.type, this.unitId)
    yield* waitUntil(() =>
      nativeGetUIFlag(UiFlags.NPCMenu) || nativeGetUIFlag(UiFlags.Shop)
    )
    yield* delay(200)
    yield* this.close()
  }

  /** Open repair session and repair all items. */
  *repair() {
    yield* this.interact()
    yield* delay(200)
    // Use NPC menu callback for repair (typically option index 1)
    nativeNpcMenuSelect(1)
    yield* delay(300)
    nativeSendPacket(buildPacket(C2SPacket.NpcRepair, this.unitId, 0, 0, REPAIR_ALL_FLAG))
    yield* delay(200)
    yield* this.close()
  }

  /** Open trade window. Returns true if shop opened. */
  *openTrade() {
    const interacted = yield* this.interact()
    if (!interacted) return false
    yield* delay(200)
    // Use NPC menu callback for trade (option index 0)
    const menuOk = nativeNpcMenuSelect(0)
    if (!menuOk) return false
    return yield* waitUntil(() => nativeGetUIFlag(UiFlags.Shop))
  }

  /** Open gamble window. Returns true if shop opened. */
  *openGamble() {
    yield* this.interact()
    yield* delay(200)
    // Use NPC menu callback for gamble (typically option index 2)
    nativeNpcMenuSelect(2)
    return yield* waitUntil(() => nativeGetUIFlag(UiFlags.Shop))
  }
}

export class ItemUnit extends Unit {
  constructor(id: number) { super(4, id) }

  get quality(): number { return itemGetQuality(this.unitId) }
  get code(): string { return itemGetCode(this.unitId) }
  get ilvl(): number { return this.getStat(92, 0) }
  get sockets(): number { return this.getStat(194, 0) }

  get ethereal(): boolean { return (itemGetFlags(this.unitId) & ItemFlags.Ethereal) !== 0 }
  get identified(): boolean { return (itemGetFlags(this.unitId) & ItemFlags.Identified) !== 0 }
  get runeword(): boolean { return (itemGetFlags(this.unitId) & ItemFlags.Runeword) !== 0 }
  get runewordIndex(): number { return itemGetRunewordIndex(this.unitId) }

  get location(): number { return itemGetLocation(this.unitId) }
  /** Raw: (item_location << 8) | game_location — for debugging */
  get locationRaw(): number { return itemGetLocationRaw(this.unitId) }
  get durability(): number { return this.getStat(72, 0) }
  get maxdurability(): number { return this.getStat(73, 0) }
  get quantity(): number { return this.getStat(70, 0) }
}

export class ObjectUnit extends Unit {
  constructor(id: number) { super(2, id) }
}

export class Missile extends Unit {
  constructor(id: number) { super(3, id) }
}

export class Tile extends Unit {
  constructor(id: number) { super(5, id) }
  get destArea(): number { return tileGetDestArea(this.unitId) }
}

export function createUnit(type: UnitType, id: number): Unit {
  switch (type) {
    case 0: return new PlayerUnit(id)
    case 1: return new Monster(id)
    case 2: return new ObjectUnit(id)
    case 3: return new Missile(id)
    case 4: return new ItemUnit(id)
    case 5: return new Tile(id)
    default: throw new Error('Invalid unit type: ' + type)
  }
}
