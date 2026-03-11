import {
  getArea, getAct, getDifficulty, inGame, getTickCount, log as nativeLog,
  getUnitX, getUnitY, getUnitHP, getUnitMaxHP, getUnitMP, getUnitMaxMP, getUnitStat,
  meGetCharName,
  clickMap, move as nativeMove, selectSkill, castSkillAt,
  getUIFlag as nativeGetUIFlag, say as nativeSay,
  getExits as nativeGetExits,
  findPath as nativeFindPath,
  findPreset as nativeFindPreset,
  interact as nativeInteract,
  exitGame as nativeExitGame,
} from "diablo:native"
import { UnitCollection } from "./unit.collection.js";
import { ItemUnit, Missile, Monster, ObjectUnit, PlayerUnit, Tile } from "./unit.js";
import { meProxy } from './me.js'
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

  get inGame() { return inGame() }
  get area() { return getArea() }
  get act() { return getAct() }
  get difficulty() { return getDifficulty() }
  get tickCount() { return getTickCount() }
  get me() { return meProxy }

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
  useSkill(skillId: number, x: number, y: number) {
    selectSkill(0, skillId)
    castSkillAt(x, y)
  }
  say(msg: string) { nativeSay(msg) }
  getUIFlag(flag: number) { return nativeGetUIFlag(flag) }
  interact(unit: { type: number, unitId: number }) { nativeInteract(unit.type, unit.unitId) }

  exitGame() { nativeExitGame(0) }

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
    nativeLog(args.map(a => String(a)).join(' '))
  }
}
