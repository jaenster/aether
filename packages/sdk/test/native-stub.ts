/**
 * Test stub for `diablo:native`. Implements all 125+ exports as no-ops with
 * sensible defaults, plus a `__mockNative` control surface so tests can:
 *  - flip UI flags (`setUIFlag(flag, true)`)
 *  - capture sent packets (`getSentPackets()`)
 *  - script `npcMenuByMenuId` results per menu ID
 *  - reset between tests (`reset()`)
 *
 * The real implementation lives in Zig and is bound by SpiderMonkey at runtime;
 * this module only exists for Node-side unit/orchestration tests.
 */

// ── Mock state ──────────────────────────────────────────────────────

interface MockState {
  uiFlags: Map<number, boolean>
  sentPackets: Uint8Array[]
  menuIdResults: Map<number, boolean>
  menuIdSideEffects: Map<number, () => void>
  menuIdCalls: number[]
  menuSelectCalls: number[]
  interacts: Array<{ type: number; unitId: number }>
  closeCount: number
  /** When set, getInteractedNPC returns this id. */
  interactedNpcId: number
  /** Predicate-driven UI flag setter — fires after N getUIFlag reads. */
  flagAfter: Array<{ flag: number; value: boolean; readsLeft: number }>
}

const state: MockState = {
  uiFlags: new Map(),
  sentPackets: [],
  menuIdResults: new Map(),
  menuIdSideEffects: new Map(),
  menuIdCalls: [],
  menuSelectCalls: [],
  interacts: [],
  closeCount: 0,
  interactedNpcId: 0,
  flagAfter: [],
}

export const __mockNative = {
  reset(): void {
    state.uiFlags.clear()
    state.sentPackets.length = 0
    state.menuIdResults.clear()
    state.menuIdSideEffects.clear()
    state.menuIdCalls.length = 0
    state.menuSelectCalls.length = 0
    state.interacts.length = 0
    state.closeCount = 0
    state.interactedNpcId = 0
    state.flagAfter.length = 0
  },

  /** Set a UI flag value seen by `getUIFlag(flag)`. */
  setUIFlag(flag: number, value: boolean): void {
    state.uiFlags.set(flag, value)
  },

  /** Schedule a UI flag flip after the next `readsLeft` calls to `getUIFlag(flag)`. */
  setUIFlagAfter(flag: number, value: boolean, readsLeft: number): void {
    state.flagAfter.push({ flag, value, readsLeft })
  },

  /** Configure return value of `npcMenuByMenuId(menuId)`. Default is false.
   *  Optional onCall side-effect (e.g. set Shop=true to simulate UI opening). */
  setMenuIdResult(menuId: number, result: boolean, onCall?: () => void): void {
    state.menuIdResults.set(menuId, result)
    if (onCall) state.menuIdSideEffects.set(menuId, onCall)
  },

  /** Set the result of `getInteractedNPC()`. */
  setInteractedNpc(unitId: number): void {
    state.interactedNpcId = unitId
  },

  getSentPackets(): Uint8Array[] {
    return state.sentPackets
  },

  getMenuIdCalls(): number[] {
    return state.menuIdCalls
  },

  getInteracts(): Array<{ type: number; unitId: number }> {
    return state.interacts
  },

  getCloseCount(): number {
    return state.closeCount
  },
}

// ── State ──
export function getArea(): number { return 1 }
export function getAct(): number { return 1 }
export function getUnitX(): number { return 0 }
export function getUnitY(): number { return 0 }
export function getUnitHP(): number { return 100 }
export function getUnitMaxHP(): number { return 100 }
export function getUnitMP(): number { return 100 }
export function getUnitMaxMP(): number { return 100 }
export function getUnitStat(_stat: number, _layer: number): number { return 0 }
export function inGame(): boolean { return true }
export function getDifficulty(): number { return 0 }
export function getTickCount(): number { return 0 }
export function log(_message: string): void {}
export function logVerbose(_message: string): void {}

