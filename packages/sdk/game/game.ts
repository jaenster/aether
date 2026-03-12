import {
  getArea, getAct, getDifficulty, inGame, getTickCount, log as nativeLog,
  meGetUnitId,
  clickMap, move as nativeMove, selectSkill, castSkillAt,
  getUIFlag as nativeGetUIFlag, say as nativeSay,
  getExits as nativeGetExits,
  findPath as nativeFindPath,
  findTelePath as nativeFindTelePath,
  findPreset as nativeFindPreset,
  interact as nativeInteract,
  runToEntity as nativeRunToEntity,
  exitGame as nativeExitGame,
  exitClient as nativeExitClient,
  takeWaypoint as nativeTakeWaypoint,
  printScreen as nativePrintScreen,
  getRightSkill as nativeGetRightSkill,
  sendPacket as nativeSendPacket,
  castSkillPacket as nativeCastSkillPacket,
  registerPacketHook,
  getPacketData,
  injectPacket as nativeInjectPacket,
  getCollision as nativeGetCollision,
} from "diablo:native"
import { UnitCollection } from "./unit.collection.js";
import { ItemUnit, Missile, Monster, NPC, ObjectUnit, PlayerUnit, Tile } from "./unit.js";
import type { ScriptToken } from './service.js'


export class ScriptLoader {
  readonly inGameScripts: ScriptToken[] = []
  readonly oogScripts: ScriptToken[] = []
  readonly alwaysScripts: ScriptToken[] = []

  inGame(script: ScriptToken) { this.inGameScripts.push(script) }
  oog(script: ScriptToken) { this.oogScripts.push(script) }
  always(script: ScriptToken) { this.alwaysScripts.push(script) }
}


export class Game {
  readonly load = new ScriptLoader()

  private _players = new UnitCollection<PlayerUnit>(0)
  private _monsters = new UnitCollection<Monster>(1)
  private _objects = new UnitCollection<ObjectUnit>(2)
  private _missiles = new UnitCollection<Missile>(3)
  private _items = new UnitCollection<ItemUnit>(4)
  private _tiles = new UnitCollection<Tile>(5)

  _frame = 0

  get inGame() { return inGame() }
  get area() { return getArea() }
  get act() { return getAct() }
  get difficulty() { return getDifficulty() }
  get tickCount() { return getTickCount() }
  private _player: PlayerUnit | null = null

  get player(): PlayerUnit {
    if (!this._player) {
      this._player = new PlayerUnit(meGetUnitId())
    }
    return this._player
  }

  clearPlayer() { this._player = null }

  get players() { return this._players }
  get monsters() { return this._monsters }
  get objects() { return this._objects }
  get missiles() { return this._missiles }
  get items() { return this._items }
  get tiles() { return this._tiles }

  /** NPCs in the current area — filtered view of monsters with known NPC classids */
  get npcs(): NpcView {
    return new NpcView(this._monsters)
  }

  clickMap(type: number, x: number, y: number, shift: boolean = false) {
    clickMap(type, shift ? 1 : 0, x, y)
  }
  move(x: number, y: number) { nativeMove(x, y) }
  /** Cast the currently selected right skill at (x, y). No skill switch. */
  castSkill(x: number, y: number) { castSkillAt(x, y) }
  /** Select skill on right hand without casting. */
  selectSkill(skillId: number) { selectSkill(0, skillId) }
  /** Select skill on right hand and immediately cast at (x, y). */
  useSkill(skillId: number, x: number, y: number) {
    selectSkill(0, skillId)
    castSkillAt(x, y)
  }
  /** Cast right skill at world coords via packet — works off-screen (for teleport). */
  castSkillPacket(x: number, y: number) { nativeCastSkillPacket(x, y) }
  /** Get the currently selected right-hand skill ID */
  get rightSkill(): number { return nativeGetRightSkill() }
  say(msg: string) { nativeSay(msg) }
  getUIFlag(flag: number): boolean { return nativeGetUIFlag(flag) }
  interact(unit: { type: number, unitId: number }) { nativeInteract(unit.type, unit.unitId) }
  runToEntity(unit: { type: number, unitId: number }) { nativeRunToEntity(unit.type, unit.unitId) }

  /** Send a raw packet to the game server. Build with Packet helper. */
  sendPacket(data: Uint8Array) { nativeSendPacket(data) }

  exitGame() { nativeExitGame() }
  exitClient() { nativeExitClient() }
  takeWaypoint(waypointUnitId: number, destArea: number) { nativeTakeWaypoint(waypointUnitId, destArea) }

  getExits() {
    const raw = nativeGetExits()
    if (!raw) return []
    return raw.split(',').map(function(entry: string) {
      const parts = entry.split(':')
      return { area: parseInt(parts[0]!, 10), x: parseInt(parts[1]!, 10), y: parseInt(parts[2]!, 10) }
    })
  }

