const std = @import("std");
const win = std.os.windows;

const HMODULE = win.HINSTANCE;
const FARPROC = *const fn () callconv(.winapi) isize;
const BOOL = win.BOOL;
const LPCSTR = [*:0]const u8;
const LPCWSTR = [*:0]const u16;
const LPWSTR = [*:0]u16;
const MAX_PATH = 260;

extern "kernel32" fn GetSystemDirectoryW(buf: [*]u16, size: u32) callconv(.winapi) u32;
extern "kernel32" fn LoadLibraryW(name: LPCWSTR) callconv(.winapi) ?HMODULE;
extern "kernel32" fn FreeLibrary(h: HMODULE) callconv(.winapi) BOOL;
extern "kernel32" fn GetProcAddress(h: HMODULE, name: LPCSTR) callconv(.winapi) ?FARPROC;
extern "kernel32" fn GetCommandLineW() callconv(.winapi) LPWSTR;
extern "kernel32" fn DisableThreadLibraryCalls(h: HMODULE) callconv(.winapi) BOOL;
extern "shell32" fn CommandLineToArgvW(cmd: LPWSTR, pNumArgs: *c_int) callconv(.winapi) ?[*]LPWSTR;
extern "kernel32" fn LocalFree(hMem: ?*anyopaque) callconv(.winapi) ?*anyopaque;
extern "user32" fn MessageBoxW(hWnd: ?*anyopaque, text: LPCWSTR, caption: LPCWSTR, uType: u32) callconv(.winapi) c_int;

const log = @import("log.zig");

var real_dbghelp: ?HMODULE = null;

fn loadRealDbgHelp() ?HMODULE {
    if (real_dbghelp) |h| return h;

    var sys_dir: [MAX_PATH]u16 = undefined;
    const len = GetSystemDirectoryW(&sys_dir, MAX_PATH);
    if (len == 0) return null;

    var path: [MAX_PATH]u16 = undefined;
    var i: usize = 0;
    for (sys_dir[0..len]) |c| {
        path[i] = c;
        i += 1;
    }
    const suffix = comptime std.unicode.utf8ToUtf16LeStringLiteral("\\dbghelp.dll");
    for (suffix) |c| {
        path[i] = c;
        i += 1;
    }
    path[i] = 0;

    real_dbghelp = LoadLibraryW(@ptrCast(&path));
    return real_dbghelp;
}

fn loadInjectedDlls() void {
    var argc: c_int = 0;
    const argv_opt = CommandLineToArgvW(GetCommandLineW(), &argc);
    const argv = argv_opt orelse return;
    defer _ = LocalFree(@ptrCast(argv));

    var i: usize = 0;
    while (i < @as(usize, @intCast(argc)) -| 1) : (i += 1) {
        if (wcsieql(argv[i], w("-loaddll"))) {
            const dll_path = argv[i + 1];
            if (LoadLibraryW(dll_path) == null) {
                _ = MessageBoxW(null, dll_path, w("Aether: Failed to load DLL"), 0x10);
            }
            i += 1;
        }
    }
}

fn wcsieql(a: [*:0]const u16, b: [*:0]const u16) bool {
    var i: usize = 0;
    while (true) : (i += 1) {
        const ca = toLowerW(a[i]);
        const cb = toLowerW(b[i]);
        if (ca != cb) return false;
        if (ca == 0) return true;
    }
}

fn toLowerW(c: u16) u16 {
    return if (c >= 'A' and c <= 'Z') c + 32 else c;
}

fn w(comptime s: []const u8) [*:0]const u16 {
    return comptime std.unicode.utf8ToUtf16LeStringLiteral(s);
}

// Forwarded dbghelp functions.
// We resolve all function pointers eagerly in DllMain (called before Game.exe
// touches dbghelp), then each exported naked function just tail-jumps.

const forwarded_names = [_][:0]const u8{
    "StackWalk",
    "SymCleanup",
    "SymFunctionTableAccess",
    "SymGetModuleBase",
    "SymGetSymFromAddr",
    "SymInitialize",
    "SymSetOptions",
    "UnDecorateSymbolName",
    "MiniDumpWriteDump",
};

var resolved_ptrs: [forwarded_names.len]usize = .{0} ** forwarded_names.len;

fn resolveForwarders() void {
    const h = loadRealDbgHelp() orelse return;
    inline for (forwarded_names, 0..) |name, i| {
        if (GetProcAddress(h, name.ptr)) |proc| {
            resolved_ptrs[i] = @intFromPtr(proc);
        }
    }
}

fn makeForwarder(comptime idx: usize) *const fn () callconv(.naked) void {
    return &(struct {
        fn forward() callconv(.naked) void {
            @setRuntimeSafety(false);
            const ptr = resolved_ptrs[idx];
            asm volatile ("jmp *%[addr]"
                :
                : [addr] "r" (ptr),
            );
        }
    }.forward);
}

comptime {
    @export(makeForwarder(0), .{ .name = "StackWalk", .linkage = .strong });
    @export(makeForwarder(1), .{ .name = "SymCleanup", .linkage = .strong });
    @export(makeForwarder(2), .{ .name = "SymFunctionTableAccess", .linkage = .strong });
    @export(makeForwarder(3), .{ .name = "SymGetModuleBase", .linkage = .strong });
    @export(makeForwarder(4), .{ .name = "SymGetSymFromAddr", .linkage = .strong });
    @export(makeForwarder(5), .{ .name = "SymInitialize", .linkage = .strong });
    @export(makeForwarder(6), .{ .name = "SymSetOptions", .linkage = .strong });
    @export(makeForwarder(7), .{ .name = "UnDecorateSymbolName", .linkage = .strong });
    @export(makeForwarder(8), .{ .name = "MiniDumpWriteDump", .linkage = .strong });
}

pub export fn DllMain(hModule: HMODULE, reason: u32, _: ?*anyopaque) BOOL {
    switch (reason) {
        1 => { // DLL_PROCESS_ATTACH
            log.print("dbghelp_proxy: DLL_PROCESS_ATTACH");
            _ = DisableThreadLibraryCalls(hModule);
            resolveForwarders();
            log.print("dbghelp_proxy: forwarders resolved");
            loadInjectedDlls();
            log.print("dbghelp_proxy: injected DLLs loaded");
        },
        0 => { // DLL_PROCESS_DETACH
            if (real_dbghelp) |h| {
                _ = FreeLibrary(h);
                real_dbghelp = null;
            }
        },
        else => {},
    }
    return 1;
}
