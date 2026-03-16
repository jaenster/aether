const feature = @import("../feature.zig");
const log = @import("../log.zig");

const DWORD = u32;

extern "kernel32" fn GetTickCount() callconv(.winapi) DWORD;
extern "kernel32" fn Sleep(dwMilliseconds: DWORD) callconv(.winapi) void;
extern "kernel32" fn QueryPerformanceCounter(lpPerformanceCount: *i64) callconv(.winapi) i32;
extern "kernel32" fn QueryPerformanceFrequency(lpFrequency: *i64) callconv(.winapi) i32;
extern "winmm" fn timeBeginPeriod(uPeriod: u32) callconv(.winapi) u32;
extern "winmm" fn timeEndPeriod(uPeriod: u32) callconv(.winapi) u32;

const TARGET_FRAME_MS: u32 = 40; // 25 FPS

var qpc_freq: u64 = 0;
var last_frame_qpc: i64 = 0;
var last_report_tick: DWORD = 0;

// Rolling stats (reset every 10s)
var total_frames: u32 = 0;
var total_frame_us: u64 = 0; // total wall time between hook calls
var max_frame_us: u64 = 0;
var min_frame_us: u64 = 0xFFFFFFFFFFFFFFFF;
var frames_over_40ms: u32 = 0;
var total_sleep_ms: u64 = 0;

fn qpcNow() i64 {
    var val: i64 = 0;
    _ = QueryPerformanceCounter(&val);
    return val;
}

fn ticksToUs(ticks: u64) u64 {
    if (qpc_freq == 0) return 0;
    return (ticks / qpc_freq) * 1_000_000 + (ticks % qpc_freq) * 1_000_000 / qpc_freq;
}

fn init() void {
    var freq: i64 = 0;
    _ = QueryPerformanceFrequency(&freq);
    qpc_freq = @intCast(freq);
    // Request 1ms timer resolution for accurate Sleep()
    _ = timeBeginPeriod(1);
}

fn gameLoop() void {
    const now = qpcNow();

    if (last_frame_qpc != 0) {
        const delta: u64 = @intCast(now - last_frame_qpc);
        const frame_us = ticksToUs(delta);

        total_frames += 1;
        total_frame_us += frame_us;
        if (frame_us > max_frame_us) max_frame_us = frame_us;
        if (frame_us < min_frame_us) min_frame_us = frame_us;
        if (frame_us > 40_000) frames_over_40ms += 1;

        // Yield CPU. The game's EndScene handles 25fps pacing.
        // We replace the game's NOP'd Sleep(10) with our own — same effect but we
        // get timing data. This fires every message pump iteration, not just renders.
        Sleep(1);
        total_sleep_ms += 1;
    }

    last_frame_qpc = qpcNow();

    // Report every 10 seconds
    const tick = GetTickCount();
    if (tick -% last_report_tick >= 10_000) {
        last_report_tick = tick;
        report();
    }
}

fn oogLoop() void {
    Sleep(1);
}

fn report() void {
    if (total_frames == 0) return;

    const avg_us: u32 = @intCast(total_frame_us / total_frames);
    const max_us: u32 = @intCast(@min(max_frame_us, 0xFFFFFFFF));
    const min_us: u32 = @intCast(@min(min_frame_us, 0xFFFFFFFF));
    const fps = total_frames / 10;
    const avg_sleep: u32 = @intCast(total_sleep_ms / total_frames);

    const lh = log.openLogHandle() orelse return;
    defer log.closeHandle(lh);

    log.writeRawHandle(lh, "perf: ");
    writeU(lh, fps);
    log.writeRawHandle(lh, "fps frame=");
    writeU(lh, avg_us / 1000);
    log.writeRawHandle(lh, "/");
    writeU(lh, min_us / 1000);
    log.writeRawHandle(lh, "/");
    writeU(lh, max_us / 1000);
    log.writeRawHandle(lh, "ms(avg/min/max) sleep=");
    writeU(lh, avg_sleep);
    log.writeRawHandle(lh, "ms over40=");
    writeU(lh, frames_over_40ms);
    log.writeRawHandle(lh, "/");
    writeU(lh, total_frames);
    log.writeRawHandle(lh, "\r\n");

    // Reset
    total_frames = 0;
    total_frame_us = 0;
    max_frame_us = 0;
    min_frame_us = 0xFFFFFFFFFFFFFFFF;
    frames_over_40ms = 0;
    total_sleep_ms = 0;
}

fn writeU(lh: *anyopaque, val: u32) void {
    var buf: [10]u8 = undefined;
    var v = val;
    var i: usize = 10;
    if (v == 0) {
        log.writeRawHandle(lh, "0");
        return;
    }
    while (v > 0 and i > 0) {
        i -= 1;
        buf[i] = @intCast((v % 10) + '0');
        v /= 10;
    }
    log.writeRawHandle(lh, buf[i..10]);
}

pub const hooks = feature.Hooks{
    .init = &init,
    .gameLoop = &gameLoop,
    .oogLoop = &oogLoop,
};
