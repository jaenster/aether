# Wire Protocol — `@aether/protocol`

## Overview

All communication between daemon, game instances, and extensions uses WebSocket + JSON. The `@aether/protocol` package defines every message type, is the single source of truth for the wire format, and has zero runtime dependencies.

## Transport

- **WebSocket** (RFC 6455) over TCP
- **Text frames** with JSON payloads
- No binary protocol (JSON is sufficient for our message sizes)
- Default port: 13119

## Message Envelope

Every message has this shape:

```typescript
interface Message {
  type: string;      // Namespaced: "category:action"
  id?: string;       // Request ID for request/response pairs
  error?: string;    // Error code (only on error responses)
  message?: string;  // Human-readable error description
  // ... payload fields vary by type
}
```

### Request/Response Pattern

For request/response pairs, the client sends a `type: "foo:request"` with an `id`, and the daemon responds with `type: "foo:response"` echoing the same `id`. This allows multiplexing — multiple requests in flight simultaneously.

```typescript
// Request
{ "type": "file:request", "id": "r1", "path": "entry.ts" }

// Response
{ "type": "file:response", "id": "r1", "modules": [...] }
```

## Protocol Version Negotiation

On connect, the client sends a `hello` message. The daemon responds with the negotiated version.

```typescript
// Client → Daemon
interface Hello {
  type: "hello";
  protocolVersion: number;  // Client's max supported version
  clientType: "game" | "extension" | "cli";
  clientName: string;
}

// Daemon → Client
interface Welcome {
  type: "welcome";
  protocolVersion: number;  // Negotiated version (min of both)
  clientId: string;         // Assigned UUID
  daemonVersion: string;    // Daemon software version
}
```

Current protocol version: **1**.

## Message Categories

### Authentication

```typescript
// Client → Daemon (only if daemon requires auth)
interface AuthRequest {
  type: "auth";
  token: string;
}

// Daemon → Client
interface AuthResponse {
  type: "auth:result";
  success: boolean;
  error?: string;
}
```

### File System

#### Request a module bundle

```typescript
// Client → Daemon
interface FileRequest {
  type: "file:request";
  id: string;
  path: string;          // Entry point path (e.g., "scripts/bot.ts")
}

// Daemon → Client
interface FileResponse {
  type: "file:response";
  id: string;
  modules?: ModuleInfo[]; // Dependency-ordered array
  error?: string;         // "not_found", "transpile_error", "resolve_error"
  message?: string;       // Human-readable error
}

interface ModuleInfo {
  path: string;           // Canonical path (used as module specifier)
  source: string;         // Transpiled JS source
  deps: string[];         // Import specifiers this module depends on
}
```

The `modules` array is topologically sorted — a module's dependencies appear before it in the array. The DLL registers them in order and all `ResolveModuleCallback` calls can be satisfied synchronously.

#### File invalidation (hot-reload)

```typescript
// Daemon → Client (push)
interface FileInvalidate {
  type: "file:invalidate";
  paths: string[];         // Changed file paths
}
```

On receiving this, the game client clears cached modules for these paths and their dependents. On next tick (or explicit reload), re-requests the entry point.

#### Request a single file (raw)

```typescript
// Client → Daemon
interface FileRawRequest {
  type: "file:raw";
  id: string;
  path: string;
}

// Daemon → Client
interface FileRawResponse {
  type: "file:raw:response";
  id: string;
  content?: string;
  error?: string;
}
```

For non-module files (config, data).

### Service Registry

#### Register

```typescript
// Client → Daemon
interface ServiceRegister {
  type: "service:register";
  name: string;
  capabilities: string[];
}

// Daemon → Client
interface ServiceRegistered {
  type: "service:registered";
  clientId: string;
}
```

#### Discover

```typescript
// Client → Daemon
interface ServiceDiscover {
  type: "service:discover";
  id: string;
  filterType?: string;
  filterCapability?: string;
}

// Daemon → Client
interface ServiceDiscoverResult {
  type: "service:discover:result";
  id: string;
  clients: ClientInfo[];
}

interface ClientInfo {
  clientId: string;
  name: string;
  type: string;
  capabilities: string[];
  state: Record<string, unknown>;
}
```

#### Unregister (implicit)
Clients are unregistered when their WebSocket connection closes. No explicit unregister message needed.

### Message Relay

#### Send to specific client

```typescript
// Client → Daemon
interface MessageSend {
  type: "message:send";
  targetId: string;
  payload: unknown;     // Opaque — daemon doesn't interpret
}

// Daemon → Target Client
interface MessageIncoming {
  type: "message:incoming";
  fromId: string;
  fromName: string;
  payload: unknown;
}
```

#### Broadcast

```typescript
// Client → Daemon
interface MessageBroadcast {
  type: "message:broadcast";
  filterType?: string;   // Only send to clients of this type
  payload: unknown;
}
```

Broadcast delivers to all matching clients except the sender.

### State Updates

```typescript
// Client → Daemon
interface StateUpdate {
  type: "state:update";
  state: Record<string, unknown>;
}
```

Game clients send this periodically or on state change. The daemon stores it in the registry and makes it available via `service:discover`.

### Script Lifecycle

```typescript
// Client → Daemon
interface ScriptLoaded {
  type: "script:loaded";
  path: string;
  moduleCount: number;
}

// Client → Daemon
interface ScriptError {
  type: "script:error";
  path: string;
  error: string;
  line?: number;
  column?: number;
}

// Daemon → Client (or Client → Client via relay)
interface ScriptReload {
  type: "script:reload";
  path?: string;  // Specific script, or omit for full reload
}
```

### Diagnostics

```typescript
// Client → Daemon
interface PingRequest {
  type: "ping";
  id: string;
  timestamp: number;
}

// Daemon → Client
interface PongResponse {
  type: "pong";
  id: string;
  timestamp: number;    // Echo back
  serverTime: number;   // Daemon's time
}

// Daemon → Client (push, on request)
interface DaemonStatus {
  type: "daemon:status";
  connectedClients: number;
  uptime: number;
  scriptCacheSize: number;
}
```

## Error Codes

| Code | Meaning |
|-|-|
| `not_found` | Requested file doesn't exist |
| `transpile_error` | SWC failed to transpile the file |
| `resolve_error` | Module resolution failed (import not found) |
| `auth_failed` | Authentication token invalid |
| `target_not_found` | Message relay target doesn't exist |
| `invalid_message` | Malformed message (missing required fields) |
| `rate_limited` | Too many requests (future, if needed) |

## TypeScript Package

```typescript
// packages/protocol/src/index.ts

// Re-export all message types
export type { Hello, Welcome } from "./messages/handshake";
export type { FileRequest, FileResponse, FileInvalidate } from "./messages/filesystem";
export type { ServiceRegister, ServiceDiscover } from "./messages/registry";
export type { MessageSend, MessageIncoming, MessageBroadcast } from "./messages/relay";
export type { StateUpdate } from "./messages/state";
export type { ScriptLoaded, ScriptError, ScriptReload } from "./messages/script";
export type { PingRequest, PongResponse } from "./messages/diagnostics";

// Type guard helpers
export function isFileRequest(msg: Message): msg is FileRequest;
export function isMessageSend(msg: Message): msg is MessageSend;
// ...

// Version constant
export const PROTOCOL_VERSION = 1;
```

Zero runtime dependencies. Pure types + type guards + constants.

## Versioning Strategy

- Protocol version is a single integer, incremented on breaking changes
- New message types can be added without version bump (additive)
- Removing or changing existing message fields = version bump
- Client and daemon negotiate version on `hello`/`welcome`
- Daemon supports current version and one prior version (rolling window)