// ── Unit iteration / properties ──
export function unitCount(_type: number): number { return 0 }
export function unitAtIndex(_index: number): number { return 0 }
export function unitValid(_type: number, _unitId: number): boolean { return true }
export function unitGetX(_t: number, _u: number): number { return 0 }
export function unitGetY(_t: number, _u: number): number { return 0 }
export function unitGetMode(_t: number, _u: number): number { return 0 }
export function unitGetClassId(_t: number, _u: number): number { return 0 }
export function unitGetStat(_t: number, _u: number, _s: number, _l: number): number { return 0 }
export function unitGetState(_t: number, _u: number, _s: number): boolean { return false }
export function unitGetName(_t: number, _u: number): string { return "" }
export function unitGetArea(_t: number, _u: number): number { return 0 }
export function unitGetFlags(_t: number, _u: number): number { return 0 }
export function unitGetOwnerId(_t: number, _u: number): number { return -1 }
export function unitGetOwnerType(_t: number, _u: number): number { return -1 }

// ── Monster ──
export function monGetSpecType(_unitId: number): number { return 0 }
export function monGetEnchants(_unitId: number): number[] { return [] }
export function monGetMaxHP(_classId: number): number { return 100 }

// ── Item ──
export function itemGetQuality(_unitId: number): number { return 0 }
export function itemGetFlags(_unitId: number): number { return 0 }
export function itemGetLocation(_unitId: number): number { return 0 }
export function itemGetLocationRaw(_unitId: number): number { return 0 }
export function itemGetCode(_unitId: number): string { return "" }
export function itemGetRunewordIndex(_unitId: number): number { return 0 }
export function itemGetItemType(_unitId: number): number { return 0 }
export function itemGetLevel(_unitId: number): number { return 1 }
export function itemGetStatList(_unitId: number): string { return "[]" }
export function itemGetPrefixes(_unitId: number): string { return "" }
export function itemGetSuffixes(_unitId: number): string { return "" }

// ── Tile ──
export function tileGetDestArea(_unitId: number): number { return 0 }

// ── Player ──
export function meGetCharName(): string { return "TestChar" }
export function meGetUnitId(): number { return 1 }

// ── Actions ──
export function clickMap(_t: number, _s: number, _x: number, _y: number): void {}
export function move(_x: number, _y: number): void {}
export function selectSkill(_s: number, _h: number): void {}
export function castSkillAt(_x: number, _y: number): void {}
export function castSkillPacket(_x: number, _y: number): void {}
export function getRightSkill(): number { return 0 }

export function getUIFlag(flag: number): boolean {
  // Apply scheduled deferred flips
  for (const e of state.flagAfter) {
    if (e.flag !== flag) continue
    if (e.readsLeft <= 0) {
      state.uiFlags.set(flag, e.value)
      e.readsLeft = -1
    } else {
      e.readsLeft--
    }
  }
  return state.uiFlags.get(flag) ?? false
}
export function setUIFlag(flag: number, mode?: number): void {
  const cur = state.uiFlags.get(flag) ?? false
  if (mode === 1) state.uiFlags.set(flag, false)
  else if (mode === 2) state.uiFlags.set(flag, !cur)
  else state.uiFlags.set(flag, true)
}

export function say(_message: string): void {}
export function interact(type: number, unitId: number): void {
  state.interacts.push({ type, unitId })
}
export function runToEntity(_t: number, _u: number): void {}

// ── Map / pathfinding ──
export function getExits(): string | null { return null }
export function findPath(_x: number, _y: number): string | null { return null }
export function findTelePath(_x: number, _y: number): string | null { return null }
export function findPreset(_t: number, _c: number): string | undefined { return undefined }

// ── Skills / locale / txt ──
export function getSkillLevel(_s: number, _i: number): number { return 0 }
export function getLocaleString(_i: number): string { return "" }
export function txtReadField(_t: number, _r: number, _c: number, _s: number): number { return 0 }
export function txtReadFieldU(_t: number, _r: number, _c: number, _s: number): number { return 0 }

// ── NPC interaction ──
export function closeNPCInteract(): void { state.closeCount++ }
export function npcMenuSelect(menuIndex: number): boolean {
  state.menuSelectCalls.push(menuIndex)
  return true
}
export function npcMenuByMenuId(menuId: number): boolean {
  state.menuIdCalls.push(menuId)
  const sideEffect = state.menuIdSideEffects.get(menuId)
  if (sideEffect) sideEffect()
  return state.menuIdResults.get(menuId) ?? false
}

