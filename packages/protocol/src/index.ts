export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 13119;

// Handshake
export type { Hello, Welcome } from "./messages/handshake.js";

// Filesystem
export type {
  ModuleInfo,
  FileRequest,
  FileResponse,
  FileInvalidate,
  FileRawRequest,
  FileRawResponse,
} from "./messages/filesystem.js";

// Registry
export type {
  ClientInfo,
  ServiceRegister,
  ServiceRegistered,
  ServiceDiscover,
  ServiceDiscoverResult,
} from "./messages/registry.js";

// Relay
export type {
  MessageSend,
  MessageIncoming,
  MessageBroadcast,
} from "./messages/relay.js";

// State
export type { StateUpdate } from "./messages/state.js";

// Script
export type {
  ScriptLoaded,
  ScriptError,
  ScriptReload,
} from "./messages/script.js";

// Diagnostics
export type {
  PingRequest,
  PongResponse,
  DaemonStatus,
} from "./messages/diagnostics.js";

// Union of all message types
import type { Hello, Welcome } from "./messages/handshake.js";
import type { FileRequest, FileResponse, FileInvalidate, FileRawRequest, FileRawResponse } from "./messages/filesystem.js";
import type { ServiceRegister, ServiceRegistered, ServiceDiscover, ServiceDiscoverResult } from "./messages/registry.js";
import type { MessageSend, MessageIncoming, MessageBroadcast } from "./messages/relay.js";
import type { StateUpdate } from "./messages/state.js";
import type { ScriptLoaded, ScriptError, ScriptReload } from "./messages/script.js";
import type { PingRequest, PongResponse, DaemonStatus } from "./messages/diagnostics.js";

export type AetherMessage =
  | Hello
  | Welcome
  | FileRequest
  | FileResponse
  | FileInvalidate
  | FileRawRequest
  | FileRawResponse
  | ServiceRegister
  | ServiceRegistered
  | ServiceDiscover
  | ServiceDiscoverResult
  | MessageSend
  | MessageIncoming
  | MessageBroadcast
  | StateUpdate
  | ScriptLoaded
  | ScriptError
  | ScriptReload
  | PingRequest
  | PongResponse
  | DaemonStatus;

// Type guards
export function isFileRequest(msg: { type: string }): msg is FileRequest {
  return msg.type === "file:request";
}

export function isFileRawRequest(msg: { type: string }): msg is FileRawRequest {
  return msg.type === "file:raw";
}

export function isServiceRegister(msg: { type: string }): msg is ServiceRegister {
  return msg.type === "service:register";
}

export function isServiceDiscover(msg: { type: string }): msg is ServiceDiscover {
  return msg.type === "service:discover";
}

export function isMessageSend(msg: { type: string }): msg is MessageSend {
  return msg.type === "message:send";
}

export function isMessageBroadcast(msg: { type: string }): msg is MessageBroadcast {
  return msg.type === "message:broadcast";
}

export function isStateUpdate(msg: { type: string }): msg is StateUpdate {
  return msg.type === "state:update";
}

export function isHello(msg: { type: string }): msg is Hello {
  return msg.type === "hello";
}

export function isPing(msg: { type: string }): msg is PingRequest {
  return msg.type === "ping";
}

export function isScriptReload(msg: { type: string }): msg is ScriptReload {
  return msg.type === "script:reload";
}
