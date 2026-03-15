import { Game, GameColor, colorText } from "./game.js"

const __g = Function('return this')() as any

// Registries survive module clear + recompile (same globalThis)
if (!__g.__svcRegistry) __g.__svcRegistry = new Map<string, ServiceToken<any>>()
if (!__g.__scriptRegistry) __g.__scriptRegistry = new Map<string, ScriptToken>()

function getCallerFile(): string {
  const stack = new Error().stack || ''
  // SM60: "fn@specifier:line:col" — caller is 2+ frames up
  const lines = stack.split('\n')
  for (let i = 2; i < lines.length; i++) {
    const m = lines[i]!.match(/@(.+?):\d+/)
    if (m && m[1] !== 'diablo:game' && !m[1]!.includes('/game/')) return m[1]!
  }
  return 'unknown'
}

// ── Services ──

type ServiceFactory<T> = (game: Game, services: ServiceContainer) => T

export interface ServiceToken<T> {
  __brand: 'service'
  factory: ServiceFactory<T>
}

export function createService<T>(factory: ServiceFactory<T>): ServiceToken<T> {
  const key = getCallerFile()
  const registry = __g.__svcRegistry as Map<string, ServiceToken<any>>

  const existing = registry.get(key)
  if (existing) {
    // Reload: update factory on the same token object
    existing.factory = factory
    return existing as ServiceToken<T>
  }

  const token: ServiceToken<T> = { __brand: 'service', factory }
  registry.set(key, token)
  return token
}

export class ServiceContainer {
  private instances = new Map<ServiceToken<any>, any>()
  constructor(private game: Game) {}

  get<T>(token: ServiceToken<T>): T {
    if (!this.instances.has(token)) {
      this.instances.set(token, token.factory(this.game, this))
    }
    return this.instances.get(token)!
  }

  /** Patch all instantiated services with updated factory methods. */
  patchAll() {
    this.game._clearPacketHooks()
    for (const [token, oldInstance] of this.instances) {
      try {
        const newInstance = token.factory(this.game, this)
        for (const key of Object.keys(newInstance)) {
          if (typeof newInstance[key] === 'function') {
            oldInstance[key] = newInstance[key]
          }
        }
      } catch (e: any) {
        this.game.log('[hot-reload] service patch error: ' + (e.message || String(e)))
      }
    }
  }
}

// ── Scripts ──

type ScriptFactory = (game: Game, svc: ServiceContainer) => Generator<void>

export interface ScriptToken {
  __brand: 'script'
  factory: ScriptFactory
}

export function createScript(factory: ScriptFactory): ScriptToken {
  const key = getCallerFile()
  const registry = __g.__scriptRegistry as Map<string, ScriptToken>

  const existing = registry.get(key)
  if (existing) {
    existing.factory = factory
    return existing
  }

  const token: ScriptToken = { __brand: 'script', factory }
  registry.set(key, token)
  return token
}

// ── Bot ──

type BotFactory = (game: Game, services: ServiceContainer) => Generator<void>

export interface BotToken {
  __brand: 'bot'
  name: string
  factory: BotFactory
}

interface BotState {
  game: Game
  svc: ServiceContainer
  mainGen: Generator<void> | null
  activeGens: Generator<void>[]
  wasInGame: boolean
  frameCount: number
  pendingFactory: BotFactory | null
}

export function createBot(name: string, factory: BotFactory): BotToken {
  const token: BotToken = { __brand: 'bot', name, factory }

  // Check for existing bot state (hot-reload)
  const existingState = __g.__botState as BotState | undefined
  if (existingState) {
    // Hot-reload: patch services, queue new factory for next game join
    existingState.pendingFactory = factory
    existingState.svc.patchAll()
    existingState.game.log('[' + name + '] hot-reloaded — services patched, new bot factory queued')
    return token
  }

  // First load: set up fresh state
  const game = new Game()
  const svc = new ServiceContainer(game)

  const state: BotState = {
    game,
    svc,
    mainGen: null,
    activeGens: [],
    wasInGame: false,
    frameCount: 0,
    pendingFactory: null,
  }
  __g.__botState = state

  function startScripts(scripts: ScriptToken[]): Generator<void>[] {
    const gens: Generator<void>[] = []
    for (const s of scripts) {
      try {
        gens.push(s.factory(game, svc))
      } catch (e: any) {
        game.log('[' + name + '] script start error: ' + (e.message || String(e)))
      }
    }
    return gens
  }

  // Packet hook — called synchronously from native before S2C handler dispatch
  __g.__onPacket = function onPacket(opcode: number): boolean {
    return game._handlePacket(opcode)
  }

  // Tick profiling — accumulate time in key sections
  let _profAccum = { main: 0, bg: 0, total: 0, frames: 0, lastReport: 0 }

  __g.__onTick = function onTick() {
    const tickStart = game.tickCount
    state.frameCount++
    game._frame = state.frameCount
    const nowInGame = game.inGame

    // Detect game state transitions
    if (!state.wasInGame && nowInGame) {
      // Joined game — consume pending factory if hot-reload happened
      if (state.pendingFactory) {
        game.load.clear()
        game._clearPacketHooks()
        // Re-create service container with updated token factories
        const newSvc = new ServiceContainer(game)
        state.svc = newSvc
        state.mainGen = state.pendingFactory(game, newSvc)
        state.pendingFactory = null
      }

      state.frameCount = 0
      game._frame = 0
      game.log('[' + name + '] joined game')
      state.activeGens = [
        ...startScripts(game.load.inGameScripts),
        ...startScripts(game.load.alwaysScripts),
      ]
    } else if (state.wasInGame && !nowInGame) {
      // Left game — kill inGame, start oog + always scripts
      game.clearPlayer()
      game.log('[' + name + '] left game')
      state.activeGens = [
        ...startScripts(game.load.oogScripts),
        ...startScripts(game.load.alwaysScripts),
      ]
    }
    state.wasInGame = nowInGame

    // Create main generator on first tick
    if (!state.mainGen) {
      state.mainGen = factory(game, state.svc)
    }

    // Step main generator
    const mainStart = game.tickCount
    try {
      const r = state.mainGen.next()
      if (r.done) state.mainGen = null
    } catch (e: any) {
      const errMsg = '[' + name + '] FATAL: ' + (e.message || String(e))
      game.log(errMsg)
      game.print(colorText(errMsg, GameColor.Red))
      state.mainGen = null
      game.exitGame()
      return
    }
    _profAccum.main += game.tickCount - mainStart

    // Step all active background generators, remove finished ones
    const bgStart = game.tickCount
    const alive: Generator<void>[] = []
    for (const gen of state.activeGens) {
      try {
        const r = gen.next()
        if (!r.done) alive.push(gen)
      } catch (e: any) {
        const errMsg = '[' + name + '] script error: ' + (e.message || String(e))
        game.log(errMsg)
        game.print(colorText(errMsg, GameColor.Red))
      }
    }
    state.activeGens = alive
    _profAccum.bg += game.tickCount - bgStart

    // Total tick time
    _profAccum.total += game.tickCount - tickStart
    _profAccum.frames++

    // Report every 10s
    if (tickStart - _profAccum.lastReport >= 10000) {
      _profAccum.lastReport = tickStart
      if (_profAccum.frames > 0) {
        game.log(`[perf] JS tick: total=${_profAccum.total}ms main=${_profAccum.main}ms bg=${_profAccum.bg}ms (${_profAccum.frames} frames)`)
      }
      _profAccum.total = 0
      _profAccum.main = 0
      _profAccum.bg = 0
      _profAccum.frames = 0
    }
  }

  return token
}
