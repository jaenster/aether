import { Game } from "./game.js"

// ── Services ──

type ServiceFactory<T> = (game: Game, services: ServiceContainer) => T

export interface ServiceToken<T> {
  __brand: 'service'
  factory: ServiceFactory<T>
}

export function createService<T>(factory: ServiceFactory<T>): ServiceToken<T> {
  return { __brand: 'service', factory }
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
}

// ── Scripts ──

type ScriptFactory = (game: Game, svc: ServiceContainer) => Generator<void>

export interface ScriptToken {
  __brand: 'script'
  factory: ScriptFactory
}

export function createScript(factory: ScriptFactory): ScriptToken {
  return { __brand: 'script', factory }
}

// ── Bot ──

type BotFactory = (game: Game, services: ServiceContainer) => Generator<void>

export interface BotToken {
  __brand: 'bot'
  name: string
  factory: BotFactory
}

export function createBot(name: string, factory: BotFactory): BotToken {
  const token: BotToken = { __brand: 'bot', name, factory }

  // Install scheduler on globalThis.__onTick
  const game = new Game()
  const svc = new ServiceContainer(game)

  let mainGen: Generator<void> | null = null
  let activeGens: Generator<void>[] = []
  let wasInGame = false

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

  const __g = Function('return this')()
  __g.__onTick = function onTick() {
    const nowInGame = game.inGame

    // Detect game state transitions
    if (!wasInGame && nowInGame) {
      // Joined game — start inGame + always scripts
      game.log('[' + name + '] joined game')
      activeGens = [
        ...startScripts(game.load.inGameScripts),
        ...startScripts(game.load.alwaysScripts),
      ]
    } else if (wasInGame && !nowInGame) {
      // Left game — kill inGame, start oog + always scripts
      game.log('[' + name + '] left game')
      activeGens = [
        ...startScripts(game.load.oogScripts),
        ...startScripts(game.load.alwaysScripts),
      ]
    }
    wasInGame = nowInGame

    // Create main generator on first tick
    if (!mainGen) {
      mainGen = factory(game, svc)
    }

    // Step main generator
    try {
      const r = mainGen.next()
      if (r.done) mainGen = null
    } catch (e: any) {
      game.log('[' + name + '] main error: ' + (e.message || String(e)))
      mainGen = null
    }

    // Step all active background generators, remove finished ones
    const alive: Generator<void>[] = []
    for (const gen of activeGens) {
      try {
        const r = gen.next()
        if (!r.done) alive.push(gen)
      } catch (e: any) {
        game.log('[' + name + '] script error: ' + (e.message || String(e)))
      }
    }
    activeGens = alive
  }

  return token
}
