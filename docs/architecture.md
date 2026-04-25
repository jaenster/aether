# Aether Architecture

## Overview

Aether is a scripting and automation platform for Diablo 2 1.14d. It embeds a V8 JavaScript engine inside the game process (32-bit Windows, cross-compiled from macOS ARM), connects to an external daemon over WebSocket, and serves TypeScript scripts from the daemon's filesystem.

The system replaces the D2BS/Kolbot stack with modern tooling: TypeScript-first scripting, V8 instead of SpiderMonkey, WebSocket coordination instead of chat channels, and server-side game interaction instead of UI automation.

## Layering

```
┌─────────────────────────────────────────────────────────┐
│  User Scripts (.ts)                                     │
│  import { Unit } from "diablo2:unit"                    │
│  import { moveTo } from "diablo2:move"                  │
├─────────────────────────────────────────────────────────┤
│  @aether/sdk — multi-step flows (town runs, MF routes)  │
│  Composes diablo2:* modules into workflows               │
├─────────────────────────────────────────────────────────┤
│  @aether/runtime — diablo2:* TS modules                 │
│  diablo2:game, diablo2:unit, diablo2:move, ...          │
│  All import from diablo2:native                         │
├─────────────────────────────────────────────────────────┤
│  diablo2:native — V8-backed module (Zig comptime)       │
│  Flat functions: getUnitX(ptr), readMemory(addr), ...   │
│  Only module resolved locally inside the DLL            │
├─────────────────────────────────────────────────────────┤
│  V8 Engine (embedded in Aether.dll)                     │
│  Isolate + contexts, microtask pump, module resolution  │
├─────────────────────────────────────────────────────────┤
│  Zig Native Layer (Aether.dll)                          │
│  Feature hooks, patches, fiber async, crash handler     │
│  17 existing feature modules (map reveal, pathing, etc) │
├─────────────────────────────────────────────────────────┤
│  Diablo 2 1.14d (Game.exe)                              │
│  32-bit Windows, MSVC-compiled, single binary           │
└─────────────────────────────────────────────────────────┘

        ↕ WebSocket (JSON protocol)

┌─────────────────────────────────────────────────────────┐
│  @aether/daemon — Node.js WebSocket server              │
│  Virtual filesystem, SWC transpiler, service registry   │
│  Message routing, file watcher, module resolution       │
├─────────────────────────────────────────────────────────┤
│  Extensions (ext-webui, ext-starter, ext-mcp, ...)      │
│  Independent processes, connect via same protocol       │
└─────────────────────────────────────────────────────────┘
```

## Package Structure

```
aether/
├── packages/
│   ├── native/          Zig DLL — hooks, patches, V8 embed, diablo2:native
│   ├── protocol/        TS — WebSocket message schemas, shared types (zero deps)
│   ├── types/           TS .d.ts — diablo2:* type declarations (publishable)
│   ├── daemon/          TS/Node — WebSocket server, virtual FS, SWC, service registry
│   ├── runtime/         TS — diablo2:* module implementations, bootstrap loader
│   ├── sdk/             TS — ergonomic multi-step flows (publishable)
│   └── ext-*/           TS/Node — extensions (webui, starter, mcp, etc.)
├── docs/                Design documents (this directory)
├── package.json         @aether/aether workspace root
├── pnpm-workspace.yaml
└── turbo.json
```

### Package Responsibilities

| Package | Language | Runtime | Purpose |
|-|-|-|-|
| `native` | Zig | Game process | DLL entry, hooks, V8 embed, `diablo2:native` bindings |
| `protocol` | TS | Shared | Message types, schemas, version negotiation (zero deps) |
| `types` | TS `.d.ts` | Editor only | Type declarations for `diablo2:*` (publishable to npm) |
| `daemon` | TS/Node | Host machine | WebSocket server, virtual FS, SWC, service registry |
| `runtime` | TS | Game process (via V8) | `diablo2:*` module implementations, bootstrap |
| `sdk` | TS | Game process (via V8) | Multi-step flows, cross-domain orchestration |
| `ext-*` | TS/Node | Host machine | Independent extension processes |

## Design Principles

### 1. V8 on the game thread
Single-threaded, pumped each tick. No cross-thread sync. The existing `feature.Hooks` dispatcher calls `gameLoop` every frame — V8 microtask pump is just another feature hook.

### 2. Engine abstraction layer
V8-specific code isolated behind an interface in Zig. If V8 32-bit proves painful long-term, the interface allows swapping engines without touching game bindings or runtime.

### 3. Daemon-as-filesystem
The DLL has zero disk access for scripts. V8 module requests go to the daemon over WebSocket. The daemon reads from disk, SWC-strips `.ts` → `.js`, returns the result. All file I/O and TypeScript tooling stays on the daemon side (Node.js), out of the 32-bit address space.

