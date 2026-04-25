# Aether Scripting System — Long-Term Implementation Plan

## Context

Aether is a Zig DLL injected into Diablo 2 1.14d (32-bit Windows, cross-compiled from macOS ARM via `zig build`). It has 17 feature modules (map reveal, pathing, auto-move, etc.) with a clean hook/dispatch system, fiber-based async (`ConvertThreadToFiber`/`SwitchToFiber`), and a dbghelp proxy loader. No scripting engine, no networking.

The goal is to embed a JavaScript engine (V8) in the game process, build a TypeScript-first scripting runtime, and add a lean WebSocket daemon for multi-client coordination — replacing the aging D2BS/SpiderMonkey/Kolbot stack with modern tooling.

### Prior Art: D2BS/Kolbot Architecture
D2BS proved this concept works. Its three-layer split is the right model:
- **D2Bot.exe** (C# launcher) — spawns game instances, injects DLL, manages multi-bot
- **D2BS.dll** (SpiderMonkey runtime) — hooks into game, exposes APIs to JS
- **Kolbot** (JS script library) — bot logic, built on D2BS APIs

Known D2BS limitations we aim to fix:
- SpiderMonkey is unmaintained (circa 2010)
- No TypeScript, no type safety, no IDE support
- Single JS context per process, no real async
- Direct pointer exposure (unsafe), no typed API layer
- Multi-bot coordination via chat channels (fragile)
- **Heavily client-side** — D2BS automates the UI (clickMap, clickItem, etc.), simulating human input. Brittle, slow, animation-dependent. We want the opposite: communicate with the server directly.

---

## Package Structure

```
aether/
├── packages/
│   ├── native/          Zig DLL — hooks, patches, V8 embed, diablo2: native modules
│   ├── protocol/        TS — WebSocket message schemas, shared types (zero deps)
│   ├── types/           TS .d.ts — diablo2:* type declarations (publishable)
│   ├── daemon/          TS/Node — WebSocket server, service registry, SWC transpiler
│   ├── runtime/         TS→bundled JS — module loader, node_modules resolver, loaded by native
│   ├── sdk/             TS — ergonomic wrappers over diablo2:* imports (publishable)
│   └── ext-*/           TS/Node — extensions (webui, starter, mcp, etc.)
├── package.json         @aether/aether workspace root
├── pnpm-workspace.yaml
└── turbo.json
```

### Package Responsibilities

**`@aether/native`** (Zig)
- DLL entry, feature registration, hook dispatch (existing)
- V8 isolate lifecycle, context management
- **`diablo2:native`** — the single V8-backed module. Flat, dumb functions (`getUnitX(ptr)`, `readMemory(addr)`, `callGameFn(addr, args)`). Resolved by V8 module resolver directly — the only module NOT served from the daemon. Typed via `@aether/types`.
- All other `diablo2:*` modules (`diablo2:game`, `diablo2:units`, etc.) are **TypeScript** that `import from "diablo2:native"` and build smart APIs on top. They live on the daemon filesystem as part of `@aether/runtime`. Hot-reloadable, debuggable, writable by the community without touching Zig.
- WebSocket client connecting back to daemon (Win32 sockets)
- Engine abstraction layer — V8-specific code isolated behind an interface

**`@aether/protocol`** (TS, zero deps)
- Message types for daemon ↔ client communication
- Service registration/discovery protocol
- Event schemas (game state changes, script lifecycle)
- Versioned — clients and daemon negotiate protocol version

**`@aether/types`** (TS `.d.ts`, publishable)
- Type declarations for all `diablo2:*` modules
- Published to npm so script authors get IntelliSense
- No runtime code — pure type definitions

**`@aether/daemon`** (TS/Node)
- WebSocket server (ws library)
- **Virtual filesystem**: game clients request files by path, daemon reads from disk, SWC-strips `.ts` → `.js`, returns result. The daemon IS the filesystem for game instances.
- File watcher: monitors script directories, sends invalidation to connected clients on change
- Service registry: clients connect, register name/type, become discoverable
- Message router: client-to-client via daemon relay
- Client state tracking (which game instance is in which area, etc.)
- CLI: `pnpm --filter daemon start`

**`@aether/runtime`** (TypeScript, served from daemon)
- **Contains the `diablo2:*` module implementations in TypeScript** — the smart layer on top of raw native bindings. `diablo2:game`, `diablo2:units`, `diablo2:oog`, etc. are all TS files calling V8-registered native functions via `diablo2:native`.
- Only the tiny bootstrap loader (~50 lines) is embedded in the DLL as a string constant. Everything else is served from the daemon.
- Module resolver (registered by bootstrap):
  - `diablo2:native` → V8-backed module (the only native module, resolved locally)
  - `diablo2:*` (all others) → TS modules in this package, resolved by daemon
  - All other imports → resolved by daemon (relative paths, bare specifiers/node_modules)
- Module cache: DLL caches resolved modules, daemon sends invalidation on file change
- Tick-based scheduling primitives: `nextTick()`, `ticks(n)`, promise integration
- Console polyfill routing to native log

**`@aether/sdk`** (TS, publishable)
- **Multi-step flows and cross-domain orchestration** — the layer above `diablo2:*` modules.
- Boundary rule: `diablo2:*` modules own their domain classes (`Unit`, `Player`, etc.). The SDK composes them into workflows.
- Common flows: town portal, vendor, stash, repair
- OOG utilities: character select, game creation/joining
- Async patterns: `await sdk.townPortal()`, `await sdk.waitForArea(areaId)`
- Depends on `@aether/types`
- Hot-reloadable — lives on daemon filesystem, not compiled into the DLL

---

## Implementation Phases

### First Step: Write Design Documents
**Duration:** This session
**Risk:** None

Before writing any code, write detailed design docs inside the aether repo. One doc per major component, co-located in the workspace root.

Create `aether/docs/`:
- `docs/architecture.md` — Overall system architecture, the layering diagram, design principles (all 15 decisions from this plan)
- `docs/native.md` — `diablo2:native` binding surface, what Zig functions to expose, comptime binding generation approach, V8 integration details
- `docs/daemon.md` — Daemon design: WebSocket server, virtual filesystem protocol, SWC pipeline, service registry, module resolution algorithm
- `docs/runtime.md` — Runtime bootstrap, module resolver, `diablo2:*` TS module catalog, tick scheduling, console/timer polyfills, sandbox lifecycle
- `docs/protocol.md` — Wire protocol: all message types (`file:request`, `service:register`, `message:relay`, etc.), JSON schemas, versioning
- `docs/v8-spike.md` — V8 x86-windows integration plan, monolith linking strategy, C bridge API design, success criteria

These docs are the source of truth. Code implements the docs, not the other way around.

---

### Phase 0: V8 x86 Spike — Go/No-Go Gate
**Duration:** 1-2 weeks
**Risk:** High — this is the project's critical path

**Objective:** Prove V8 can run inside a 32-bit Windows process, cross-compiled from macOS ARM.

**Existing asset:** `aether/v8_monolith.zip` (640MB) contains pre-built MSVC static libs:
- `libs/x86/release/v8_monolith.lib` — 605MB, x86 Windows, MSVC ABI
- `libs/x86/debug/v8_monolith.lib` — 737MB, with debug symbols
- From April 2020 (V8 ~8.3, Chrome 83 era). Old but x86 was fully supported then.
- **No headers included** — must source matching V8 8.3 headers separately.
- **MSVC-compiled** — `.lib` + `.pdb` = MSVC toolchain. Our Zig DLL targets `x86-windows-gnu` (MinGW ABI).

**Steps:**
1. **Trim the zip** — extract only `libs/x86/release/v8_monolith.lib`. Delete the rest (x64, debug, PDBs). Store outside git (too large). Add to `.gitignore`.
2. **Source V8 ~8.3 headers** — check out V8 tag matching April 2020 (8.3.x), extract `include/` directory. These are C++ headers.
3. **Single binary with C bridge** — V8 has a C++ API; Zig can't call C++ directly. Write a thin `v8_bridge.cpp` (~200 lines) with `extern "C"` functions (`v8_init()`, `v8_eval()`, `v8_pump_microtasks()`, etc.).
   - Switch Zig target from `.abi = .gnu` to `.abi = .msvc` — all our game calls already use explicit `callconv(.winapi)`, and D2 itself is MSVC-compiled, so this is actually more compatible.
   - Add `v8_bridge.cpp` to the build via Zig's `addCSourceFiles` (Zig bundles clang, handles C++ compilation).
   - Link `v8_monolith.lib` (x86, MSVC, UCRT — same CRT as D2 1.14d) via Zig's build system.
   - Result: **single Aether.dll** containing both Zig code and V8. No extra DLLs, no runtime loading.
4. **Standalone test**: 32-bit Windows .exe that loads v8_bridge.dll, inits V8, evals `"1+1"`, prints result. Run under Wine.
5. **Move into DLL**: same test but from `DllMain` in Aether.dll, injected into Game.exe.
6. **Validate**: no address space conflicts, no symbol clashes, JIT memory allocation works post-injection.

**Success criteria:** `aether_log.txt` prints "V8: 2" from inside running Game.exe.

**Failure modes & mitigations:**
- `.abi = .msvc` switch breaks existing hooks → test incrementally: first build without V8, verify game still works, then add V8. All game calls use explicit `callconv(.winapi)` so this should be transparent.
- Zig's clang can't compile `v8_bridge.cpp` → V8's C++ API is standard, no exotic extensions. If needed, compile bridge externally with clang-cl, add the .obj to Zig's link step.
- V8 headers for 8.3 unavailable → V8 is open source, `git checkout` the matching tag from `v8/v8`
- Linked DLL too large for 32-bit address space → the 605MB .lib is static; linked code will be ~30MB. Game uses ~200MB. Plenty of room in 4GB.
- JIT pages fail `VirtualAlloc(PAGE_EXECUTE_READWRITE)` post-injection → test with JIT disabled first (V8 has interpreter-only mode)
- V8 8.3 too old for needed JS features → SWC on daemon side can downlevel. Rebuild newer V8 from source later using same approach.

**What NOT to do in this phase:**
- No daemon, no protocol, no types packages
- No game API exposure — just `eval("1+1")`
- No module system — raw string eval only

---

### Phase 1: Daemon Foundation (parallel with Phase 0)
**Duration:** 1-2 weeks
**Risk:** Low — standard Node.js/TS

**Objective:** WebSocket server that accepts connections and routes messages between services.

**Steps:**
1. Create `packages/protocol/` — message type definitions in TypeScript
   - `ServiceRegister`, `ServiceDiscover`, `MessageRelay`, `ScriptPush`, `ScriptResult`
   - Versioned protocol (start at v1, negotiated on connect)
2. Create `packages/daemon/` — Node.js + TypeScript
   - WebSocket server (ws library), configurable port
   - Service registry: `Map<clientId, ServiceInfo>`
   - Message routing: client A sends to client B via daemon relay
   - File watcher: monitor a scripts directory for `.ts` changes
   - SWC integration: on file change, strip types → cache `.js` output
   - Basic CLI entry point
3. Integration test: two test clients connect, register, discover each other, exchange messages

**Deliverable:** `pnpm --filter daemon dev` starts a WebSocket server. Test clients can register, discover, and communicate.

4. **WebSocket transport spike** (in parallel): standalone Zig DLL that connects to the daemon's WS server and exchanges messages. Validates Zig raw sockets on Win32 under Wine before Phase 3 depends on it. 2 days of work.

**Key decisions:**
- Port: configurable, default 13119 (same as existing reference)
- Auth: optional token via env var, not enforced by default
- No HTTP server — pure WebSocket (HTTP can be added for web UI later)
- Daemon disconnect: DLL continues running with native-only features. Scripts pause. Reconnect with backoff. No crash.

---

### Phase 2: Engine Integration Layer
**Duration:** 2-3 weeks
**Risk:** Medium — depends on Phase 0 succeeding
**Depends on:** Phase 0

**Objective:** V8 runs on the game thread, pumped every tick, with a clean abstraction boundary.

**Steps:**
1. Design the engine abstraction interface in Zig:
   ```
   Engine.init() → Engine
   Engine.eval(js_string) → Result
   Engine.pumpMicrotasks()
   Engine.registerModule(name, bindings)
   Engine.deinit()
   ```
   V8 implementation behind this interface. If we ever need to swap engines, only this layer changes.

2. New feature module: `src/features/scripting.zig`
   - Registers with existing `feature.Hooks` system — zero changes to other features
   - `init`: create V8 isolate + three V8 contexts (OOG, in-game client, in-game server)
   - `gameLoop`: pump client-side context microtask queue
   - `oogLoop`: pump OOG context microtask queue
   - Server-side context: needs a separate hook point into the game server tick
   - `deinit`: tear down all contexts + isolate
   - Context lifecycle: OOG context active during menus; client context created on game join, destroyed on game leave; server context tied to game server lifecycle

3. Tick-based scheduling integration:
   - The existing fiber system (`async.zig`) runs one task at a time via `SwitchToFiber`
   - V8 promises resolve differently: microtask queue drained each tick
   - These are complementary, not conflicting — fibers for Zig async, microtasks for JS async
   - `nextTick()` in JS = promise that resolves on next `gameLoop` dispatch

4. Implement `diablo2:native` — the single V8-backed module:
   - Flat functions: `getArea()`, `getAct()`, `getUnitX(ptr)`, `getUnitLife(ptr)`, `readMemory(addr, size)`, etc.
   - Registered as a V8 module at context creation — resolved locally, not from daemon
   - Implemented via `comptime` binding generation: Zig struct/fn → V8 bindings automatically
   ```zig
   // comptime generates all V8 binding glue from Zig function signatures
   runtime.registerNativeFn("getArea", d2.functions.getArea);
   ```
   No `diablo2:game` or other smart modules yet — those come in Phase 3 as TypeScript.

5. Set explicit V8 heap limit (64-128MB) to stay within 32-bit address space budget. Add heap usage logging.

**Deliverable:** A hardcoded JS string runs inside the game, calls `native.getArea()` via `diablo2:native`, result appears in log.

---

### Phase 3: WebSocket Client, Runtime & Module System
**Duration:** 3-4 weeks
**Risk:** Medium — Zig networking on Win32 + module resolution
**Depends on:** Phase 1 (daemon exists), Phase 2 (V8 bridge exists)

**Objective:** DLL connects to daemon over WebSocket. Scripts load via daemon-as-filesystem. TypeScript works. Full module resolution.

**Part A — WebSocket client in Zig:**
1. WebSocket client (Win32 raw sockets — `ws2_32.dll` imports)
   - Connect to daemon on init (host:port from command-line flag, e.g. `-daemon 127.0.0.1:13119`)
   - WebSocket handshake (HTTP upgrade), then binary/text frames
   - Reconnect on disconnect with backoff

2. Protocol implementation:
   - `file:request` / `file:response` — virtual filesystem
   - `file:invalidate` — daemon notifies client of changed files
   - `service:register` / `service:discover` — service registry
   - `message:relay` — client-to-client messaging (Phase 4)
   - `state:update` — game instance reports its state to daemon

**Part B — Runtime & Module System:**
3. Create `packages/runtime/` — the JS bootstrap loaded by native at V8 init
   - Custom module resolver registered with V8:
     - `diablo2:native` → V8-backed module (the only native module, resolved locally)
     - `diablo2:*` (all others) → TypeScript modules in this package, served from daemon FS
     - All other imports → request file from daemon over WebSocket (pull-based)
   - Daemon-side resolution: full Node.js module resolution algorithm (package.json `exports`/`main`, conditional exports, nested node_modules). Non-trivial — use a proven resolver library (e.g. `enhanced-resolve`).
   - SWC type-stripping: must preserve `diablo2:*` import specifiers — validate early
   - Module cache in DLL: cache resolved modules by path, invalidate when daemon sends file-change notification
   - Console polyfill: `console.log()` → native `log.print()`
   - Timer polyfill: `setTimeout`/`setInterval` → tick-based scheduling
   - The bootstrap loader (~50 lines of JS) is embedded in the DLL as a string constant. Everything else comes from the daemon. No bundling of the full runtime — daemon-served only.

4. Create `packages/types/` — `.d.ts` for all `diablo2:*` modules
   - Script authors: `npm install @aether/types`
   - Editors get full IntelliSense for `import { getArea } from "diablo2:game"`

5. Implement `diablo2:*` TypeScript modules in `@aether/runtime` (all import from `diablo2:native`):
   - `diablo2:game` — area, act, difficulty, game state, tick count
   - `diablo2:unit` — `Unit` class with getters/setters (`unit.x`, `unit.life`, `unit.name`), `getUnits(type, classId?)`, iteration. Classes live HERE, not in SDK.
   - `diablo2:player` — player-specific: stats, skills, inventory access (may extend Unit)
   - `diablo2:map` — `reveal()`, `getCollisionMap()`, `getExits()`, pathfinding
   - `diablo2:move` — `moveTo(x, y)` → Promise, teleport/walk
   - `diablo2:input` — `click(x, y)`, `pressKey(key)`, mouse/keyboard simulation
   - `diablo2:oog` — `CharacterSelect`, `OutOfGame`, lobby, game creation/joining
   - `diablo2:patch` — low-level memory patch primitives (read/write/hook), scriptable patching
   - `diablo2:daemon` — daemon communication, service discovery, client messaging
   All are TypeScript importing from `diablo2:native`. The `diablo2:*` modules **own their domain classes** — `diablo2:unit` exports the `Unit` class, `diablo2:player` exports player helpers, etc. These classes have getters/setters that call `diablo2:native` under the hood. The SDK (`@aether/sdk`) builds **multi-step flows and cross-domain orchestration** on top (town runs, MF routes, game creation sequences) — it does NOT duplicate the classes that already exist in `diablo2:*`.

6. Script loading flow — **solving the sync module resolution problem:**
   V8's `ResolveModuleCallback` is synchronous, but WebSocket file fetching is async. Solution: **daemon resolves the entire dependency graph server-side.** DLL requests an entry point → daemon walks all imports recursively, SWC-strips each `.ts`, and returns the full module bundle (all files + dependency order) in one response. DLL registers all modules in V8, then instantiates. Subsequent hot-reloads re-fetch only changed modules + their dependents.
   - DLL connects to daemon, requests entry point (path from command-line flag)
   - Daemon: reads entry `.ts`, walks `import` statements recursively, SWC-strips each, returns all modules as a bundle
   - DLL: registers each module in V8 via `ResolveModuleCallback` (all source already local — sync resolution works)
   - All file I/O happens on daemon side — DLL has zero disk access for scripts

7. Hot-reload:
   - Daemon watches script directory for changes
   - On change: sends invalidation message to connected clients
   - Client clears affected module cache entries
   - On next tick or explicit reload: re-requests entry point, V8 re-evaluates

**Deliverable:** A `.ts` file in the daemon's script directory is requested by the game, imports `diablo2:game`, logs the current area. Edit the file → game reloads automatically.

---

### Phase 4: Multi-Client Coordination
**Duration:** 2-3 weeks
**Risk:** Low-Medium
**Depends on:** Phase 3

**Objective:** Multiple game instances coordinate through the daemon.

**Steps:**
1. Multiple Game.exe instances connect to same daemon, each with own V8 context
2. `diablo2:daemon` module:
   - `getClients()` — list connected game instances
   - `send(clientId, message)` — send to specific client
   - `broadcast(message)` — send to all clients
   - `onMessage(callback)` — receive from other clients
3. Daemon-side coordination primitives:
   - Game creation: leader creates, followers join by game name
   - Area sync: "wait until all clients are in area X"
   - Role assignment: leader/follower patterns

**Deliverable:** Two Game.exe instances running. Script on client A reads client B's area. Leader creates game, follower joins automatically.

---

### Phase 5: SDK & Script Library
**Duration:** 3-4 weeks (ongoing)
**Risk:** Low
**Depends on:** Phase 3 (core modules), Phase 4 (multi-client APIs)

**Objective:** Ergonomic TypeScript APIs for bot authors.

**Steps:**
1. Create `packages/sdk/` — composed workflows built on `diablo2:*` modules
   - `Town` flows: portal, vendor, stash, repair (uses `diablo2:unit`, `diablo2:move`, `diablo2:game`)
   - `OOG` flows: character select, game create/join (uses `diablo2:oog`)
   - `Inventory` helpers: find items, check space (uses `diablo2:unit`, `diablo2:player`)
   - MF route templates, area clearing patterns
2. Publish to npm as `@aether/sdk`
3. Example scripts demonstrating common patterns

**Deliverable:** A bot script using SDK flows that does a basic MF run.

---

### Phase 6: Extensions
**Duration:** Ongoing
**Risk:** Low
**Depends on:** Phase 4

Extensions are independent processes connecting to the daemon. Each is a separate package.

- **`ext-webui`** — Browser dashboard: game state, logs, script management
- **`ext-starter`** — Game launcher: spawn D2 instances with DLL injection, manage multi-bot
- **`ext-mcp`** — MCP server: expose game state/controls to AI models (Claude Code integration)
- **`ext-dropper`** — Item drop manager: receive item data, UI for managing drops

Each follows the same pattern: connect to daemon, register as service, communicate via protocol.

---

## Key Architectural Decisions

1. **V8 on the game thread.** Single-threaded, pumped each tick. No cross-thread sync. Mirrors browser model. The existing `feature.Hooks` dispatcher calls `gameLoop` every frame — V8 tick pump slots in as just another feature.

2. **Engine abstraction layer.** V8-specific code isolated behind an interface in Zig. If V8 32-bit proves long-term painful, the interface allows swapping without touching game bindings or the runtime.

3. **Daemon-as-filesystem.** The DLL has zero disk access for scripts. When V8 needs a module, it requests it from the daemon over WebSocket. The daemon reads from disk, SWC-strips `.ts` → `.js`, and returns the result. This keeps all file I/O and TypeScript tooling on the daemon side (Node.js), out of the 32-bit address space. The DLL caches resolved modules; the daemon sends invalidations on file change for hot-reload.

4. **Daemon is required for scripting.** Since the daemon IS the filesystem, V8 scripting requires a running daemon. This is intentional — it keeps the DLL thin and the daemon as the single control plane. The DLL without a daemon still works as a native-only tool (existing Zig features like map reveal, pathing, etc. function independently).

5. **Sandboxed execution contexts within a single V8 isolate.**
   One isolate, two V8 contexts (same thread, same heap):
   - **OOG Context (persistent)** — survives game sessions. Menus, lobby, character select, daemon connection, script state that persists between games. Pumped via `oogLoop` hook.
   - **In-Game Context (sandbox)** — created on game join, **destroyed on game leave**. Game-specific state: unit refs, area data, active handlers. Clean teardown: no leaked handlers, no stale pointers, no accumulated garbage. Can access OOG context via an explicit bridge (e.g. shared config, daemon handle).
   This gives scripts a persistent "session" (OOG) while ensuring each game run starts clean. The sandbox mechanism means in-game scripts can't leak state between games.
   - **Server-side context** — DEFERRED. D2 1.14d server runs on a separate thread. V8 isolates are single-threaded. Needs either a second isolate or server thread hooking. Revisit after client-side scripting is proven.

6. **Scripting as a feature module.** `scripting.zig` registers with the existing `Hooks` system. Zero changes to existing Zig features. They coexist.

7. **Zig `comptime` binding generation.** Instead of manually writing V8 ObjectTemplate boilerplate for each exposed type, use Zig's `comptime` reflection to auto-generate bindings from Zig structs. Adding a new type to JS requires zero manual binding code — just annotate or register the Zig struct. (Pattern proven by Lightpanda in production.)

8. **Server-side first, client-side minimal.** In 1.14d, client and server are in the same process. Instead of automating the UI like D2BS (clickMap, clickItem — simulating human input), we call server-side functions directly or send packets. Movement = `SUNIT_MoveToXY()`, not click-and-wait-for-animation. Item pickup = server packet, not click-on-ground-item. This is faster, more reliable, and doesn't depend on rendering state. Client-side interaction only where no server-side path exists (e.g. reading automap data, drawing overlays). The `diablo2:native` bindings should expose D2Game/server functions, not D2Client/UI functions where possible.

9. **No file I/O from scripts.** Scripts never write to disk. All state persistence goes through the daemon. Prevents corruption, leaks, and filesystem races.

10. **Memory patches from TypeScript.** The native layer exposes low-level patch primitives to JS (`diablo2:patch` module). Scripts can define and apply memory patches without recompiling the Zig DLL.

11. **Async/await built on ticks, pumped inside game loops.** The V8 microtask queue / event loop is drained inside the existing `gameLoop` and `oogLoop` hook dispatches — not on a separate thread, not on a timer. Each game tick = one event loop pump. `await nextTick()` yields to the next `gameLoop`/`oogLoop` call. `await ticks(12)` waits exactly 12 dispatches. `setTimeout` is tick-based internally. Scripts behave identically at normal speed or accelerated (headless/simulation). No independent event loop — the game IS the event loop.

12. **Daemon I/O happens between ticks.** WebSocket send/receive is done between game loop ticks — burst read/write queued messages outside of V8 execution. Scripts never block on network. They enqueue requests during a tick; responses arrive and are processed at the start of the next tick. The flow per frame: flush WS outbox → poll WS inbox → pump V8 microtasks → game tick continues.

13. **Hybrid native/TS — case by case.** Performance-critical code (pathing, collision, A*) stays native Zig. Logic/UI features are candidates for TS rewrite over time.

14. **Daemon is pure routing/state.** Does NOT launch games — that's `ext-starter` or manual `run.sh`.

15. **Protocol is the spine.** Every process speaks WebSocket + JSON via `@aether/protocol`.

---

## Risk Register

| Risk | Impact | Likelihood | Mitigation |
|-|-|-|-|
| V8 x86-windows build fails | Blocks entire project | Medium | Phase 0 spike with clear go/no-go. Existing MSVC monolith as fallback. |
| V8 static lib too large for 32-bit address space | Blocks V8 | Low | Measure early. V8 ~30MB, D2 ~200MB, 4GB total. Strip symbols. |
| V8 JIT conflicts with game memory protection | Degrades performance | Low | Test with JIT disabled first. V8 has interpreter-only mode. |
| V8 C++ bridge maintenance burden | Slows iteration | Low | Bridge is thin (~200 lines). C API surface is small and stable. |
| Win32 WebSocket from Zig is painful | Delays Phase 3 | Medium | Spike in Phase 1. Raw TCP + WS handshake, validate under Wine early. |
| 32-bit address space exhaustion with V8 + game + scripts | Runtime crashes | Low-Medium | Set explicit V8 heap limit (64-128MB). Monitor with metrics. |

---

## Critical Files

| File | Role in plan |
|-|-|
| `packages/native/build.zig` | V8 static lib linking, new include paths |
| `packages/native/src/aether.zig` | Register scripting feature, V8 init in DllMain |
| `packages/native/src/feature.zig` | Integration point — gameLoop/oogLoop dispatch |
| `packages/native/src/async.zig` | Existing fiber model — coexists with V8 microtasks |
| `packages/native/src/d2/functions.zig` | Game function bindings that V8 object templates wrap |
| `packages/native/src/d2/globals.zig` | Game globals exposed via diablo2:* modules |
| `packages/native/src/hook/game_hooks.zig` | Where game loop ticks fire |
| `turbo.json` | Build pipeline for all packages |
| `pnpm-workspace.yaml` | Package registration |

---

## What To Build First

**Phase 0 and Phase 1 run in parallel.** They have zero dependencies on each other.

- Phase 0 (V8 spike): switch to MSVC ABI, write C bridge, link V8 monolith, get `eval("1+1")` working in Game.exe
- Phase 1 (daemon): create protocol + daemon packages, WebSocket server with service registry

Everything else sequences from there. No point building the module system or SDK until V8 is proven.
