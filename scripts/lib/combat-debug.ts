import type { CombatSnapshot, MonsterSnapshot, ActionScore, Pos } from "./attack-types.js"

/** Serialize a combat snapshot to compact JSON for logging */
export function snapshotToJson(snap: CombatSnapshot): string {
  return JSON.stringify({
    t: snap.tick,
    cp: [snap.casterPos.x, snap.casterPos.y],
    hp: snap.casterHp,
    mp: snap.casterMp,
    pt: snap.primaryTarget ? { id: snap.primaryTarget.unitId, cls: snap.primaryTarget.classid, hp: snap.primaryTarget.hp } : undefined,
    f: snap.filters,
    m: snap.monsters.map(m => ({
      id: m.unitId, cls: m.classid, x: m.x, y: m.y,
      hp: m.hp, hpx: m.hpmax, md: m.mode, sp: m.spectype,
      r: m.resists, bl: m.blocked, fi: m.inFilter,
    })),
    ra: snap.rankedActions.map(a => ({
      sk: a.skillId, dps: a.dpsPerFrame | 0, pd: a.primaryDmg | 0,
      hit: a.monstersHit, fc: a.frameCost, mc: a.manaCost, rp: a.needsReposition,
    })),
    ch: snap.chosen ? { sk: snap.chosen.skillId, dps: snap.chosen.dpsPerFrame | 0 } : null,
  })
}

/** Parse a compact JSON snapshot back into the full CombatSnapshot type */
export function parseSnapshot(json: string): CombatSnapshot {
  const d = JSON.parse(json)
  return {
    tick: d.t,
    casterPos: { x: d.cp[0], y: d.cp[1] },
    casterHp: d.hp,
    casterMp: d.mp,
    primaryTarget: d.pt ? { unitId: d.pt.id, classid: d.pt.cls, hp: d.pt.hp } : undefined as { unitId: number; classid: number; hp: number } | undefined,
    filters: d.f,
    monsters: d.m.map((m: any) => ({
      unitId: m.id, classid: m.cls, x: m.x, y: m.y,
      hp: m.hp, hpmax: m.hpx, mode: m.md, spectype: m.sp,
      resists: m.r, blocked: m.bl, inFilter: m.fi,
    })),
    rankedActions: d.ra.map((a: any) => ({
      skillId: a.sk, dpsPerFrame: a.dps, primaryDmg: a.pd,
      monstersHit: a.hit, frameCost: a.fc, manaCost: a.mc,
      needsReposition: a.rp,
      casterPos: { x: d.cp[0], y: d.cp[1] },
      targetPos: { x: 0, y: 0 },
    })),
    chosen: d.ch ? {
      skillId: d.ch.sk, dpsPerFrame: d.ch.dps, primaryDmg: 0,
      monstersHit: 0, frameCost: 0, manaCost: 0, needsReposition: false,
      casterPos: { x: d.cp[0], y: d.cp[1] },
      targetPos: { x: 0, y: 0 },
    } : null,
  }
}

/** Buffer snapshots for a combat session, flush to callback on demand */
export class CombatRecorder {
  private snapshots: CombatSnapshot[] = []
  private maxBuffer: number

  constructor(maxBuffer = 1000) {
    this.maxBuffer = maxBuffer
  }

  record(snap: CombatSnapshot) {
    this.snapshots.push(snap)
    if (this.snapshots.length > this.maxBuffer) {
      this.snapshots.shift()
    }
  }

  getSnapshots(): CombatSnapshot[] {
    return this.snapshots
  }

  clear() {
    this.snapshots = []
  }

  /** Find the snapshot where the chosen action changed (decision points) */
  getDecisionPoints(): CombatSnapshot[] {
    const points: CombatSnapshot[] = []
    let lastSkill = -1
    for (const snap of this.snapshots) {
      if (snap.chosen && snap.chosen.skillId !== lastSkill) {
        points.push(snap)
        lastSkill = snap.chosen.skillId
      }
    }
    return points
  }
}
