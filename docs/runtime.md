# Runtime Design — `@aether/runtime`

## Overview

The runtime is the TypeScript layer that runs inside V8 in the game process. It contains:
1. The bootstrap loader (~50 lines JS, embedded in the DLL)
2. All `diablo2:*` module implementations (TypeScript, served from daemon)
3. Console/timer polyfills
4. Tick-based scheduling primitives

Only the bootstrap is compiled into the DLL. Everything else lives on the daemon filesystem and is hot-reloadable.

## File Layout

```
packages/runtime/
├── src/
│   ├── bootstrap.js           Embedded in DLL — module resolver setup (~50 lines)
│   │
│   ├── modules/               diablo2:* module implementations
│   │   ├── game.ts            diablo2:game — area, act, difficulty, tick
│   │   ├── unit.ts            diablo2:unit — Unit class, getUnits(), iteration
│   │   ├── player.ts          diablo2:player — player-specific: stats, skills, inventory
│   │   ├── map.ts             diablo2:map — reveal, collision, exits, pathfinding
│   │   ├── move.ts            diablo2:move — moveTo() → Promise, teleport/walk
│   │   ├── input.ts           diablo2:input — click, pressKey, mouse/keyboard sim
│   │   ├── oog.ts             diablo2:oog — char select, lobby, game create/join
│   │   ├── patch.ts           diablo2:patch — memory read/write/hook primitives
│   │   └── daemon.ts          diablo2:daemon — daemon comms, service discovery
│   │
│   ├── polyfills/
│   │   ├── console.ts         console.log → native log
│   │   ├── timers.ts          setTimeout/setInterval → tick-based
│   │   └── scheduler.ts       nextTick(), ticks(n), tick-based promise scheduling
│   │
│   └── util/
│       ├── pointer.ts         Pointer wrapper (opaque handle, no raw memory)
│       └── types.ts           Shared runtime types
│
├── package.json
└── tsconfig.json
```

## Bootstrap Loader

The bootstrap is the only JS that ships inside the DLL. It's a string constant in `scripting.zig`, evaluated at V8 context creation. Its job: set up the module resolver and load polyfills.

```javascript
// bootstrap.js (~50 lines, embedded in DLL as string)
// This runs immediately when a V8 context is created.

// 1. Register the module resolver
// __native is pre-registered by Zig before bootstrap runs
const native = __native;

// 2. Install console polyfill
globalThis.console = {
  log: (...args) => native.log(args.map(String).join(" ")),
  warn: (...args) => native.log("[WARN] " + args.map(String).join(" ")),
  error: (...args) => native.log("[ERROR] " + args.map(String).join(" ")),
};

// 3. Tick-based timers (implemented as microtask scheduling)
const timerQueue = [];
let nextTimerId = 1;

globalThis.setTimeout = (fn, ms) => {
  const id = nextTimerId++;
  const ticks = Math.max(1, Math.ceil((ms || 0) / 40)); // ~25fps = 40ms/tick
  timerQueue.push({ id, fn, ticksLeft: ticks, interval: 0 });
  return id;
};

globalThis.setInterval = (fn, ms) => {
  const id = nextTimerId++;
  const ticks = Math.max(1, Math.ceil((ms || 0) / 40));
  timerQueue.push({ id, fn, ticksLeft: ticks, interval: ticks });
  return id;
};

globalThis.clearTimeout = globalThis.clearInterval = (id) => {
  const idx = timerQueue.findIndex(t => t.id === id);
  if (idx >= 0) timerQueue.splice(idx, 1);
};

// Called by native each tick before microtask pump
globalThis.__tickTimers = () => {
  for (let i = timerQueue.length - 1; i >= 0; i--) {
    const t = timerQueue[i];
    if (--t.ticksLeft <= 0) {
      t.fn();
      if (t.interval > 0) {
        t.ticksLeft = t.interval;
      } else {
        timerQueue.splice(i, 1);
      }
    }
  }
};

console.log("aether: bootstrap loaded");
```

## Module Resolution

### How V8 ES Modules Work

V8's `ResolveModuleCallback` is called synchronously when an `import` statement is encountered during module instantiation. It must return a already-compiled module — no async allowed.

### Our Solution: Pre-fetched Bundles

