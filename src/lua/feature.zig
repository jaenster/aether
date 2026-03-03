const feature = @import("../feature.zig");
const engine = @import("engine.zig");
const fog = @import("../fog_allocator.zig");
const log = @import("../log.zig");

pub const hooks: feature.Hooks = .{
    .gameLoop = &gameLoop,
};

var pool_ready: bool = false;
var pool_attached: bool = false;
var pending_pool: ?*@import("../d2/types.zig").D2PoolManagerStrc = null;

fn gameLoop() void {
    if (!pool_attached) {
        if (pool_ready) {
            if (pending_pool) |pool| {
                engine.attachPool(pool);
                log.print("lua: using FOG pool allocator");
            }
            pool_attached = true;
        } else {
            if (fog.initPool()) |pool| {
                pending_pool = pool;
            } else {
                pool_attached = true;
            }
            pool_ready = true;
        }
    }
    engine.tick();
}
