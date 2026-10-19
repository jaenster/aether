//! The injector's script feature: drives script_host.zig from the feature hooks.

const feature = @import("../feature.zig");
const script_host = @import("../script_host.zig");
const globals = @import("../d2/globals.zig");

fn deinit() void {
    script_host.deinit();
}

fn gameLoop() void {
    // Disable NoPickUp so items can be auto-picked when walking over them
    globals.noPickUp().* = 0;
    script_host.gameTick();
}

fn oogLoop() void {
    script_host.oogTick();
}

pub const hooks = feature.Hooks{
    .deinit = &deinit,
    .gameLoop = &gameLoop,
    .oogLoop = &oogLoop,
    .gameAutomapPostDraw = &script_host.gameAutomapPostDraw,
    .gamePostDraw = &script_host.gamePostDraw,
    .oogPostDraw = &script_host.oogPostDraw,
    .allPostDraw = &script_host.allPostDraw,
};
