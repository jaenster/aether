const feature = @import("../feature.zig");
const engine = @import("engine.zig");
const fog = @import("../fog_allocator.zig");

pub const hooks: feature.Hooks = .{
    .gameLoop = &gameLoop,
    .oogLoop = &oogLoop,
};

var pool_attached: bool = false;
var lua_initialized: bool = false;

fn ensureInit() void {
    if (!lua_initialized) {
        lua_initialized = true;
        engine.init();
    }
}

fn gameLoop() void {
    ensureInit();
    engine.tick();
}

fn oogLoop() void {
    ensureInit();
    engine.oogTick();
}
