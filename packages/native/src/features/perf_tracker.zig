// Perf tracker — measures server tick time by reading game frame counter.
// No dangerous ASM hooks. Uses GetTickCount before/after frame counter changes.

const feature = @import("../feature.zig");
const log = @import("../log.zig");

const DWORD = u32;
extern "kernel32" fn QueryPerformanceCounter(lp: *i64) callconv(.winapi) i32;
extern "kernel32" fn QueryPerformanceFrequency(lp: *i64) callconv(.winapi) i32;
extern "kernel32" fn GetTickCount() callconv(.winapi) DWORD;

var qpc_freq: u64 = 0;
var last_report: DWORD = 0;

// Server tick detection via dwGameFrame in D2GameStrc
// D2GameStrc* is at game token in DATA_LastGameToken array
// But simpler: just count how many times our hook fires with new game state

// Track total frame time (between hook calls) — already done by feature.zig
// What we add: reading game frame counter to detect server ticks

// D2GameStrc.dwGameFrame offset = 0x7C (from Ghidra)
// We can find pGame via: DATA_LastGameToken[0] → QSERVER_FindAndLockGame → pGame->dwGameFrame
// But that's complex. Simpler: just count draw frames (from feature.zig) vs server callbacks

var total_server_ticks: u32 = 0;
var total_client_frames: u32 = 0;

fn init() void {
    var freq: i64 = 0;
    _ = QueryPerformanceFrequency(&freq);
    qpc_freq = @intCast(freq);
}

fn gameLoop() void {
    total_client_frames += 1;
}

fn report() void {
    const lh = log.openLogHandle() orelse return;
    defer log.closeHandle(lh);

    // Feature dispatch timing from feature.zig gives us per-feature breakdown.
    // Here we just report the hook call count to correlate with server ticks.
    log.writeRawHandle(lh, "ticks: client=");
    writeU(lh, total_client_frames);

    // Read current Frames_PerSecond / TimeBetweenFrames
    const fps: *const i32 = @ptrFromInt(0x883D5C);
    const tbf: *const i32 = @ptrFromInt(0x883D60);
    log.writeRawHandle(lh, " server_fps=");
    writeU(lh, @intCast(fps.*));
    log.writeRawHandle(lh, " tbf=");
    writeU(lh, @intCast(tbf.*));
    log.writeRawHandle(lh, "ms\r\n");

    total_client_frames = 0;
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
    .gameLoop = &gameLoop,
};
