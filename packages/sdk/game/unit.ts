import {
  unitGetX, unitGetY, unitGetMode, unitGetClassId, unitGetStat, unitGetState,
  unitGetName, unitGetArea, unitGetOwnerId, unitGetOwnerType,
  unitValid, meGetUnitId,
  monGetSpecType, monGetEnchants,
  itemGetQuality, itemGetFlags, itemGetLocation, itemGetCode,
  tileGetDestArea,
} from "diablo:native"
import { UnitType, PlayerMode } from "diablo:constants";

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

export class Monster extends Unit {
  constructor(id: number) { super(1, id) }

  get spectype(): number { return monGetSpecType(this.unitId) }
  get isSuperUnique(): boolean { return (this.spectype & 0x02) !== 0 }
  get isChampion(): boolean { return (this.spectype & 0x04) !== 0 }
  get isUnique(): boolean { return (this.spectype & 0x08) !== 0 }
  get isMinion(): boolean { return (this.spectype & 0x10) !== 0 }

  get enchants(): number[] {
    const s = monGetEnchants(this.unitId)
    if (!s) return []
    return s.filter((n: number) => n > 0)
  }
}

export class ItemUnit extends Unit {
  constructor(id: number) { super(4, id) }

  get quality(): number { return itemGetQuality(this.unitId) }
  get code(): string { return itemGetCode(this.unitId) }
  get ilvl(): number { return this.getStat(92, 0) }
  get sockets(): number { return this.getStat(194, 0) }

  get ethereal(): boolean { return (itemGetFlags(this.unitId) & 0x400000) !== 0 }
  get identified(): boolean { return (itemGetFlags(this.unitId) & 0x10) !== 0 }
  get runeword(): boolean { return (itemGetFlags(this.unitId) & 0x4000000) !== 0 }

  get location(): number { return itemGetLocation(this.unitId) }
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
