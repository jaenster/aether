const feature = @import("../feature.zig");
const engine = @import("engine.zig");
const fog = @import("../fog_allocator.zig");

pub const hooks: feature.Hooks = .{
    .gameLoop = &gameLoop,
    .oogLoop = &oogLoop,
};

var pool_attached: bool = false;

fn gameLoop() void {
    engine.tick();
}

fn oogLoop() void {
    engine.oogTick();
}
