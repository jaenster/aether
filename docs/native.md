# Native Layer Design — `@aether/native`

## Overview

The native package is the Zig DLL injected into Game.exe. It owns:
1. DLL entry, feature registration, hook dispatch (existing)
2. V8 isolate lifecycle and context management (new)
3. `diablo2:native` — the single V8-backed module with flat, low-level bindings
4. WebSocket client connecting to the daemon (new)
5. Engine abstraction layer isolating V8-specific code

## File Layout

```
packages/native/
├── src/
│   ├── aether.zig              DllMain, feature registration
│   ├── feature.zig             Hook dispatch system
│   ├── async.zig               Fiber-based async (existing, coexists with V8)
│   ├── log.zig                 Logging
│   │
│   ├── features/
│   │   ├── scripting.zig       NEW — V8 lifecycle, tick pump, context mgmt
│   │   ├── map_reveal.zig      Existing features (unchanged)
│   │   └── ...
│   │
│   ├── v8/
│   │   ├── engine.zig          Engine abstraction interface
│   │   ├── v8_impl.zig         V8-specific implementation
│   │   ├── v8_bridge.cpp       C++ → C bridge for V8 API
│   │   ├── v8_bridge.h         Bridge header
│   │   └── bindings.zig        Comptime binding generator
│   │
│   ├── ws/
│   │   ├── client.zig          WebSocket client (Win32 sockets)
│   │   ├── frame.zig           WS frame encode/decode
│   │   └── handshake.zig       HTTP upgrade handshake
│   │
│   ├── d2/
│   │   ├── functions.zig       Game function bindings (existing)
│   │   ├── globals.zig         Game global pointers (existing)
│   │   └── types.zig           Game struct definitions (existing)
│   │
│   └── hook/
│       ├── game_hooks.zig      Game loop hook points (existing)
│       ├── patch.zig           Memory patching (existing)
│       └── trampoline.zig      Trampoline generation (existing)
│
├── lib/
│   └── v8_monolith.lib         V8 static lib (not in git, ~605MB)
│
├── v8-include/
│   └── v8.h, ...               V8 headers (not in git)
│
└── build.zig
```

## Engine Abstraction

```zig
// src/v8/engine.zig
pub const Engine = struct {
    // Opaque — implementation behind v8_impl.zig
    ptr: *anyopaque,

    pub fn init(heap_limit_mb: u32) !Engine;
    pub fn deinit(self: *Engine) void;

    // Context lifecycle
    pub fn createContext(self: *Engine) !Context;
    pub fn destroyContext(self: *Engine, ctx: Context) void;

    // Execution
    pub fn eval(self: *Engine, ctx: Context, source: []const u8) ![]const u8;
    pub fn pumpMicrotasks(self: *Engine) void;

    // Native binding registration
    pub fn registerNativeFn(self: *Engine, ctx: Context, name: []const u8, func: NativeFn) !void;

    // Module support
    pub fn registerModule(self: *Engine, ctx: Context, name: []const u8, source: []const u8) !void;
    pub fn setModuleResolver(self: *Engine, resolver: ModuleResolverFn) void;

    // Diagnostics
    pub fn heapUsed(self: *Engine) usize;
    pub fn heapLimit(self: *Engine) usize;
};

pub const Context = *anyopaque;
pub const NativeFn = *const fn (info: *anyopaque) void;
pub const ModuleResolverFn = *const fn (specifier: []const u8) ?[]const u8;
```

## Feature Module: scripting.zig

Integrates V8 into the existing hook system. Registered in `aether.zig` like any other feature.

```zig
// src/features/scripting.zig
const feature = @import("../feature.zig");
const engine = @import("../v8/engine.zig");
const ws = @import("../ws/client.zig");
const log = @import("../log.zig");

var eng: ?engine.Engine = null;
var oog_ctx: ?engine.Context = null;
var game_ctx: ?engine.Context = null;
var daemon: ?ws.Client = null;

pub const hooks = feature.Hooks{
    .init = init,
    .deinit = deinit,
    .gameLoop = gameLoop,
    .oogLoop = oogLoop,
};

fn init() void {
    eng = engine.Engine.init(96) catch |e| {
        log.print("scripting: engine init failed");
        return;
    };

    // OOG context persists across game sessions
    oog_ctx = eng.?.createContext() catch return;
    registerNativeBindings(eng.?, oog_ctx.?);

    // Connect to daemon (non-blocking, reconnect on failure)
    daemon = ws.Client.connect("127.0.0.1", 13119) catch null;
}

fn deinit() void {
    if (game_ctx) |ctx| eng.?.destroyContext(ctx);
    if (oog_ctx) |ctx| eng.?.destroyContext(ctx);
    if (eng) |*e| e.deinit();
    if (daemon) |*d| d.close();
}

fn gameLoop() void {
    if (eng == null) return;

    // Create in-game context on first game tick
    if (game_ctx == null and feature.in_game) {
        game_ctx = eng.?.createContext() catch return;
        registerNativeBindings(eng.?, game_ctx.?);
        // Load entry script from daemon...
    }

    // Destroy in-game context when leaving game
    if (game_ctx != null and !feature.in_game) {
        eng.?.destroyContext(game_ctx.?);
        game_ctx = null;
    }

    // Per-tick: WS I/O → microtask pump
    if (daemon) |*d| d.flush();
    if (daemon) |*d| d.poll();
    eng.?.pumpMicrotasks();
}

fn oogLoop() void {
    if (eng == null) return;
    if (daemon) |*d| d.flush();
    if (daemon) |*d| d.poll();
    eng.?.pumpMicrotasks();
}
```

