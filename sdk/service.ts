import type { Game } from "./runtime.ts"

type ServiceFactory<T> = (game: Game, services: ServiceContainer) => T

export interface ServiceToken<T> {
  __brand: 'service'
  factory: ServiceFactory<T>
}

export function createService<T>(factory: ServiceFactory<T>): ServiceToken<T> {
  return { __brand: 'service', factory }
}

type BotFactory = (game: Game, services: ServiceContainer) => Generator<void>

export interface BotToken {
  __brand: 'bot'
  name: string
  factory: BotFactory
}

export function createBot(name: string, factory: BotFactory): BotToken {
  const token: BotToken = { __brand: 'bot', name, factory }
  // Auto-register: runtime.ts sets __setRoot on global before entry module evaluates
  const __g = Function('return this')()
  if (__g.__setRoot) {
    __g.__setRoot(token)
  }
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
}
