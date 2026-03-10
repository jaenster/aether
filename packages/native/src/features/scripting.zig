const feature = @import("../feature.zig");
const log = @import("../log.zig");
const Engine = @import("../sm/engine.zig").Engine;
const bindings = @import("../sm/bindings.zig");
const DaemonConnection = @import("../net/daemon.zig").DaemonConnection;
const ScriptLoader = @import("../net/script_loader.zig").ScriptLoader;

var engine: ?Engine = null;
var daemon: DaemonConnection = .{};
var loader: ScriptLoader = .{};
var initialized: bool = false;
var tested_bindings: bool = false;
var daemon_enabled: bool = false;
var loader_enabled: bool = false;

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

    _ = bindings.registerAll(eng, ctx);

    if (eng.eval(ctx, "1+1")) |result| {
        log.printStr("scripting: eval result: ", result);
    } else {
        log.print("scripting: eval failed");
    }

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

fn tickCommon() void {
    ensureInit();
    const eng = &(engine orelse return);
    eng.pumpMicrotasks();

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
    tickCommon();
}

fn handleDaemonMessage(eng: *Engine, msg: []const u8) void {
    const ctx = eng.oog_context orelse return;

    // Script loader handles file:response and file:invalidate
    const prev_state = loader.state;
    loader.handleMessage(msg, eng, ctx);
    if (loader.state != prev_state) return;

    if (loader.handleInvalidate(msg)) return;
}

pub const hooks = feature.Hooks{
    .deinit = &deinit,
    .gameLoop = &gameLoop,
    .oogLoop = &oogLoop,
};