  findPath(x: number, y: number) {
    const raw = nativeFindPath(x, y)
    if (!raw) return []
    const arr = JSON.parse(raw) as number[][]
    return arr.map(function(p: number[]) { return { x: p[0]!, y: p[1]! } })
  }

  findTelePath(x: number, y: number) {
    const raw = nativeFindTelePath(x, y)
    if (!raw) return []
    const arr = JSON.parse(raw) as number[][]
    return arr.map(function(p: number[]) { return { x: p[0]!, y: p[1]! } })
  }

  findPreset(type: number, classid: number) {
    const raw = nativeFindPreset(type, classid)
    if (!raw) return undefined
    const parts = raw.split(':')
    return { x: parseInt(parts[0]!, 10), y: parseInt(parts[1]!, 10) }
  }

  *delay(ms: number) {
    const ticks = Math.ceil(ms / 40)
    for (let i = 0; i < ticks; i++) yield
  }

  /* Yield per-frame until area changes to target, or maxFrames exceeded. */
  *waitForArea(area: number, maxFrames = 150) {
    for (let i = 0; i < maxFrames; i++) {
      if (this.area === area) return true
      yield
    }
    return false
  }

  /** Yield per-frame until predicate returns true, or maxFrames exceeded. */
  *waitUntil(predicate: () => boolean, maxFrames = 150) {
    for (let i = 0; i < maxFrames; i++) {
      if (predicate()) return true
      yield
    }
    return false
  }

  // ── Packet hooks (S2C interception) ──────────────────────────────

  private _packetHandlers = new Map<number, Array<(data: Uint8Array) => boolean | void>>()

  /** Register a handler for incoming S2C packets. Return false to block. */
  onPacket(opcode: number, handler: (data: Uint8Array) => boolean | void) {
    let handlers = this._packetHandlers.get(opcode)
    if (!handlers) {
      handlers = []
      this._packetHandlers.set(opcode, handlers)
      registerPacketHook(opcode)
    }
    handlers.push(handler)
  }

  /** Called from native __onPacket(opcode). Returns false to block. */
  _handlePacket(opcode: number): boolean {
    const handlers = this._packetHandlers.get(opcode)
    if (!handlers) return true
    const data = getPacketData()
    for (const h of handlers) {
      if (h(data) === false) return false
    }
    return true
  }

  /** Inject a fake S2C packet — calls the original handler as if server sent it. */
  injectPacket(data: Uint8Array) { nativeInjectPacket(data) }

  // ── Collision ─────────────────────────────────────────────────────

  /** Check collision flags at (x,y). Returns 0 if walkable, >0 if blocked, -1 on error. */
  getCollision(x: number, y: number): number { return nativeGetCollision(x, y) }

  // ── Logging ────────────────────────────────────────────────────────

  log(...args: any[]) {
    const msg = args.map(a => String(a)).join(' ')
    nativeLog(`[f${this._frame}] ${msg}`)
  }

  /** Print colored text on the game screen (chat area). No-op in headless mode. */
  print(msg: string, color: GameColor = GameColor.White) {
    nativePrintScreen(msg, color)
  }
}

class NpcView {
  constructor(private monsters: UnitCollection<Monster>) {}

  *[Symbol.iterator](): Iterator<NPC> {
    for (const m of this.monsters) {
      if (NPC.npcClassIds.has(m.classid)) {
        yield new NPC(m.unitId)
      }
    }
  }

  find(pred: (n: NPC) => boolean): NPC | undefined {
    for (const n of this) {
      if (pred(n)) return n
    }
    return undefined
  }

  filter(pred: (n: NPC) => boolean): NPC[] {
    const result: NPC[] = []
    for (const n of this) {
      if (pred(n)) result.push(n)
    }
    return result
  }

  /** Find the closest NPC matching a predicate */
  closest(pred?: (n: NPC) => boolean): NPC | undefined {
    let best: NPC | undefined
    let bestDist = Infinity
    for (const n of this) {
      if (pred && !pred(n)) continue
      const d = n.distance
      if (d < bestDist) { bestDist = d; best = n }
    }
    return best
  }
}

/** D2 game text color codes (ÿcX escape sequence index) */
export enum GameColor {
  White = 0,
  Red = 1,
  Green = 2,
  Blue = 3,
  Gold = 4,
  Grey = 5,
  Black = 6,
  Tan = 7,
  Orange = 8,
  Yellow = 9,
  DarkGreen = 10,
  Purple = 11,
}

/** Color code characters for D2 text: ÿc + this char */
const colorChars = "0123456789:;"

/** Wrap text with a D2 color code prefix */
export function colorText(text: string, color: GameColor): string {
  const ch = colorChars[color] ?? "0"
  return "\xffc" + ch + text
}

// Extend String.prototype for composable colored text: "hello".color(GameColor.Red)
declare global {
  interface String {
    color(c: GameColor): string
  }
}

String.prototype.color = function(this: string, c: GameColor): string {
  return colorText(this, c)
}