## diablo2:native Binding Surface

Flat, dumb functions. No classes, no smart wrappers. TypeScript modules in `@aether/runtime` build the ergonomic API on top.

### Game State
| Function | Signature | Source |
|-|-|-|
| `getArea()` | `() → number` | `playerUnit().act.level.levelNo` |
| `getAct()` | `() → number` | `playerUnit().act.actNo` |
| `getDifficulty()` | `() → number` | game info struct |
| `getGameType()` | `() → number` | `globals.currentGameType()` |
| `isInGame()` | `() → boolean` | `feature.in_game` |
| `getTickCount()` | `() → number` | `GetTickCount()` / frame counter |

### Unit Access
| Function | Signature | Source |
|-|-|-|
| `getPlayerUnit()` | `() → pointer` | `globals.playerUnit()` |
| `getUnitType(ptr)` | `(pointer) → number` | `unit.type` |
| `getUnitClassId(ptr)` | `(pointer) → number` | `unit.classId` |
| `getUnitMode(ptr)` | `(pointer) → number` | `unit.mode` |
| `getUnitX(ptr)` | `(pointer) → number` | `UnitLocation` or path |
| `getUnitY(ptr)` | `(pointer) → number` | `UnitLocation` or path |
| `getUnitHp(ptr)` | `(pointer) → number` | `GetUnitStat(unit, 6, 0)` |
| `getUnitMaxHp(ptr)` | `(pointer) → number` | `GetUnitStat(unit, 7, 0)` |
| `getUnitMp(ptr)` | `(pointer) → number` | `GetUnitStat(unit, 8, 0)` |
| `getUnitStat(ptr, stat, layer)` | `(pointer, number, number) → number` | `GetUnitStat` |
| `getUnitState(ptr, state)` | `(pointer, number) → number` | `GetUnitState` |
| `getUnitName(ptr)` | `(pointer) → string` | `GetUnitName` |
| `findUnits(type)` | `(number) → pointer[]` | hash table iteration |
| `findUnit(type, classId)` | `(number, number) → pointer?` | hash table scan |

### Packets / Movement
| Function | Signature | Source |
|-|-|-|
| `sendPacket(bytes)` | `(Uint8Array) → void` | `functions.sendPacket` |
| `sendRunTo(x, y)` | `(number, number) → void` | `sendRunToLocation` |
| `sendCastSkill(x, y)` | `(number, number) → void` | `castRightSkillAt` |
| `sendSelectSkill(id, left)` | `(number, boolean) → void` | `sendSelectSkill` |

### Memory / Patching
| Function | Signature | Source |
|-|-|-|
| `readU8(addr)` | `(number) → number` | direct read |
| `readU16(addr)` | `(number) → number` | direct read |
| `readU32(addr)` | `(number) → number` | direct read |
| `readString(addr, maxLen)` | `(number, number) → string` | direct read |
| `writeU8(addr, val)` | `(number, number) → void` | VirtualProtect + write |
| `writeU32(addr, val)` | `(number, number) → void` | VirtualProtect + write |
| `writeNops(addr, count)` | `(number, number) → void` | `patch.writeNops` |

### Map / Collision
| Function | Signature | Source |
|-|-|-|
| `getCollisionFlags(x, y)` | `(number, number) → number` | collision grid read |
| `findNearbyRoom(room, x, y)` | `(pointer, number, number) → pointer?` | `FindBetterNearbyRoom` |
| `checkCollision(room, x, y, width, mask)` | `(pointer, ...) → number` | `CheckCollisionWidth` |

