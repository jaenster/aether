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
} from "diablo:native"
import { UnitCollection } from "./unit.collection.js";
import { ItemUnit, Missile, Monster, ObjectUnit, PlayerUnit, Tile } from "./unit.js";
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

  clickMap(type: number, x: number, y: number, shift: boolean = false) {
    clickMap(type, shift ? 1 : 0, x, y)
  }
  move(x: number, y: number) { nativeMove(x, y) }
  /** Cast the currently selected right skill at (x, y). No skill switch. */
  castSkill(x: number, y: number) { castSkillAt(x, y) }
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

  log(...args: any[]) {
    const msg = args.map(a => String(a)).join(' ')
    nativeLog(`[f${this._frame}] ${msg}`)
  }

  /** Print colored text on the game screen (chat area). No-op in headless mode. */
  print(msg: string, color: GameColor = GameColor.White) {
    nativePrintScreen(msg, color)
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
