const std = @import("std");
const feature = @import("../feature.zig");
const log = @import("../log.zig");
const Engine = @import("../sm/engine.zig").Engine;
const bindings = @import("../sm/bindings.zig");
const DaemonConnection = @import("../net/daemon.zig").DaemonConnection;
const ScriptLoader = @import("../net/script_loader.zig").ScriptLoader;
const packet_hooks = @import("packet_hooks.zig");

var engine: ?Engine = null;
var daemon: DaemonConnection = .{};
var loader: ScriptLoader = .{};
var initialized: bool = false;
var daemon_enabled: bool = false;
var loader_enabled: bool = false;

const polyfill = @embedFile("../sm/polyfill.js");

fn setupContext(eng: *Engine, ctx: *anyopaque) void {
    _ = bindings.registerAll(eng, ctx);
    _ = eng.eval(ctx, polyfill);
}

/// Called synchronously from packet_hooks when a registered S2C packet arrives.
/// Returns false to block the packet from being processed.
fn onPacketReceived(opcode: u8) bool {
    const eng = &(engine orelse return true);
    const ctx = eng.oog_context orelse return true;

    // Format: __onPacket(opcode) — JS returns "false" to block
    var buf: [48]u8 = undefined;
    const code = std.fmt.bufPrint(&buf, "__onPacket({d})", .{opcode}) catch return true;
    const result = eng.eval(ctx, code) orelse return true;
    // If JS returned "false", block the packet
    return !std.mem.eql(u8, result, "false");
}

fn ensureInit() void {
    if (initialized) return;
    initialized = true;

    // Wire up the packet hook callback
    packet_hooks.on_packet_callback = &onPacketReceived;

    engine = Engine.init(96);
    if (engine.?.runtime == null) {
        log.print("scripting: SM engine init FAILED");
        engine = null;
        return;
    }

    var eng = &engine.?;
    const ctx = eng.createContext() orelse {
        log.print("scripting: failed to create context");
        return;
    };
    eng.oog_context = ctx;

    setupContext(eng, ctx);

    daemon_enabled = daemon.init();
    if (daemon_enabled) {
        loader_enabled = loader.init();
    }
}

fn deinit() void {
    if (daemon_enabled) daemon.deinit();
    if (engine) |*eng| {
        eng.deinit();
        engine = null;
    }
    log.print("scripting: shutdown");
}

/// Destroy the current context and create a fresh one with bindings re-registered.
/// Used for hot-reload since SM60 module graphs are immutable.
fn recreateContext() void {
    var eng = &(engine orelse return);
    if (eng.oog_context) |ctx| {
        eng.destroyContext(ctx);
        eng.oog_context = null;
    }

    const ctx = eng.createContext() orelse {
        log.print("scripting: failed to recreate context");
        return;
    };
    eng.oog_context = ctx;
    setupContext(eng, ctx);
}

var gc_counter: u32 = 0;
var native_report_tick: u32 = 0;

extern "kernel32" fn GetTickCount() callconv(.winapi) u32;
extern "kernel32" fn QueryPerformanceFrequency(lp: *i64) callconv(.winapi) i32;

fn tickCommon() void {
    ensureInit();
    const eng = &(engine orelse return);

    // GC nudge once per second (~25 ticks), not every frame
    gc_counter += 1;
    if (gc_counter >= 25) {
        gc_counter = 0;
        eng.pumpMicrotasks();
    }

    // Report native call stats every 10s
    const tick = GetTickCount();
    if (tick -% native_report_tick >= 10_000) {
        native_report_tick = tick;
        const stats = eng.getNativeCallStats();
        if (stats.count > 0) {
            var freq: i64 = 0;
            _ = QueryPerformanceFrequency(&freq);
            const freq_u: u64 = @intCast(freq);
            const us = if (freq_u > 0) (stats.ticks / freq_u) * 1_000_000 + (stats.ticks % freq_u) * 1_000_000 / freq_u else 0;
            const ms: u32 = @intCast(us / 1000);
            const avg_ns: u32 = if (stats.count > 0) @intCast((us * 1000) / stats.count) else 0;

            const lh = log.openLogHandle() orelse return;
            defer log.closeHandle(lh);
            log.writeRawHandle(lh, "native: ");
            writeU(lh, ms);
            log.writeRawHandle(lh, "ms ");
            writeU(lh, @intCast(stats.count));
            log.writeRawHandle(lh, " calls avg=");
            writeU(lh, avg_ns);
            log.writeRawHandle(lh, "ns/call\r\n");
        }
    }

    if (!daemon_enabled) return;

    // Drive daemon connection
    if (daemon.tick()) |msg| {
        handleDaemonMessage(eng, msg);
    }

    // Request entry script once daemon is ready
    if (loader_enabled and loader.state == .idle and daemon.isReady()) {
        loader.requestEntry(&daemon);
    }
}

fn gameLoop() void {
    was_in_game = true;
    tickCommon();
    const eng = &(engine orelse return);

    // Tick the bot generator each game frame — direct call, no eval/compile
    if (loader.state == .loaded) {
        const ctx = eng.oog_context orelse return;
        if (!eng.callGlobalFn(ctx, "__onTick")) {
            log.print("scripting: __onTick error");
        }
    }
}

var was_in_game: bool = false;

fn oogLoop() void {
    // Trigger GC when transitioning out of game — lots of garbage from the run
    if (was_in_game) {
        was_in_game = false;
        const eng = &(engine orelse return);
        eng.pumpMicrotasks();
        log.print("scripting: GC after game exit");
    }
    tickCommon();
}


fn writeU(lh: *anyopaque, val: u32) void {
    var buf: [10]u8 = undefined;
    var v = val;
    var i: usize = 10;
    if (v == 0) { log.writeRawHandle(lh, "0"); return; }
    while (v > 0 and i > 0) { i -= 1; buf[i] = @intCast((v % 10) + '0'); v /= 10; }
    log.writeRawHandle(lh, buf[i..10]);
}

fn handleDaemonMessage(eng: *Engine, msg: []const u8) void {
    const ctx = eng.oog_context orelse return;

    // Check if this is a hot-reload (loader already in .loaded state)
    const is_reload = loader.state == .loaded;

    // Hot-reload: clear module entries but keep the context alive (globalThis survives)
    if (is_reload and @import("../net/json.zig").hasStringValue(msg, "type", "file:response")) {
        log.print("scripting: hot-reload — clearing modules, keeping context");
        eng.invalidateCallCache();
        eng.moduleClear(ctx);
        _ = loader.handleMessage(msg, eng, ctx);
        return;
    }

    _ = loader.handleMessage(msg, eng, ctx);
}

pub const hooks = feature.Hooks{
    .deinit = &deinit,
    .gameLoop = &gameLoop,
    .oogLoop = &oogLoop,
};
