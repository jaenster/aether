import {
  getUnitX, getUnitY, getUnitHP, getUnitMaxHP, getUnitMP, getUnitMaxMP,
  getUnitStat, meGetCharName,
} from "diablo:native"

export interface Me {
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  readonly hpmax: number;
  readonly mp: number;
  readonly mpmax: number;
  readonly name: string;
  readonly charname: string;

  getStat(stat: number, layer?: number): number;
  getState(state: number): boolean;
}

class MeImpl implements Me {
  get x() { return getUnitX() }
  get y() { return getUnitY() }
  get hp() { return getUnitHP() }
  get hpmax() { return getUnitMaxHP() }
  get mp() { return getUnitMP() }
  get mpmax() { return getUnitMaxMP() }
  get name() { return meGetCharName() }
  get charname() { return meGetCharName() }

  getStat(stat: number, layer: number = 0): number {
    return getUnitStat(stat, layer)
  }

  getState(_state: number): boolean {
    return false
  }
}

export const meProxy: Me = new MeImpl()
