import {
  getArea, getAct, getDifficulty, inGame, getTickCount, log as nativeLog, logVerbose as nativeLogVerbose,
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
  getCollisionRect as nativeGetCollisionRect,
  getRooms as nativeGetRooms,
  hasLineOfSight as nativeHasLineOfSight,
  getMapSeed as nativeGetMapSeed,
  getRoomSeed as nativeGetRoomSeed,
  getMercState as nativeGetMercState,
  // Phase 1 additions
  getQuest as nativeGetQuest,
  hasWaypoint as nativeHasWaypoint,
  meGetClassId as nativeMeGetClassId,
  meGetGameType as nativeMeGetGameType,
  meGetPlayerType as nativeMeGetPlayerType,
  meGetLevel as nativeMeGetLevel,
  meGetGold as nativeMeGetGold,
  meGetGoldStash as nativeMeGetGoldStash,
  clickItem as nativeClickItem,
  getInteractedNPC as nativeGetInteractedNPC,
  oogControlCount as nativeOogControlCount,
  oogControlGetInfo as nativeOogControlGetInfo,
  oogControlGetText as nativeOogControlGetText,
  oogControlSetText as nativeOogControlSetText,
  oogControlClick as nativeOogControlClick,
  oogControlFind as nativeOogControlFind,
  oogControlGetAll as nativeOogControlGetAll,
  oogSelectChar as nativeOogSelectChar,
  oogClickScreen as nativeOogClickScreen,
  oogSelectClass as nativeOogSelectClass,
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

  /** Clear all script registrations (used during hot-reload). */
  clear() {
    this.inGameScripts.length = 0
    this.oogScripts.length = 0
    this.alwaysScripts.length = 0
  }
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

  /** Merc state: -1 = no merc, 0 = dead, 1+ = HP percent */
  get mercState(): number { return nativeGetMercState() }
  get mercDead(): boolean { return nativeGetMercState() === 0 }
  get hasMerc(): boolean { return nativeGetMercState() !== -1 }
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

  /** Run a generator, yielding each frame. Breaks out cleanly if we leave the game. */
  *run(gen: Generator<void>): Generator<void> {
    while (this.inGame) {
      const r = gen.next()
      if (r.done) return
      yield
    }
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

  /** Remove all packet hooks (used during hot-reload to prevent duplicates). */
  _clearPacketHooks() {
    this._packetHandlers = new Map()
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

  /** Get collision data for a rectangle. Returns Uint16Array in row-major order. */
  getCollisionRect(x: number, y: number, w: number, h: number): Uint16Array {
    const hex = nativeGetCollisionRect(x, y, w, h)
    if (!hex) return new Uint16Array(0)
    const count = hex.length / 4
    const result = new Uint16Array(count)
    for (let i = 0; i < count; i++) {
      result[i] = parseInt(hex.substring(i * 4, i * 4 + 4), 16)
    }
    return result
  }

  /** Get all loaded Room1 bounding boxes as {x, y, w, h} array. */
  getRooms(): { x: number, y: number, w: number, h: number }[] {
    const raw = nativeGetRooms()
    if (!raw) return []
    return raw.split(';').filter(Boolean).map(function(entry: string) {
      const p = entry.split(',')
      return { x: parseInt(p[0]!, 10), y: parseInt(p[1]!, 10), w: parseInt(p[2]!, 10), h: parseInt(p[3]!, 10) }
    })
  }

  /** Check if a straight line from (x1,y1) to (x2,y2) is clear of walls/objects/doors. */
  hasLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    return nativeHasLineOfSight(x1, y1, x2, y2) === 1
  }

  /** Get the act's map seed (deterministic per game instance). */
  get mapSeed(): number { return nativeGetMapSeed() }

  /** Get the room seed at (x,y). Returns {low, high} or null if room not loaded. */
  getRoomSeed(x: number, y: number): { low: number, high: number } | null {
    const raw = nativeGetRoomSeed(x, y)
    if (!raw) return null
    const parts = raw.split(':')
    return { low: parseInt(parts[0]!, 10), high: parseInt(parts[1]!, 10) }
  }

  // ── Quest / Waypoint / Player ────────────────────────────────────

  /** Check quest state: returns 1 if bit set, 0 otherwise */
  getQuest(questId: number, subId: number): number { return nativeGetQuest(questId, subId) }
  /** Check if waypoint is activated for current difficulty */
  hasWaypoint(wpIndex: number): boolean { return nativeHasWaypoint(wpIndex) }
  /** Player class: 0=ama, 1=sor, 2=nec, 3=pal, 4=bar, 5=dru, 6=ass */
  get classId(): number { return nativeMeGetClassId() }
  /** 0=classic, 1=expansion */
  get isExpansion(): boolean { return nativeMeGetGameType() === 1 }
  /** 0=softcore, 1=hardcore */
  get isHardcore(): boolean { return nativeMeGetPlayerType() === 1 }
  /** Player character level */
  get charLevel(): number { return nativeMeGetLevel() }
  /** Gold on person */
  get gold(): number { return nativeMeGetGold() }
  /** Gold in stash */
  get goldStash(): number { return nativeMeGetGoldStash() }
  /** Click item: 0=use, 1=pick to cursor, 2=pick from ground, 3=drop from cursor */
  clickItem(mode: number, unitId: number) { nativeClickItem(mode, unitId) }
  /** Get unitId of currently interacted NPC, or -1 */
  get interactedNPC(): number { return nativeGetInteractedNPC() }

  // ── OOG Controls ──────────────────────────────────────────────────

  /** Get all OOG controls as parsed array. Call from OOG tick only. */
  getControls(): OogControl[] {
    const raw = nativeOogControlGetAll()
    if (!raw || raw === '[]') return []
    return JSON.parse(raw) as OogControl[]
  }

  /** Find a control by type/position. -1 = wildcard. Returns control index or -1. */
  findControl(type: number, x = -1, y = -1, w = -1, h = -1): number {
    return nativeOogControlFind(type, x, y, w, h)
  }

  /** Get text of a control (editbox text buffer or button label) */
  getControlText(index: number): string { return nativeOogControlGetText(index) }

  /** Set text on an editbox control */
  setControlText(index: number, text: string): boolean { return nativeOogControlSetText(index, text) }

  /** Click/invoke a control */
  clickControl(index: number): boolean { return nativeOogControlClick(index) }

  /** Snapshot controls (call before find/get if you need fresh data) */
  refreshControls(): number { return nativeOogControlCount() }

  /** Simulate a mouse click at screen coordinates (for OOG screens) */
  oogClickScreen(x: number, y: number) { nativeOogClickScreen(x, y) }

  /** Select a class on the create char screen (enables OK button + editbox) */
  oogSelectClass(classId: number): boolean { return nativeOogSelectClass(classId) }

  /** Select character by name and enter game (single player) */
  oogSelectChar(name: string): boolean { return nativeOogSelectChar(name) }

  // ── Logging ────────────────────────────────────────────────────────

  log(...args: any[]) {
    const msg = args.map(a => String(a)).join(' ')
    nativeLog(`[f${this._frame}] ${msg}`)
  }

  /** Log to verbose file (aether_verbose.txt) + console, but NOT the main log. */
  logVerbose(...args: any[]) {
    const msg = args.map(a => String(a)).join(' ')
    nativeLogVerbose(`[f${this._frame}] ${msg}`)
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

/** OOG control info returned by getControls() */
export interface OogControl {
  /** Control index in snapshot */
  i: number
  /** Form type: 1=EditBox, 2=Image, 3=AnimImage, 4=TextBox, 5=Scrollbar, 6=Button, 7=List, 8=Timer, 9=Smack, 10=ProgressBar, 11=Popup, 12=AccountList, 13=ImageEx */
  type: number
  /** State/visibility flags */
  state: number
  /** Position X */
  x: number
  /** Position Y */
  y: number
  /** Width */
  w: number
  /** Height */
  h: number
  /** Text content (editbox input or button label) — only present if available */
  text?: string
}

/** D2 form type constants */
export const enum FormType {
  EditBox = 1,
  Image = 2,
  AnimImage = 3,
  TextBox = 4,
  Scrollbar = 5,
  Button = 6,
  List = 7,
  Timer = 8,
  Smack = 9,
  ProgressBar = 10,
  Popup = 11,
  AccountList = 12,
  ImageEx = 13,
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