### Automap
| Function | Signature | Source |
|-|-|-|
| `revealLevel(levelId)` | `(number) → void` | map_reveal logic |
| `newAutomapCell()` | `() → pointer?` | `NewAutomapCell` |
| `addAutomapCell(cell, head)` | `(pointer, pointer) → void` | `AddAutomapCell` |

### Quest
| Function | Signature | Source |
|-|-|-|
| `getQuestState(questId, stateId)` | `(number, number) → number` | `GetQuestState` |

### Logging
| Function | Signature | Source |
|-|-|-|
| `log(msg)` | `(string) → void` | `log.print` |

## Comptime Binding Generation

Instead of manually writing V8 ObjectTemplate boilerplate for each function, use Zig's `comptime` to auto-generate bindings.

### Concept

```zig
// src/v8/bindings.zig

/// Marker struct: defines a JS-exposed native function
pub fn NativeBinding(comptime name: []const u8, comptime func: anytype) type {
    return struct {
        pub const js_name = name;
        pub const native_fn = func;
        pub const Params = @typeInfo(@TypeOf(func)).@"fn".params;
        pub const Return = @typeInfo(@TypeOf(func)).@"fn".return_type.?;
    };
}

/// Register all bindings on a V8 context at comptime
pub fn registerAll(eng: *Engine, ctx: Context, comptime bindings: anytype) void {
    inline for (bindings) |B| {
        eng.registerNativeFn(ctx, B.js_name, &makeCallback(B));
    }
}

/// Generate a V8 callback that marshals args from JS → Zig, calls the function,
/// and marshals the return value back to JS.
fn makeCallback(comptime B: type) fn (*anyopaque) void {
    return struct {
        fn callback(info: *anyopaque) void {
            // Extract JS args → Zig types (comptime-generated)
            // Call B.native_fn with extracted args
            // Convert return value → JS value
            // Set return on info
        }
    }.callback;
}
```

### Usage

```zig
const native_bindings = .{
    NativeBinding("getArea", d2_getArea),
    NativeBinding("getUnitX", d2_getUnitX),
    NativeBinding("sendRunTo", d2_sendRunTo),
    // ...
};

// In scripting.zig init:
bindings.registerAll(&eng, ctx, native_bindings);
```

Adding a new function: write the Zig function, add one line to the tuple. Zero V8 boilerplate.

## WebSocket Client

### Requirements
- Connect to daemon on init (host:port from command-line flag)
- WebSocket handshake (HTTP upgrade)
- Binary and text frame support
- Non-blocking I/O (polled each tick)
- Reconnect on disconnect with exponential backoff
- Message queue: outbox flushed start-of-tick, inbox polled start-of-tick

### Win32 Socket API
Uses `ws2_32.dll` imports:
- `WSAStartup`, `socket`, `connect`, `send`, `recv`, `closesocket`
- `ioctlsocket` with `FIONBIO` for non-blocking mode
- `select` for poll (or just non-blocking recv)

### Frame Format
Standard WebSocket framing (RFC 6455):
- Client-to-server frames are masked (required by spec)
- Text frames for JSON messages
- Close frame handling for clean disconnect

### Connection Lifecycle
1. `connect()` — TCP connect, HTTP upgrade, WebSocket handshake
2. `flush()` — send all queued outbound messages
3. `poll()` — recv all available inbound messages, dispatch to handlers
4. `close()` — send close frame, cleanup

### Reconnect Strategy
- On disconnect: wait 1s, 2s, 4s, 8s, max 30s
- Reset backoff on successful connection
- During disconnect: scripting continues with native-only features, daemon-dependent ops (module loading, messaging) queue or no-op

## Context Lifecycle

### OOG Context
- Created once at `init()`
- Persists across game sessions
- Pumped via `oogLoop` hook every frame during menus
- Owns: daemon connection handle, persistent config, script session state
- Modules: `diablo2:native`, `diablo2:oog`, `diablo2:daemon`

### In-Game Context
- Created when `feature.in_game` transitions `false → true`
- Destroyed when `feature.in_game` transitions `true → false`
- Pumped via `gameLoop` hook every frame during gameplay
- Clean teardown: all handlers unregistered, all unit refs invalidated
- Modules: `diablo2:native`, `diablo2:game`, `diablo2:unit`, `diablo2:move`, `diablo2:map`, etc.
- Access OOG context via bridge: shared daemon handle, config values

### Tick Flow (per frame)

```
gameLoop() / oogLoop():
  1. ws.flush()          — send queued outbound messages
  2. ws.poll()           — receive inbound messages, buffer for JS
  3. engine.pump()       — drain V8 microtask queue (resolves promises)
  4. [existing features continue normally]
```