1. DLL requests entry point from daemon: `file:request { path: "scripts/bot.ts" }`
2. Daemon walks all imports recursively, SWC-strips each `.ts`, returns full bundle
3. DLL receives `ModuleInfo[]` — all modules with source, in dependency order
4. DLL registers each module in V8 (compile, but don't instantiate yet)
5. DLL instantiates the entry module — V8 calls `ResolveModuleCallback` for each import
6. Callback looks up module by specifier in the pre-registered map → always sync, always available

### Specifier Resolution Rules

In the `ResolveModuleCallback`:

| Specifier | Resolution |
|-|-|
| `diablo2:native` | Return the V8-backed native module (pre-registered at context creation) |
| `diablo2:game`, `diablo2:unit`, etc. | Return the pre-fetched TS module from the bundle |
| `./relative/path` | Return the pre-fetched module (daemon resolved it) |
| `bare-specifier` | Return the pre-fetched module (daemon resolved it via node_modules) |

All specifiers except `diablo2:native` were resolved by the daemon and included in the bundle.

### Module Cache

The DLL maintains a `Map<specifier, CompiledModule>`:
- Populated when a bundle arrives from the daemon
- Cleared for specific paths when `file:invalidate` arrives
- Full clear on explicit reload command

## diablo2:* Module Catalog

Each module imports from `diablo2:native` and builds a typed, ergonomic API.

### diablo2:game

```typescript
import * as native from "diablo2:native";

export function getArea(): number { return native.getArea(); }
export function getAct(): number { return native.getAct(); }
export function getDifficulty(): number { return native.getDifficulty(); }
export function isInGame(): boolean { return native.isInGame(); }
export function getTickCount(): number { return native.getTickCount(); }

// Tick-based async primitives
export function nextTick(): Promise<void> {
  return new Promise(resolve => {
    globalThis.setTimeout(resolve, 0); // resolves next tick
  });
}

export function ticks(n: number): Promise<void> {
  return new Promise(resolve => {
    let remaining = n;
    const check = () => {
      if (--remaining <= 0) resolve();
      else globalThis.setTimeout(check, 0);
    };
    globalThis.setTimeout(check, 0);
  });
}

export async function delay(ms: number): Promise<void> {
  const tickCount = Math.max(1, Math.ceil(ms / 40));
  return ticks(tickCount);
}
```

### diablo2:unit

```typescript
import * as native from "diablo2:native";

// Pointer is an opaque handle — scripts never see raw addresses
type Pointer = number; // internally a u32, but scripts treat it as opaque

export const enum UnitType {
  Player = 0,
  Monster = 1,
  Object = 2,
  Missile = 3,
  Item = 4,
  Tile = 5,
}

export class Unit {
  readonly ptr: Pointer;

  constructor(ptr: Pointer) {
    this.ptr = ptr;
  }

  get type(): UnitType { return native.getUnitType(this.ptr); }
  get classId(): number { return native.getUnitClassId(this.ptr); }
  get mode(): number { return native.getUnitMode(this.ptr); }
  get x(): number { return native.getUnitX(this.ptr); }
  get y(): number { return native.getUnitY(this.ptr); }
  get hp(): number { return native.getUnitHp(this.ptr); }
  get maxHp(): number { return native.getUnitMaxHp(this.ptr); }
  get mp(): number { return native.getUnitMp(this.ptr); }
  get name(): string { return native.getUnitName(this.ptr); }

  getStat(stat: number, layer: number = 0): number {
    return native.getUnitStat(this.ptr, stat, layer);
  }

  getState(state: number): number {
    return native.getUnitState(this.ptr, state);
  }
}

export function getUnits(type: UnitType, classId?: number): Unit[] {
  const ptrs = classId !== undefined
    ? native.findUnits(type).filter(p => native.getUnitClassId(p) === classId)
    : native.findUnits(type);
  return ptrs.map(p => new Unit(p));
}

export function getUnit(type: UnitType, classId: number): Unit | undefined {
  const ptr = native.findUnit(type, classId);
  return ptr ? new Unit(ptr) : undefined;
}
```

### diablo2:player

```typescript
import * as native from "diablo2:native";
import { Unit } from "diablo2:unit";

export function getPlayer(): Unit | undefined {
  const ptr = native.getPlayerUnit();
  return ptr ? new Unit(ptr) : undefined;
}

export function getLevel(): number {
  const p = native.getPlayerUnit();
  return p ? native.getUnitStat(p, 12, 0) : 0; // stat 12 = level
}

export function getGold(): number {
  const p = native.getPlayerUnit();
  return p ? native.getUnitStat(p, 14, 0) : 0; // stat 14 = gold
}

export function getExperience(): number {
  const p = native.getPlayerUnit();
  return p ? native.getUnitStat(p, 13, 0) : 0; // stat 13 = experience
}
```

### diablo2:move

```typescript
import * as native from "diablo2:native";
import { nextTick, ticks } from "diablo2:game";

export async function moveTo(x: number, y: number): Promise<boolean> {
  native.sendRunTo(x, y);

  // Wait for movement to complete (poll position each tick)
  for (let i = 0; i < 100; i++) { // max 100 ticks (~4 seconds)
    await nextTick();
    const p = native.getPlayerUnit();
    if (!p) return false;
    const px = native.getUnitX(p);
    const py = native.getUnitY(p);
    const dx = px - x;
    const dy = py - y;
    if (dx * dx + dy * dy <= 9) return true; // within 3 tiles
  }
  return false; // timed out
}

export async function teleportTo(x: number, y: number): Promise<boolean> {
  native.sendCastSkill(x, y);
  await ticks(3); // wait for teleport animation
  const p = native.getPlayerUnit();
  if (!p) return false;
  const px = native.getUnitX(p);
  const py = native.getUnitY(p);
  const dx = px - x;
  const dy = py - y;
  return dx * dx + dy * dy <= 25; // within 5 tiles
}
```

### diablo2:map

```typescript
import * as native from "diablo2:native";

export function reveal(levelId?: number): void {
  native.revealLevel(levelId ?? native.getArea());
}

export function getCollision(x: number, y: number): number {
  return native.getCollisionFlags(x, y);
}

export function isWalkable(x: number, y: number): boolean {
  return (native.getCollisionFlags(x, y) & 0x1C09) === 0;
}
```

### diablo2:oog

```typescript
import * as native from "diablo2:native";
import { nextTick } from "diablo2:game";

export function isInGame(): boolean {
  return native.isInGame();
}

export function getGameType(): number {
  return native.getGameType();
}

// Higher-level OOG flows to be added (char select, game creation)
```

### diablo2:patch

```typescript
import * as native from "diablo2:native";

export function readU8(addr: number): number { return native.readU8(addr); }
export function readU16(addr: number): number { return native.readU16(addr); }
export function readU32(addr: number): number { return native.readU32(addr); }
export function readString(addr: number, maxLen: number = 256): string {
  return native.readString(addr, maxLen);
}

export function writeU8(addr: number, val: number): void { native.writeU8(addr, val); }
export function writeU32(addr: number, val: number): void { native.writeU32(addr, val); }
export function writeNops(addr: number, count: number): void { native.writeNops(addr, count); }
```

### diablo2:daemon

```typescript
import * as native from "diablo2:native";

// Daemon communication — wraps the WS client in the DLL
// Exact API depends on what native exposes for WS messaging

export function getClients(): ClientInfo[] {
  // Request service discovery from daemon
  return native.daemonDiscover();
}

export function send(clientId: string, payload: unknown): void {
  native.daemonSend(clientId, JSON.stringify(payload));
}

export function broadcast(payload: unknown): void {
  native.daemonBroadcast(JSON.stringify(payload));
}

export function onMessage(callback: (from: string, payload: unknown) => void): void {
  native.daemonOnMessage((from: string, raw: string) => {
    callback(from, JSON.parse(raw));
  });
}
```

## Tick Scheduling

All async in the runtime is tick-based. There is no independent event loop — the game IS the event loop.

### How it works

1. Each call to `gameLoop()` or `oogLoop()` = one tick
2. `globalThis.__tickTimers()` fires pending timers
3. `engine.pumpMicrotasks()` drains the V8 microtask queue (resolves promises)
4. `await nextTick()` = promise that resolves on the next tick
5. `await ticks(n)` = promise that resolves after exactly N ticks
6. `await delay(ms)` = converts ms to ticks (~25fps)
7. `setTimeout(fn, ms)` = calls fn after ceil(ms/40) ticks

### Determinism

Scripts behave identically at any frame rate because scheduling is tick-count-based, not wall-clock-based. This is critical for headless/simulation modes.

## Context Sandbox Lifecycle

### OOG Context
- Created at feature init
- Bootstrap runs immediately
- Polyfills installed
- `diablo2:oog` and `diablo2:daemon` modules available
- Persists across game sessions
- Pumped via `oogLoop`

### In-Game Context
- Created when `feature.in_game` transitions to `true`
- Bootstrap runs, fresh polyfill state
- All `diablo2:*` modules available
- Entry script loaded from daemon
- Destroyed when `feature.in_game` transitions to `false`
- Destruction: all handlers cleared, all module cache cleared, all timers canceled
- No state leaks between games

### OOG ↔ In-Game Bridge
- Shared daemon connection handle (WS client is Zig-level, not per-context)
- Shared config values (read-only from in-game context)
- No direct object sharing — contexts are isolated V8 sandboxes

## Hot-Reload Flow

```
1. Developer edits scripts/bot.ts
2. Daemon file watcher detects change
3. Daemon invalidates transpile cache for bot.ts
4. Daemon sends file:invalidate { paths: ["scripts/bot.ts"] }
5. DLL receives invalidation, clears module cache for bot.ts + dependents
6. On next tick: DLL re-requests entry point from daemon
7. Daemon re-resolves full bundle, returns updated modules
8. DLL re-registers modules in V8, re-instantiates
9. New script version running — no game restart needed
```

## Script Error Handling

- V8 eval/instantiate errors → logged via `console.error`, reported to daemon as `script:error`
- Uncaught promise rejections → caught by V8 promise rejection handler, logged
- Script errors never crash the game — the V8 context continues running
- If a script is broken, other features (native Zig) continue normally
