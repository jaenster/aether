# Daemon Design — `@aether/daemon`

## Overview

The daemon is a Node.js WebSocket server that acts as the control plane for all Aether components. It serves scripts to game instances (virtual filesystem), routes messages between clients (service registry), and handles TypeScript transpilation (SWC).

**Key principle:** The daemon IS the filesystem for game instances. The DLL never reads files from disk — it requests them from the daemon over WebSocket.

## Responsibilities

1. **WebSocket server** — accept connections from game instances and extensions
2. **Virtual filesystem** — serve `.ts` files as transpiled `.js` on request
3. **SWC transpiler** — strip TypeScript types, preserve `diablo2:*` import specifiers
4. **Module bundling** — resolve full dependency graphs server-side, return as bundles
5. **File watcher** — monitor script directories, send invalidation to connected clients
6. **Service registry** — clients register name/type, become discoverable
7. **Message router** — relay messages between clients
8. **State tracking** — track which game instance is in which area/state

## File Layout

```
packages/daemon/
├── src/
│   ├── index.ts            CLI entry point
│   ├── server.ts           WebSocket server setup
│   ├── registry.ts         Service registry (client tracking)
│   ├── router.ts           Message routing (relay, broadcast)
│   ├── filesystem.ts       Virtual filesystem (file serving + caching)
│   ├── transpiler.ts       SWC integration (TS → JS)
│   ├── resolver.ts         Module resolution (Node.js algorithm)
│   ├── bundler.ts          Dependency graph walking + bundle creation
│   ├── watcher.ts          File system watcher (chokidar or fs.watch)
│   └── types.ts            Internal types
├── package.json
└── tsconfig.json
```

## WebSocket Server

### Configuration
| Setting | Default | Env Var | CLI Flag |
|-|-|-|-|
| Port | 13119 | `AETHER_PORT` | `--port` |
| Host | 0.0.0.0 | `AETHER_HOST` | `--host` |
| Auth token | none | `AETHER_TOKEN` | `--token` |
| Script root | `./scripts` | `AETHER_SCRIPTS` | `--scripts` |

### Connection Lifecycle
1. Client connects via WebSocket
2. If auth token configured: client sends `auth` message, daemon validates
3. Client sends `service:register` with name, type, capabilities
4. Daemon assigns client ID, adds to registry
5. Normal message exchange
6. On disconnect: remove from registry, notify interested clients

### Client Types
| Type | Description |
|-|-|
| `game` | Game.exe instance with injected DLL |
| `extension` | External process (webui, starter, mcp) |
| `cli` | Command-line tool (one-shot commands) |

## Virtual Filesystem

The daemon serves files to game instances on request. The game DLL never touches the disk.

### Request Flow

```
Game DLL                          Daemon
   │                                │
   ├─ file:request ────────────────►│
   │  { path: "entry.ts" }         │
   │                                ├─ Read file from disk
   │                                ├─ Resolve all imports recursively
   │                                ├─ SWC transpile each .ts → .js
   │                                ├─ Build dependency-ordered bundle
   │                                │
   │◄── file:response ─────────────┤
   │  { modules: [                  │
   │    { path, source, deps },     │
   │    ...                         │
   │  ]}                            │
```

### Module Resolution Algorithm

Uses Node.js-style resolution (package.json `exports`/`main`, index files, node_modules walking). We use an existing resolver library (`enhanced-resolve` or `oxc-resolver`) rather than reimplementing.

Resolution order for `import "foo"`:
1. If `foo` starts with `diablo2:` → skip (resolved client-side)
2. If `foo` starts with `./` or `../` → resolve relative to importer
3. If `foo` starts with `@aether/` → resolve in workspace packages
4. Otherwise → walk `node_modules` directories upward

### Dependency Graph Walking

When a game client requests an entry point:

1. Resolve the entry file path
2. Parse imports using SWC's parser (fast, handles TS)
3. For each import that isn't `diablo2:*`: resolve → parse → recurse
4. Topologically sort the dependency graph
5. Return all modules in dependency order

This solves V8's synchronous `ResolveModuleCallback` problem: all source code arrives in one response, so the DLL can register all modules before instantiating any.

### Caching

- Transpiled files cached by path + mtime
- Cache invalidated on file change (watcher)
- Full bundle cached by entry point; invalidated when any dependency changes

## SWC Integration

### Configuration

