const feature = @import("../feature.zig");
const log = @import("../log.zig");
const Engine = @import("../sm/engine.zig").Engine;
const bindings = @import("../sm/bindings.zig");
const DaemonConnection = @import("../net/daemon.zig").DaemonConnection;

var engine: ?Engine = null;
var daemon: DaemonConnection = .{};
var initialized: bool = false;
var tested_bindings: bool = false;
var daemon_enabled: bool = false;

/// Deferred init — can't run during DllMain (loader lock blocks thread creation).
/// Called on the first game/oog loop tick instead.
fn ensureInit() void {
    if (initialized) return;
    initialized = true;

    log.print("scripting: initializing SpiderMonkey engine...");
    engine = Engine.init(96);
    if (engine.?.runtime == null) {
        log.print("scripting: SM engine init FAILED");
        engine = null;
        return;
    }
    log.print("scripting: SM engine initialized");

    var eng = &engine.?;
    const ctx = eng.createContext() orelse {
        log.print("scripting: failed to create OOG context");
        return;
    };
    log.print("scripting: context created");
    eng.oog_context = ctx;

    // Register native game bindings
    _ = bindings.registerAll(eng, ctx);

    if (eng.eval(ctx, "1+1")) |result| {
        log.printStr("scripting: eval result: ", result);
    } else {
        log.print("scripting: eval failed");
    }

    // Initialize daemon connection (if AETHER_DAEMON is set)
    daemon_enabled = daemon.init();
}

fn deinit() void {
    if (daemon_enabled) {
        daemon.deinit();
    }
    if (engine) |*eng| {
        eng.deinit();
        engine = null;
    }
    log.print("scripting: shutdown");
}

fn gameLoop() void {
    ensureInit();
    const eng = &(engine orelse return);
    eng.pumpMicrotasks();

    // Drive daemon connection
    if (daemon_enabled) {
        if (daemon.tick()) |msg| {
            handleDaemonMessage(eng, msg);
        }
    }

    // One-shot test: verify native bindings work in-game
    if (!tested_bindings and feature.in_game) {
        tested_bindings = true;
        const ctx = eng.oog_context orelse return;
        if (eng.eval(ctx, "getArea()")) |result| {
            log.printStr("scripting: getArea() = ", result);
        }
        if (eng.eval(ctx, "'x=' + getUnitX() + ' y=' + getUnitY()")) |result| {
            log.printStr("scripting: pos = ", result);
        }
        if (eng.eval(ctx, "'hp=' + getUnitHP() + '/' + getUnitMaxHP()")) |result| {
            log.printStr("scripting: ", result);
        }
    }
}

fn oogLoop() void {
    ensureInit();
    if (engine) |*eng| {
        eng.pumpMicrotasks();
    }

    // Drive daemon connection in OOG too
    if (daemon_enabled) {
        if (daemon.tick()) |msg| {
            if (engine) |*eng| {
                handleDaemonMessage(eng, msg);
            }
        }
    }
}

fn handleDaemonMessage(eng: *Engine, msg: []const u8) void {
    _ = eng;
    log.printStr("daemon msg: ", msg);
    // TODO: handle file:response, file:invalidate, script:reload, etc.
}

pub const hooks = feature.Hooks{
    .deinit = &deinit,
    .gameLoop = &gameLoop,
    .oogLoop = &oogLoop,
};
