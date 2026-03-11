import { unitAtIndex, unitCount } from "diablo:native";
import { createUnit, type Unit } from "./unit";

export class UnitCollection<T extends Unit> {
  constructor(private unitType: number) {}

  *[Symbol.iterator](): Iterator<T> {
    const count = unitCount(this.unitType)
    for (let i = 0; i < count; i++) {
      const id = unitAtIndex(i)
      if (id >= 0) yield createUnit(this.unitType, id) as T
    }
  }

  find(pred: (u: T) => boolean): T | undefined {
    for (const u of this) {
      if (pred(u)) return u
    }
    return undefined
  }

  filter(pred: (u: T) => boolean): T[] {
    const result: T[] = []
    for (const u of this) {
      if (pred(u)) result.push(u)
    }
    return result
  }

  closest(): T | undefined {
    let best: T | undefined
    let bestDist = Infinity
    for (const u of this) {
      const d = u.distance
      if (d < bestDist) {
        bestDist = d
        best = u
      }
    }
    return best
  }

  toArray(): T[] {
    const result: T[] = []
    for (const u of this) result.push(u)
    return result
  }

  get length(): number {
    // Snapshot and count — note: unitCount triggers a fresh snapshot
    return unitCount(this.unitType)
  }
}
