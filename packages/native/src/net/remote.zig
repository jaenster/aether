//! What the daemon may ask of a running game, and what the game reports back
//! to it without being asked. All of it runs on the game thread, from the tick.
//!
//! Requests (daemon -> game):
//!   {"type":"eval","id":"..","code":".."}  -> {"type":"eval:result","id":"..","ok":bool,"result":".."}
//! Reports (game -> daemon):
//!   {"type":"log","lines":[..],"dropped":N}          every tick with new lines
//!   {"type":"state:update","state":{..}}             once a second
//!   {"type":"script:message","payload":".."}         from a script's daemonSend()

const std = @import("std");
const log = @import("../log.zig");
const json = @import("json.zig");
const Engine = @import("../sm/engine.zig").Engine;
const DaemonConnection = @import("daemon.zig").DaemonConnection;

extern "kernel32" fn GetTickCount() callconv(.winapi) u32;

const gpa = std.heap.page_allocator;

// ── eval ─────────────────────────────────────────────────────────────

/// The result of one eval, at most this many bytes of its string form.
var eval_result: [64 * 1024]u8 = undefined;

/// Handle a daemon "eval" request. Returns false when `msg` is not one.
pub fn handleEval(daemon: *DaemonConnection, eng: *Engine, ctx: *anyopaque, msg: []const u8) bool {
    if (!json.hasStringValue(msg, "type", "eval")) return false;
    const id = json.getString(msg, "id") orelse "";
    const code_enc = json.getString(msg, "code") orelse {
        sendEvalResult(daemon, id, false, "eval without code");
        return true;
    };
    const code = gpa.alloc(u8, code_enc.len) catch {
        sendEvalResult(daemon, id, false, "out of memory");
        return true;
    };
    defer gpa.free(code);
    const decoded = json.decodeString(code_enc, code) orelse {
        sendEvalResult(daemon, id, false, "code is not a JSON string");
        return true;
    };
    const r = eng.evalInto(ctx, decoded, &eval_result);
    sendEvalResult(daemon, id, r.ok, r.text);
    return true;
}

fn sendEvalResult(daemon: *DaemonConnection, id: []const u8, ok: bool, text: []const u8) void {
    var out: std.ArrayList(u8) = .empty;
    defer out.deinit(gpa);
    out.appendSlice(gpa, "{\"type\":\"eval:result\",\"id\":\"") catch return;
    // the id came JSON-escaped and goes back as it came
    out.appendSlice(gpa, id) catch return;
    out.appendSlice(gpa, if (ok) "\",\"ok\":true,\"result\":" else "\",\"ok\":false,\"result\":") catch return;
    json.appendString(&out, gpa, text) catch return;
    out.append(gpa, '}') catch return;
    _ = daemon.send(out.items);
}

// ── log forwarding ───────────────────────────────────────────────────

/// Lines not yet sent, each ending in '\n'. Full means newer lines are dropped
/// and counted, so a script that logs in a loop cannot grow it.
var pending: [32 * 1024]u8 = undefined;
var pending_len: usize = 0;
var dropped: u32 = 0;

/// log.zig's tap: every line Aether logs passes here as well.
pub fn tapLine(line: []const u8) void {
    const need = line.len + 1;
    if (pending_len + need > pending.len) {
        dropped += 1;
        return;
    }
    @memcpy(pending[pending_len .. pending_len + line.len], line);
    pending[pending_len + line.len] = '\n';
    pending_len += need;
}

/// Send the lines collected since the last flush.
pub fn flushLog(daemon: *DaemonConnection) void {
    if (pending_len == 0 and dropped == 0) return;
    var out: std.ArrayList(u8) = .empty;
    defer out.deinit(gpa);
    out.appendSlice(gpa, "{\"type\":\"log\",\"lines\":[") catch return;
    var first = true;
    var it = std.mem.splitScalar(u8, pending[0..pending_len], '\n');
    while (it.next()) |line| {
        if (line.len == 0) continue;
        if (!first) out.append(gpa, ',') catch return;
        first = false;
        json.appendString(&out, gpa, line) catch return;
    }
    var tail: [40]u8 = undefined;
    const t = std.fmt.bufPrint(&tail, "],\"dropped\":{d}}}", .{dropped}) catch return;
    out.appendSlice(gpa, t) catch return;
    // Cleared before the send: a line logged by the send itself waits for the next flush.
    pending_len = 0;
    dropped = 0;
    _ = daemon.send(out.items);
}

// ── state heartbeat ──────────────────────────────────────────────────

pub const Snapshot = struct {
    in_game: bool,
    area: i32,
    game_ticks: u32,
    oog_ticks: u32,
    loader: []const u8,
    heap_used: usize,
};

var last_state_tick: u32 = 0;

/// Once a second: what the game is doing, so the daemon can tell a live client
/// from one that stopped ticking without asking it anything.
pub fn maybeSendState(daemon: *DaemonConnection, s: Snapshot) void {
    const now = GetTickCount();
    if (now -% last_state_tick < 1000) return;
    last_state_tick = now;
    var buf: [256]u8 = undefined;
    const msg = std.fmt.bufPrint(&buf, "{{\"type\":\"state:update\",\"state\":{{\"inGame\":{},\"area\":{d},\"gameTicks\":{d},\"oogTicks\":{d},\"loader\":\"{s}\",\"heapUsed\":{d},\"at\":{d}}}}}", .{
        s.in_game, s.area, s.game_ticks, s.oog_ticks, s.loader, s.heap_used, now,
    }) catch return;
    _ = daemon.send(msg);
}

// ── script messages ──────────────────────────────────────────────────

/// Send one script message (any string; scripts send JSON) to the daemon.
pub fn sendScriptMessage(daemon: *DaemonConnection, payload: []const u8) bool {
    if (!daemon.isReady()) return false;
    var out: std.ArrayList(u8) = .empty;
    defer out.deinit(gpa);
    out.appendSlice(gpa, "{\"type\":\"script:message\",\"payload\":") catch return false;
    json.appendString(&out, gpa, payload) catch return false;
    out.append(gpa, '}') catch return false;
    return daemon.send(out.items);
}
