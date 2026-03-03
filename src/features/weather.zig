const feature = @import("../feature.zig");
const patch = @import("../hook/patch.zig");
const settings = @import("settings.zig");

const addr: usize = 0x473910;
var patched: bool = false;
var original: [1]u8 = undefined;
var saved: bool = false;

fn saveOriginal() void {
    if (saved) return;
    original[0] = @as(*const u8, @ptrFromInt(addr)).*;
    saved = true;
}

fn gameLoop() void {
    saveOriginal();
    if (settings.disable_weather and !patched) {
        _ = patch.writeBytes(addr, &[_]u8{0xC3});
        patched = true;
    } else if (!settings.disable_weather and patched) {
        _ = patch.writeBytes(addr, &original);
        patched = false;
    }
}

fn deinit() void {
    if (patched and saved) {
        _ = patch.writeBytes(addr, &original);
    }
}

pub const hooks = feature.Hooks{
    .gameLoop = &gameLoop,
    .deinit = &deinit,
};
