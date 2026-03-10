# Aether

Scriptable bot framework for Diablo II 1.14d. Write bots in TypeScript, inject via DLL, hot-reload on save.

## Architecture

```
User Scripts        import { createBot } from "diablo:game"
                    yield* move.walkTo(x, y)
────────────────────────────────────────────────────────
SDK (diablo:game)   Game object, Unit classes, UnitCollection,
  aether/sdk/       createBot/createService, generator-based tick system
────────────────────────────────────────────────────────
Daemon              WebSocket server, TS→JS bundler, hot-reload watcher
  packages/daemon/  Resolves imports, transpiles, serves bundles to DLL
────────────────────────────────────────────────────────
Native DLL          SpiderMonkey 60 (ES2015 modules), D2 hooks,
  packages/native/  Zig cross-compiled to x86 Windows, dbghelp proxy loader
```

### How it works

1. **Native DLL** (`packages/native/`) — Zig-based DLL that hooks into the game loop. Embeds SpiderMonkey 60 for JavaScript execution. Exposes ~40 native bindings (`diablo:native`) for game state, unit iteration, movement, skills, and interaction.

2. **Daemon** (`packages/daemon/`) — Node.js WebSocket server. Bundles TypeScript entry points with all dependencies, transpiles via SWC, and serves them to the DLL. Watches for file changes and pushes hot-reloaded bundles.

3. **SDK** (`sdk/`) — TypeScript library exported as `diablo:game`. Provides the `Game` object, typed `Unit` classes (`PlayerUnit`, `Monster`, `ItemUnit`, `ObjectUnit`, `Missile`, `Tile`), `UnitCollection` with iteration/filtering, `createBot`/`createService` patterns, and generator-based tick control.

4. **User Scripts** (`scripts/`) — Bot entry points. Use `createBot` to define a generator function that runs one step per game tick. `yield` pauses until next tick, `yield*` delegates to sub-generators. Services provide reusable behaviors (movement, attack, pickit).

## Quick Start

```bash
# Prerequisites: Zig 0.15+, Node.js 20+, Wine (for macOS)

# Build the native DLL
cd packages/native
zig build -Doptimize=ReleaseSmall

# Start the daemon
cd packages/daemon
npm run build && node dist/index.js

# Run the game with injection
export GAME_DIR=~/path/to/diablo2
bash packages/native/run.sh
```

## Writing Bots

```typescript
// scripts/main.ts
import { createBot, uiFlags } from "diablo:game"
import { Movement } from "./services/movement.js"

export default createBot('farmer', function*(game, services) {
  const move = services.get(Movement)

  while (true) {
    if (!game.inGame) { yield; continue }

    // Walk to waypoint
    const wp = game.findPreset(2, 119)
    if (wp) yield* move.walkTo(wp.x, wp.y)

    // Interact
    const obj = game.objects.find(o => o.classid === 119)
    if (obj) game.interact(obj)

    yield* game.delay(3000)
  }
})
```

### Key Patterns

- **`yield`** — pause until next game tick (~40ms)
- **`yield*`** — delegate to a sub-generator (e.g. `yield* move.walkTo(x, y)`)
- **`yield* game.delay(ms)`** — wait N milliseconds worth of game ticks
- **`createService`** — define reusable service objects with DI via `services.get(Token)`
- **`game.objects / game.monsters / game.items`** — lazy unit collections with `find`, `filter`, `closest`

### Native Bindings (`diablo:native`)

| Category | Functions |
|-|-|
| State | `getArea`, `getAct`, `getDifficulty`, `inGame`, `getTickCount` |
| Player | `getUnitX/Y`, `getUnitHP/MP`, `getUnitStat`, `meGetCharName` |
| Units | `unitCount`, `unitAtIndex`, `unitValid`, `unitGetX/Y/Mode/ClassId/Stat/Name/Area/Flags` |
| Monsters | `monGetSpecType`, `monGetEnchants` |
| Items | `itemGetQuality/Flags/Location/Code` |
| Objects | `tileGetDestArea` |
| Actions | `clickMap`, `move`, `selectSkill`, `castSkillAt`, `interact`, `say` |
| Map | `getExits`, `findPath`, `findPreset` |
| UI | `getUIFlag`, `getSkillLevel` |

## Packages

| Package | Description |
|-|-|
| `packages/native` | Zig DLL — game hooks, SpiderMonkey 60, native bindings |
| `packages/daemon` | Node.js — WebSocket server, TS bundler, hot-reload |
| `packages/spidermonkey` | SM60 ESR — CMake cross-build for MinGW |
| `packages/protocol` | Shared message types for DLL↔daemon communication |
| `sdk/` | TypeScript SDK — `diablo:game` module |
| `scripts/` | User bot scripts |

## Features

- **Generator-based tick system** — no async/await, pure ES2015 generators bound to game ticks
- **Hot-reload** — save a file, bot restarts with new code instantly
- **Headless mode** — run without rendering for faster execution
- **A\* pathfinding** — built-in pathfinder using collision grid data
- **Unit enumeration** — typed access to all game units (players, monsters, objects, items, missiles, tiles)
- **Preset search** — find waypoints, exits, and special objects via DRLG preset data
- **Service DI** — `createService` pattern with lazy instantiation and hot-reload safety
