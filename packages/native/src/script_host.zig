//! The script engine and its daemon connection, driven by ticks and draw calls
//! from whoever hosts it: the injector's feature hooks (features/scripting.zig)
//! or an embedding host (embed.zig). Nothing here patches the game.

const std = @import("std");
const log = @import("log.zig");
const Engine = @import("sm/engine.zig").Engine;
const bindings = @import("sm/bindings.zig");
const DaemonConnection = @import("net/daemon.zig").DaemonConnection;
const ScriptLoader = @import("net/script_loader.zig").ScriptLoader;
const packets = @import("net/packets.zig");
const json = @import("net/json.zig");

var engine: ?Engine = null;
var daemon: DaemonConnection = .{};
var loader: ScriptLoader = .{};
var initialized: bool = false;
var daemon_enabled: bool = false;
var loader_enabled: bool = false;

/// JS heap limit handed to the runtime.
pub var heap_limit_mb: i32 = 96;

const polyfill = @embedFile("sm/polyfill.js");

fn setupContext(eng: *Engine, ctx: *anyopaque) void {
    _ = bindings.registerAll(eng, ctx);
    _ = eng.eval(ctx, polyfill);
}

fn callPacketFn(comptime name: []const u8, opcode: u8) bool {
    const eng = &(engine orelse return true);
    const ctx = eng.oog_context orelse return true;

    // Format: __onPacket(opcode) — JS returns "false" to block
    var buf: [48]u8 = undefined;
    const code = std.fmt.bufPrint(&buf, name ++ "({d})", .{opcode}) catch return true;
    const result = eng.eval(ctx, code) orelse return true;
    // If JS returned "false", block the packet
    return !std.mem.eql(u8, result, "false");
}

/// Called synchronously when a registered S2C packet arrives.
/// Returns false to block the packet from being processed.
fn onPacketReceived(opcode: u8) bool {
    return callPacketFn("__onPacket", opcode);
}

/// Called synchronously before a registered C2S packet is sent.
fn onPacketSending(opcode: u8) bool {
    return callPacketFn("__onPacketOut", opcode);
}

fn ensureInit() void {
    if (initialized) return;
    initialized = true;

    packets.on_packet_callback = &onPacketReceived;
    packets.on_packet_out_callback = &onPacketSending;

    engine = Engine.init(heap_limit_mb);
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

/// The engine runs: the runtime and the first context exist.
pub fn running() bool {
    return engine != null;
}

pub fn deinit() void {
    if (daemon_enabled) daemon.deinit();
    if (engine) |*eng| {
        eng.deinit();
        engine = null;
    }
    log.print("scripting: shutdown");
}

var gc_counter: u32 = 0;
var native_report_tick: u32 = 0;

extern "kernel32" fn GetTickCount() callconv(.winapi) u32;
extern "kernel32" fn QueryPerformanceFrequency(lp: *i64) callconv(.winapi) i32;

fn tickCommon() void {
    ensureInit();
    const eng = &(engine orelse return);

    // GC nudge every 5 ticks (~5/sec). SM60 needs frequent GC to handle
    // per-frame Unit/array allocations. Less than this causes null deref crashes.
    gc_counter += 1;
    if (gc_counter >= 5) {
        gc_counter = 0;
        eng.pumpMicrotasks();
    }

    // Report native call stats every 10s
    const tick = GetTickCount();
    if (tick -% native_report_tick >= 10_000) {
        native_report_tick = tick;
        reportNativeStats(eng);
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

fn reportNativeStats(eng: *Engine) void {
    const stats = eng.getNativeCallStats();
    if (stats.count == 0) return;
    var freq: i64 = 0;
    _ = QueryPerformanceFrequency(&freq);
    const freq_u: u64 = @intCast(freq);
    const us = if (freq_u > 0) (stats.ticks / freq_u) * 1_000_000 + (stats.ticks % freq_u) * 1_000_000 / freq_u else 0;
    const ms: u32 = @intCast(us / 1000);
    const avg_ns: u32 = @intCast((us * 1000) / stats.count);

    // Calls per frame (assuming 25fps = 250 frames per 10s window)
    const calls_per_frame: u32 = @intCast(stats.count / 250);

    var buf: [128]u8 = undefined;
    const line = std.fmt.bufPrint(&buf, "{d}ms {d} calls ({d}/frame) avg={d}ns/call", .{ ms, stats.count, calls_per_frame, avg_ns }) catch return;
    log.printStr("native: ", line);
}

var was_in_game: bool = false;

/// One game-thread tick while in game: runs the script's __onTick.
pub fn gameTick() void {
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

/// One game-thread tick out of game: runs the script's __onOogTick.
pub fn oogTick() void {
    // Trigger GC when transitioning out of game — lots of garbage from the run
    if (was_in_game) {
        was_in_game = false;
        const eng = &(engine orelse return);
        eng.pumpMicrotasks();
        log.print("scripting: GC after game exit");
    }
    tickCommon();

    // Process any deferred OOG actions (e.g. char creation OK click)
    bindings.processPendingOogAction();

    // Tick JS during OOG — same pattern as gameLoop's __onTick
    const eng = &(engine orelse return);
    if (loader.state == .loaded) {
        const ctx = eng.oog_context orelse return;
        if (!eng.callGlobalFn(ctx, "__onOogTick")) {
            // Suppress spam — OOG tick errors are expected if bot doesn't define it
        }
    }
}

fn handleDaemonMessage(eng: *Engine, msg: []const u8) void {
    const ctx = eng.oog_context orelse return;

    // Check if this is a hot-reload (loader already in .loaded state)
    const is_reload = loader.state == .loaded;

    // Hot-reload: clear module entries but keep the context alive (globalThis survives)
    if (is_reload and json.hasStringValue(msg, "type", "file:response")) {
        log.print("scripting: hot-reload — clearing modules, keeping context");
        eng.invalidateCallCache();
        eng.moduleClear(ctx);
        _ = loader.handleMessage(msg, eng, ctx);
        return;
    }

    _ = loader.handleMessage(msg, eng, ctx);
}

fn callDrawHook(comptime name: [*:0]const u8) void {
    const eng = &(engine orelse return);
    if (loader.state != .loaded) return;
    const ctx = eng.oog_context orelse return;
    _ = eng.callGlobalFn(ctx, name);
}

pub fn gameAutomapPostDraw() void {
    callDrawHook("__onAutomapDraw");
}

pub fn gamePostDraw() void {
    callDrawHook("__onGameDraw");
}

pub fn oogPostDraw() void {
    callDrawHook("__onOogDraw");
}

pub fn allPostDraw() void {
    callDrawHook("__onDraw");
}
