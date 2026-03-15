const log = @import("log.zig");

extern "kernel32" fn QueryPerformanceCounter(lp: *i64) callconv(.winapi) i32;
extern "kernel32" fn QueryPerformanceFrequency(lp: *i64) callconv(.winapi) i32;
extern "kernel32" fn GetTickCount() callconv(.winapi) u32;

pub const Hooks = struct {
    // Lifecycle
    init: ?*const fn () void = null,
    deinit: ?*const fn () void = null,

    // Logic loops (run every frame, separate from rendering)
    gameLoop: ?*const fn () void = null,
    oogLoop: ?*const fn () void = null,

    // Drawing — game
    gameUnitPreDraw: ?*const fn () void = null,
    gameUnitPostDraw: ?*const fn () void = null,
    gameAutomapPreDraw: ?*const fn () void = null,
    gameAutomapPostDraw: ?*const fn () void = null,
    preDraw: ?*const fn () void = null,
    gamePostDraw: ?*const fn () void = null,

    // Drawing — OOG + shared
    oogPostDraw: ?*const fn () void = null,
    allPostDraw: ?*const fn () void = null,

    // Input
    keyEvent: ?*const fn (u32, bool, u32) bool = null,
    mouseEvent: ?*const fn (i32, i32, u8, bool) bool = null, // x, y, button(0=L,1=R,2=M), down
};

const MAX_FEATURES = 32;
var features: [MAX_FEATURES]*const Hooks = undefined;
var count: u8 = 0;
pub var in_game: bool = false;

// Per-feature timing (microseconds per 10s window)
pub var feature_us: [MAX_FEATURES]u64 = [_]u64{0} ** MAX_FEATURES;
pub var dispatch_total_us: u64 = 0;
var perf_freq: u64 = 0;
var last_perf_report: u32 = 0;
var perf_dispatch_count: u32 = 0;

pub fn register(hooks: *const Hooks) void {
    features[count] = hooks;
    count += 1;
}

pub fn initAll() void {
    var freq: i64 = 0;
    _ = QueryPerformanceFrequency(&freq);
    perf_freq = @intCast(freq);

    for (features[0..count]) |f| {
        if (f.init) |cb| cb();
    }
}

pub fn deinitAll() void {
    var i: u8 = count;
    while (i > 0) {
        i -= 1;
        if (features[i].deinit) |cb| cb();
    }
}

fn qpcNow() i64 {
    var v: i64 = 0;
    _ = QueryPerformanceCounter(&v);
    return v;
}

fn toUs(ticks: i64) u64 {
    if (perf_freq == 0 or ticks <= 0) return 0;
    const t: u64 = @intCast(ticks);
    return (t / perf_freq) * 1_000_000 + (t % perf_freq) * 1_000_000 / perf_freq;
}

// Track nested dispatch — draw hooks fire INSIDE game loop, so we
// subtract nested time to avoid double-counting.
var dispatch_depth: u32 = 0;
var nested_us: u64 = 0; // time spent in nested dispatches during current outer dispatch

fn TimedDispatch(comptime field_name: []const u8) type {
    return struct {
        pub fn run() void {
            const is_nested = dispatch_depth > 0;
            dispatch_depth += 1;
            const dispatch_start = qpcNow();

            for (features[0..count], 0..) |f, idx| {
                if (@field(f, field_name)) |cb| {
                    const t0 = qpcNow();
                    cb();
                    const t1 = qpcNow();
                    const delta = t1 - t0;
                    if (delta > 0) {
                        feature_us[idx] +%= toUs(delta);
                    }
                }
            }

            const elapsed = toUs(qpcNow() - dispatch_start);
            dispatch_depth -= 1;

            if (is_nested) {
                // We're inside an outer dispatch — record so outer can subtract us
                nested_us += elapsed;
            } else {
                // Top-level dispatch: subtract any nested dispatch time
                const own_time = if (elapsed > nested_us) elapsed - nested_us else 0;
                dispatch_total_us += own_time;
                nested_us = 0;
                perf_dispatch_count += 1;
            }

            // Report every 10s (only from gameLoop to avoid spam)
            if (comptime std.mem.eql(u8, field_name, "gameLoop")) {
                const tick = GetTickCount();
                if (tick -% last_perf_report >= 10_000) {
                    last_perf_report = tick;
                    reportPerf();
                }
            }
        }
    };
}

const std = @import("std");

fn reportPerf() void {
    if (perf_dispatch_count == 0) return;

    const lh = log.openLogHandle() orelse return;
    defer log.closeHandle(lh);

    log.writeRawHandle(lh, "profile: total=");
    writeU(lh, @intCast(dispatch_total_us / 1000));
    log.writeRawHandle(lh, "ms (");
    writeU(lh, perf_dispatch_count);
    log.writeRawHandle(lh, " calls) per-feature:\r\n");

    for (0..count) |idx| {
        const us = feature_us[idx];
        if (us > 100) { // skip noise (<0.1ms)
            log.writeRawHandle(lh, "  [");
            writeU(lh, @intCast(idx));
            log.writeRawHandle(lh, "] ");
            writeU(lh, @intCast(us / 1000));
            log.writeRawHandle(lh, "ms (");
            writeU(lh, @intCast(us / perf_dispatch_count));
            log.writeRawHandle(lh, "us/call)\r\n");
        }
    }

    // Reset
    dispatch_total_us = 0;
    perf_dispatch_count = 0;
    @memset(&feature_us, 0);
}

fn Dispatch(comptime field_name: []const u8) type {
    return TimedDispatch(field_name);
}

pub const dispatchGameLoop = Dispatch("gameLoop").run;
pub const dispatchOogLoop = Dispatch("oogLoop").run;
pub const dispatchGameUnitPreDraw = Dispatch("gameUnitPreDraw").run;
pub const dispatchGameUnitPostDraw = Dispatch("gameUnitPostDraw").run;
pub const dispatchGameAutomapPreDraw = Dispatch("gameAutomapPreDraw").run;
pub const dispatchGameAutomapPostDraw = Dispatch("gameAutomapPostDraw").run;
pub const dispatchPreDraw = Dispatch("preDraw").run;
pub const dispatchGamePostDraw = Dispatch("gamePostDraw").run;
pub const dispatchOogPostDraw = Dispatch("oogPostDraw").run;
pub const dispatchAllPostDraw = Dispatch("allPostDraw").run;

fn writeU(lh: *anyopaque, val: u32) void {
    var buf: [10]u8 = undefined;
    var v = val;
    var i: usize = 10;
    if (v == 0) { log.writeRawHandle(lh, "0"); return; }
    while (v > 0 and i > 0) { i -= 1; buf[i] = @intCast((v % 10) + '0'); v /= 10; }
    log.writeRawHandle(lh, buf[i..10]);
}

pub fn dispatchKeyEvent(key: u32, down: bool, flags: u32) bool {
    for (features[0..count]) |f| {
        if (f.keyEvent) |cb| {
            if (!cb(key, down, flags)) return false;
        }
    }
    return true;
}

pub fn dispatchMouseEvent(x: i32, y: i32, button: u8, down: bool) bool {
    // Dispatch in reverse order so later-registered features (overlays) get first priority
    var i: u8 = count;
    while (i > 0) {
        i -= 1;
        if (features[i].mouseEvent) |cb| {
            if (!cb(x, y, button, down)) return false;
        }
    }
    return true;
}
