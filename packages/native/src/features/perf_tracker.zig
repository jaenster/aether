// Perf tracker — now handled by feature.zig's TimedDispatch.
// This module just logs the server framerate on init.

const feature = @import("../feature.zig");
const log = @import("../log.zig");

fn init() void {
    const fps: *const i32 = @ptrFromInt(0x883D5C);
    const tbf: *const i32 = @ptrFromInt(0x883D60);
    const lh = log.openLogHandle() orelse return;
    defer log.closeHandle(lh);
    log.writeRawHandle(lh, "perf_tracker: server_fps=");
    writeU(lh, @intCast(fps.*));
    log.writeRawHandle(lh, " tbf=");
    writeU(lh, @intCast(tbf.*));
    log.writeRawHandle(lh, "ms\r\n");
}

/// Set server tick rate (default 25fps = 40ms)
pub fn setServerFps(fps: i32) void {
    const pfps: *volatile i32 = @ptrFromInt(0x883D5C);
    const ptbf: *volatile i32 = @ptrFromInt(0x883D60);
    pfps.* = fps;
    ptbf.* = @divTrunc(1000, fps);
}

fn writeU(lh: *anyopaque, val: u32) void {
    var buf: [10]u8 = undefined;
    var v = val;
    var i: usize = 10;
    if (v == 0) { log.writeRawHandle(lh, "0"); return; }
    while (v > 0 and i > 0) { i -= 1; buf[i] = @intCast((v % 10) + '0'); v /= 10; }
    log.writeRawHandle(lh, buf[i..10]);
}

pub const hooks = feature.Hooks{
    .init = &init,
};