### 4. Daemon required for scripting
Since the daemon IS the filesystem, V8 scripting needs a running daemon. The DLL without a daemon still works as a native-only tool — existing Zig features (map reveal, pathing, auto-move) function independently.

### 5. Sandboxed execution contexts
One V8 isolate, two contexts (same thread, same heap):
- **OOG Context** (persistent) — survives game sessions. Menus, lobby, daemon connection, script state between games. Pumped via `oogLoop`.
- **In-Game Context** (sandbox) — created on game join, destroyed on game leave. Clean teardown: no leaked handlers, no stale pointers. Access OOG context via explicit bridge.

Server-side context deferred — D2 1.14d server runs on a separate thread, V8 isolates are single-threaded.

### 6. Scripting as a feature module
`scripting.zig` registers with the existing `Hooks` system via `feature.register()`. Zero changes to other features. They coexist.

### 7. Comptime binding generation
Zig `comptime` reflection auto-generates V8 bindings from Zig function signatures. Adding a new function to JS requires zero manual binding code.

### 8. Server-side first
In 1.14d, client and server are in the same process. Instead of automating the UI (D2BS-style `clickMap`, `clickItem`), call server functions directly or send packets. Movement = `sendRunToLocation()`, not click-and-wait-for-animation. The `diablo2:native` bindings expose D2Game/server functions, not D2Client/UI functions where possible.

### 9. No file I/O from scripts
Scripts never write to disk. All persistence goes through the daemon. Prevents corruption and filesystem races.

### 10. Memory patches from TypeScript
The native layer exposes patch primitives to JS (`diablo2:patch`). Scripts can define and apply memory patches without recompiling Zig.

### 11. Async/await on ticks
V8 microtask queue drained inside `gameLoop`/`oogLoop` dispatches. Each game tick = one event loop pump. `await nextTick()` yields to next dispatch. Scripts behave identically at normal or accelerated speed.

### 12. Daemon I/O between ticks
WebSocket send/receive happens between game loop ticks. Scripts never block on network. Per-frame flow: flush WS outbox → poll WS inbox → pump V8 microtasks → game tick continues.

### 13. Hybrid native/TS
Performance-critical code (pathing, collision, A*) stays native Zig. Logic/UI features are candidates for TS over time.

### 14. Daemon is pure routing/state
Does NOT launch games — that's `ext-starter` or manual `run.sh`.

### 15. Protocol is the spine
Every process speaks WebSocket + JSON via `@aether/protocol`. Daemon, game instances, and extensions all use the same wire format.

## Module Resolution

The `diablo2:native` module is the only one resolved locally inside the DLL (V8-backed, comptime-generated bindings). All other modules are resolved by the daemon:

1. **`diablo2:native`** → V8 ObjectTemplate, resolved locally
2. **`diablo2:*`** → TS files in `@aether/runtime`, served from daemon
3. **Relative/bare imports** → resolved by daemon using Node.js algorithm

To solve V8's synchronous `ResolveModuleCallback` vs async WebSocket fetch: the daemon resolves the entire dependency graph server-side. DLL requests an entry point → daemon walks imports recursively, SWC-strips each `.ts`, returns a full module bundle. DLL registers all modules in V8, then instantiates.

## Execution Contexts

### OOG Context (persistent)
- Active during menus, lobby, character select
- Pumped via `oogLoop` hook
- Survives game sessions — daemon connection, config, persistent state
- `diablo2:oog` module active here

### In-Game Context (sandbox)
- Created on game join, destroyed on game leave
- Pumped via `gameLoop` hook
- Game-specific: unit refs, area data, active handlers
- Clean teardown prevents state leaks between games
- Access OOG context via explicit bridge (shared config, daemon handle)

## Data Flow

```
Game Tick:
  1. Flush WebSocket outbox (queued messages from last tick)
  2. Poll WebSocket inbox (responses from daemon, messages from other clients)
  3. Pump V8 microtask queue (resolve promises, run callbacks)
  4. Game logic continues (existing feature hooks fire normally)
```

## Implementation Phases

| Phase | Name | Duration | Dependencies | Risk |
|-|-|-|-|-|
| 0 | V8 x86 Spike | 1-2 weeks | None | High — go/no-go gate |
| 1 | Daemon Foundation | 1-2 weeks | None (parallel with 0) | Low |
| 2 | Engine Integration | 2-3 weeks | Phase 0 | Medium |
| 3 | WebSocket + Runtime + Modules | 3-4 weeks | Phases 1, 2 | Medium |
| 4 | Multi-Client Coordination | 2-3 weeks | Phase 3 | Low-Medium |
| 5 | SDK & Script Library | 3-4 weeks | Phases 3, 4 | Low |
| 6 | Extensions | Ongoing | Phase 4 | Low |

Phases 0 and 1 run in parallel. Everything else sequences from there.
