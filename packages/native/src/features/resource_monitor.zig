const feature = @import("../feature.zig");
const log = @import("../log.zig");

const HANDLE = *anyopaque;
const DWORD = u32;
const BOOL = i32;

const FILETIME = extern struct {
    dwLowDateTime: DWORD,
    dwHighDateTime: DWORD,
};

const PROCESS_MEMORY_COUNTERS = extern struct {
    cb: DWORD,
    PageFaultCount: DWORD,
    PeakWorkingSetSize: usize,
    WorkingSetSize: usize,
    QuotaPeakPagedPoolUsage: usize,
    QuotaPagedPoolUsage: usize,
    QuotaPeakNonPagedPoolUsage: usize,
    QuotaNonPagedPoolUsage: usize,
    PagefileUsage: usize,
    PeakPagefileUsage: usize,
};

extern "kernel32" fn GetCurrentProcess() callconv(.winapi) HANDLE;
extern "kernel32" fn GetProcessTimes(h: HANDLE, creation: *FILETIME, exit: *FILETIME, kernel: *FILETIME, user: *FILETIME) callconv(.winapi) BOOL;
extern "kernel32" fn GetTickCount() callconv(.winapi) DWORD;

// K32GetProcessMemoryInfo is the modern name (kernel32 re-export)
extern "kernel32" fn K32GetProcessMemoryInfo(h: HANDLE, ppsmemCounters: *PROCESS_MEMORY_COUNTERS, cb: DWORD) callconv(.winapi) BOOL;

var last_report_tick: DWORD = 0;
var start_tick: DWORD = 0;

fn filetimeToMs(ft: FILETIME) u64 {
    const v: u64 = (@as(u64, ft.dwHighDateTime) << 32) | ft.dwLowDateTime;
    return v / 10_000; // 100ns units → ms
}

fn formatU64(buf: []u8, val: u64) []const u8 {
    if (val == 0) {
        buf[buf.len - 1] = '0';
        return buf[buf.len - 1 ..];
    }
    var v = val;
    var i: usize = buf.len;
    while (v > 0 and i > 0) {
        i -= 1;
        buf[i] = @intCast((v % 10) + '0');
        v /= 10;
    }
    return buf[i..];
}

fn reportResources() void {
    const h = GetCurrentProcess();

    var creation: FILETIME = undefined;
    var exit_ft: FILETIME = undefined;
    var kernel: FILETIME = undefined;
    var user: FILETIME = undefined;

    var cpu_str: []const u8 = "?";
    var cpu_buf: [20]u8 = undefined;

    if (GetProcessTimes(h, &creation, &exit_ft, &kernel, &user) != 0) {
        const total_ms = filetimeToMs(kernel) + filetimeToMs(user);
        cpu_str = formatU64(&cpu_buf, total_ms);
    }

    var mem: PROCESS_MEMORY_COUNTERS = undefined;
    mem.cb = @sizeOf(PROCESS_MEMORY_COUNTERS);

    var ws_str: []const u8 = "?";
    var ws_buf: [20]u8 = undefined;
    var peak_str: []const u8 = "?";
    var peak_buf: [20]u8 = undefined;

    if (K32GetProcessMemoryInfo(h, &mem, @sizeOf(PROCESS_MEMORY_COUNTERS)) != 0) {
        ws_str = formatU64(&ws_buf, mem.WorkingSetSize / (1024 * 1024));
        peak_str = formatU64(&peak_buf, mem.PeakWorkingSetSize / (1024 * 1024));
    }

    const lh = log.openLogHandle() orelse return;
    defer log.closeHandle(lh);

    log.writeRawHandle(lh, "resources: cpu=");
    log.writeRawHandle(lh, cpu_str);
    log.writeRawHandle(lh, "ms mem=");
    log.writeRawHandle(lh, ws_str);
    log.writeRawHandle(lh, "MB peak=");
    log.writeRawHandle(lh, peak_str);
    log.writeRawHandle(lh, "MB\r\n");
}

fn gameLoop() void {
    const now = GetTickCount();
    if (start_tick == 0) start_tick = now;
    // Report every 10 seconds
    if (now -% last_report_tick >= 10_000) {
        last_report_tick = now;
        reportResources();
    }
}

fn oogLoop() void {
    const now = GetTickCount();
    if (start_tick == 0) start_tick = now;
    if (now -% last_report_tick >= 10_000) {
        last_report_tick = now;
        reportResources();
    }
}

pub const hooks = feature.Hooks{
    .gameLoop = &gameLoop,
    .oogLoop = &oogLoop,
};
