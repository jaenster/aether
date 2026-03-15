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

fn tickCommon() void {
    ensureInit();
    const eng = &(engine orelse return);

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

fn oogLoop() void {
    tickCommon();
}

fn handleDaemonMessage(eng: *Engine, msg: []const u8) void {
    const ctx = eng.oog_context orelse return;

    // Check if this is a hot-reload (loader already in .loaded state)
    const is_reload = loader.state == .loaded;

    // Hot-reload: clear module entries but keep the context alive (globalThis survives)
    if (is_reload and @import("../net/json.zig").hasStringValue(msg, "type", "file:response")) {
        log.print("scripting: hot-reload — clearing modules, keeping context");
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