// ── Misc ──
export function getMercState(): number { return -1 }
export function exitGame(): void {}
export function exitClient(): void {}
export function takeWaypoint(_w: number, _d: number): void {}
export function sendPacket(data: Uint8Array): void {
  state.sentPackets.push(new Uint8Array(data))
}
export function registerPacketHook(_o: number): void {}
export function getPacketData(): Uint8Array { return new Uint8Array() }
export function getPacketSize(): number { return 0 }
export function injectPacket(_d: Uint8Array): void {}

// ── Collision / spatial ──
export function getCollision(_x: number, _y: number): number { return 0 }
export function getCollisionRect(_x: number, _y: number, _w: number, _h: number): string { return "" }
export function getRooms(): string { return "" }
export function hasLineOfSight(_a: number, _b: number, _c: number, _d: number): number { return 1 }
export function getMapSeed(): number { return 0 }
export function getRoomSeed(_x: number, _y: number): string { return "" }

// ── Screen / quest / player ──
export function printScreen(_m: string, _c: number): void {}
export function getQuest(_q: number, _s: number): number { return 0 }
export function hasWaypoint(_w: number): boolean { return false }
export function meGetClassId(): number { return 0 }
export function meGetGameType(): number { return 0 }
export function meGetPlayerType(): number { return 0 }
export function meGetLevel(): number { return 1 }
export function meGetGold(): number { return 0 }
export function meGetGoldStash(): number { return 0 }
export function clickItem(_m: number, _u: number): void {}
export function getInteractedNPC(): number { return state.interactedNpcId }

// ── OOG ──
export function oogControlCount(): number { return 0 }
export function oogControlGetInfo(_i: number): string { return "" }
export function oogControlGetText(_i: number): string { return "" }
export function oogControlSetText(_i: number, _t: string): boolean { return true }
export function oogControlClick(_i: number): boolean { return true }
export function oogClickScreen(_x: number, _y: number): void {}
export function oogControlFind(_t: number, _x: number, _y: number, _w: number, _h: number): number { return -1 }
export function oogControlGetAll(): string { return "[]" }
export function oogSelectClass(_c: number): boolean { return true }
export function oogSelectChar(_n: string): boolean { return true }

// ── File I/O ──
export function readFile(_f: string): string { return "" }
export function writeFile(_f: string, _c: string): boolean { return true }

// ── Drawing (no-ops) ──
export function drawLine(_a: number, _b: number, _c: number, _d: number, _co: number, _al?: number): void {}
export function drawSolidRect(_a: number, _b: number, _c: number, _d: number, _co: number, _al?: number): void {}
export function drawText(_t: string, _x: number, _y: number, _c?: number, _f?: number): void {}
export function setFont(_f: number): number { return 0 }
export function getTextWidth(_t: string): number { return 0 }
export function getTextHeight(_t: string): number { return 0 }
export function worldToScreenX(_x: number, _y: number): number { return 0 }
export function worldToScreenY(_x: number, _y: number): number { return 0 }
export function worldToAutomapX(_x: number, _y: number): number { return 0 }
export function worldToAutomapY(_x: number, _y: number): number { return 0 }
export function drawAutomapLine(_a: number, _b: number, _c: number, _d: number, _co: number, _al?: number): void {}

// ── Screen / shared / input / native draw / screenshot ──
export function getScreenWidth(): number { return 800 }
export function getScreenHeight(): number { return 600 }
export function getSharedState(): Int32Array { return new Int32Array(16) }
export function getKeyState(_v: number): boolean { return false }
export function drawAlloc(_t: number, _ta: number): number { return -1 }
export function drawFree(_s: number): void {}
export function drawUpdate(_s: number, _x: number, _y: number, _x2: number, _y2: number, _c: number, _a: number, _v: number): void {}
export function drawSetText(_s: number, _t: string): void {}
export function takeScreenshot(_name?: string): void {}