```typescript
const swcOptions: Options = {
  jsc: {
    parser: {
      syntax: "typescript",
      tsx: false,
      decorators: true,
    },
    target: "es2020", // V8 8.3 supports ES2020
    // No module transform — keep ES modules as-is
  },
  module: {
    type: "es6", // Preserve import/export
  },
  sourceMaps: "inline", // For debugging
};
```

### Important: Preserve diablo2:* specifiers

SWC must NOT transform import specifiers. `import { getArea } from "diablo2:game"` must remain exactly as-is in the output. SWC's default behavior preserves specifiers (it only transforms syntax), but validate this in tests.

### Type Stripping Only

We use SWC in type-strip mode — it removes TypeScript syntax (type annotations, interfaces, enums) but doesn't transform module syntax, doesn't polyfill, doesn't bundle. The output is clean ES module JS that V8 can execute directly.

## File Watcher

### Behavior
- Watch the script root directory recursively
- On file change/create/delete:
  1. Invalidate transpile cache for that file
  2. Invalidate bundle cache for any bundle containing that file
  3. Send `file:invalidate` to all connected game clients
  4. Clients clear their module cache and re-request on next tick

### Debounce
- 100ms debounce to batch rapid saves (editor auto-save, git checkout)
- Coalesce multiple changes into one invalidation message

### Implementation
Use `chokidar` (mature, handles macOS FSEvents) or Node's built-in `fs.watch` (simpler, sufficient for our use case).

## Service Registry

### Data Model

```typescript
interface ClientInfo {
  id: string;              // UUID assigned on connect
  type: "game" | "extension" | "cli";
  name: string;            // Human-readable name
  capabilities: string[];  // What this client can do
  state: Record<string, unknown>; // Client-reported state
  connectedAt: Date;
  ws: WebSocket;           // Connection handle
}
```

### Operations
| Operation | Description |
|-|-|
| `register(name, type, caps)` | Add client to registry |
| `unregister(id)` | Remove on disconnect |
| `discover(type?, cap?)` | Find clients by type/capability |
| `getState(id)` | Get client's reported state |

### Game Client State
Game instances report their state periodically:
```json
{
  "area": 1,
  "act": 1,
  "difficulty": 0,
  "inGame": true,
  "characterName": "MyChar",
  "characterClass": 1,
  "level": 85
}
```

This lets other clients (extensions, other games) know what each game instance is doing.

## Message Router

### Routing Modes
| Mode | Description |
|-|-|
| `direct` | Send to specific client by ID |
| `broadcast` | Send to all clients (optionally filtered by type) |
| `service` | Send to first client matching a capability |

### Flow
1. Client A sends `message:relay` with target + payload
2. Daemon looks up target in registry
3. Daemon forwards payload to target(s) as `message:incoming`
4. If target not found: send error back to sender

### No Transformation
The daemon is a dumb pipe for message payloads. It routes but doesn't interpret the content. This keeps the daemon protocol-agnostic for extension-to-extension communication.

## CLI Entry Point

```bash
# Start daemon
pnpm --filter @aether/daemon start

# With options
pnpm --filter @aether/daemon start --port 13119 --scripts ./scripts

# Development mode (auto-restart on daemon code changes)
pnpm --filter @aether/daemon dev
```

### Process Lifecycle
- Graceful shutdown on SIGINT/SIGTERM
- Close all WebSocket connections with close frame
- Flush pending messages before exit
- Log connected client count on startup and shutdown

## Error Handling

### File not found
```json
{ "type": "file:response", "error": "not_found", "path": "missing.ts" }
```

### Transpile error
```json
{ "type": "file:response", "error": "transpile_error", "path": "bad.ts",
  "message": "Unexpected token at line 5:12" }
```

### Resolution error
```json
{ "type": "file:response", "error": "resolve_error", "path": "entry.ts",
  "message": "Cannot find module 'nonexistent'" }
```

The game DLL logs errors and continues — a transpile error in one script doesn't crash the game.

## Dependencies

| Package | Purpose |
|-|-|
| `ws` | WebSocket server |
| `@swc/core` | TypeScript transpilation |
| `chokidar` | File watching |
| `enhanced-resolve` or `oxc-resolver` | Node.js module resolution |
| `@aether/protocol` | Message type definitions |

## Daemon Disconnect Behavior

When the daemon goes down:
- Game DLL continues running with native-only features
- All Zig features (map reveal, pathing, auto-move) work normally
- Scripting pauses — no new modules can load, no messages route
- WebSocket client retries with exponential backoff
- On reconnect: re-register, re-request entry script, resume
