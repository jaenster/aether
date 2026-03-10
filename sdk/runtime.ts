import {
  getArea, getAct, getDifficulty, inGame, getTickCount, log as nativeLog,
  getUnitX, getUnitY, getUnitHP, getUnitMaxHP, getUnitMP, getUnitMaxMP, getUnitStat,
  meGetCharName,
  clickMap, move as nativeMove, selectSkill, castSkillAt,
  getUIFlag as nativeGetUIFlag, say as nativeSay,
} from "diablo:native"
import { ServiceContainer, type BotToken } from "./service.ts"
import { PlayerUnit, Monster, ItemUnit, ObjectUnit, Missile, Tile } from "./unit.ts"
import { UnitCollection } from "./collection.ts"

export interface Game {
  readonly inGame: boolean
  readonly area: number
  readonly act: number
  readonly difficulty: number
  readonly tickCount: number

  readonly me: MeProxy

  readonly players: UnitCollection<PlayerUnit>
  readonly monsters: UnitCollection<Monster>
  readonly objects: UnitCollection<ObjectUnit>
  readonly missiles: UnitCollection<Missile>
  readonly items: UnitCollection<ItemUnit>
  readonly tiles: UnitCollection<Tile>

  clickMap(type: number, x: number, y: number, shift?: boolean): void
  move(x: number, y: number): void
  useSkill(skillId: number, x: number, y: number): void
  say(msg: string): void
  getUIFlag(flag: number): boolean

  delay(ms: number): Generator<void>
  log(...args: any[]): void
}

interface MeProxy {
  readonly x: number
  readonly y: number
  readonly hp: number
  readonly hpmax: number
  readonly mp: number
  readonly mpmax: number
  readonly charname: string
  getStat(stat: number, layer?: number): number
}

const meProxy: MeProxy = {
  get x() { return getUnitX() },
  get y() { return getUnitY() },
  get hp() { return getUnitHP() },
  get hpmax() { return getUnitMaxHP() },
  get mp() { return getUnitMP() },
  get mpmax() { return getUnitMaxMP() },
  get charname() { return meGetCharName() },
  getStat(stat: number, layer: number = 0) { return getUnitStat(stat, layer) },
}

const _players = new UnitCollection<PlayerUnit>(0)
const _monsters = new UnitCollection<Monster>(1)
const _objects = new UnitCollection<ObjectUnit>(2)
const _missiles = new UnitCollection<Missile>(3)
const _items = new UnitCollection<ItemUnit>(4)
const _tiles = new UnitCollection<Tile>(5)

export const game: Game = {
  get inGame() { return inGame() },
  get area() { return getArea() },
  get act() { return getAct() },
  get difficulty() { return getDifficulty() },
  get tickCount() { return getTickCount() },
  get me() { return meProxy },

  get players() { return _players },
  get monsters() { return _monsters },
  get objects() { return _objects },
  get missiles() { return _missiles },
  get items() { return _items },
  get tiles() { return _tiles },

  clickMap(type: number, x: number, y: number, shift: boolean = false) {
    clickMap(type, shift ? 1 : 0, x, y)
  },
  move(x: number, y: number) { nativeMove(x, y) },
  useSkill(skillId: number, x: number, y: number) {
    selectSkill(0, skillId)
    castSkillAt(x, y)
  },
  say(msg: string) { nativeSay(msg) },
  getUIFlag(flag: number) { return nativeGetUIFlag(flag) },

  *delay(ms: number) {
    const start = getTickCount()
    while (getTickCount() - start < ms) yield
  },

  log(...args: any[]) {
    nativeLog(args.map(a => String(a)).join(' '))
  },
}

// --- Bootstrap globals ---
const __g = Function('return this')()
let botGenerator: Generator<void> | null = null

__g.__onTick = () => {
  if (!botGenerator) return
  try {
    const result = botGenerator.next()
    if (result.done) {
      nativeLog("bot finished")
      botGenerator = null
    }
  } catch (e) {
    nativeLog("bot error: " + String(e))
    botGenerator = null
  }
}

__g.__setRoot = (token: BotToken) => {
  const container = new ServiceContainer(game)
  botGenerator = token.factory(game, container)
  nativeLog("bot '" + token.name + "' started")
}
