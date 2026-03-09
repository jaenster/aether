const feature = @import("../feature.zig");
const log = @import("../log.zig");
const Engine = @import("../sm/engine.zig").Engine;

var engine: ?Engine = null;
var initialized: bool = false;

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
    const ctx = eng.createContext();
    if (ctx == null) {
        log.print("scripting: failed to create OOG context");
        return;
    }
    eng.oog_context = ctx;

    if (eng.eval(ctx.?, "1+1")) |result| {
        log.printStr("scripting: eval result: ", result);
    } else {
        log.print("scripting: eval failed");
    }
}

fn deinit() void {
    if (engine) |*eng| {
        eng.deinit();
        engine = null;
    }
    log.print("scripting: shutdown");
}

fn gameLoop() void {
    ensureInit();
    if (engine) |*eng| {
        eng.pumpMicrotasks();
    }
}

fn oogLoop() void {
    ensureInit();
    if (engine) |*eng| {
        eng.pumpMicrotasks();
    }
}

pub const hooks = feature.Hooks{
    .deinit = &deinit,
    .gameLoop = &gameLoop,
    .oogLoop = &oogLoop,
};
