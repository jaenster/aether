const std = @import("std");
const win = std.os.windows;
const WINAPI = win.WINAPI;

const HANDLE = *anyopaque;
const INVALID_HANDLE: HANDLE = @ptrFromInt(std.math.maxInt(usize));
const DWORD = u32;

extern "kernel32" fn CreateFileA(
    name: [*:0]const u8,
    access: DWORD,
    share: DWORD,
    sa: ?*anyopaque,
    disp: DWORD,
    flags: DWORD,
    template: ?HANDLE,
) callconv(WINAPI) HANDLE;

extern "kernel32" fn WriteFile(
    h: HANDLE,
    buf: [*]const u8,
    len: DWORD,
    written: ?*DWORD,
    overlapped: ?*anyopaque,
) callconv(WINAPI) win.BOOL;

extern "kernel32" fn CloseHandle(h: HANDLE) callconv(WINAPI) win.BOOL;
extern "kernel32" fn AllocConsole() callconv(WINAPI) win.BOOL;
extern "kernel32" fn GetStdHandle(id: DWORD) callconv(WINAPI) HANDLE;

const STD_OUTPUT_HANDLE: DWORD = @as(DWORD, @bitCast(@as(i32, -11)));
var console_handle: ?HANDLE = null;

const SetFilePointer = struct {
    extern "kernel32" fn SetFilePointer(h: HANDLE, dist: i32, high: ?*i32, method: DWORD) callconv(WINAPI) DWORD;
}.SetFilePointer;

const GENERIC_WRITE: DWORD = 0x40000000;
const FILE_SHARE_READ: DWORD = 0x00000001;
const OPEN_ALWAYS: DWORD = 4;
const FILE_ATTRIBUTE_NORMAL: DWORD = 0x80;

pub fn initConsole() void {
    _ = AllocConsole();
    const h = GetStdHandle(STD_OUTPUT_HANDLE);
    if (h != INVALID_HANDLE) {
        console_handle = h;
    }
}

pub fn openLogHandle() ?HANDLE {
    return openLog();
}

pub fn writeRawHandle(h: HANDLE, buf: []const u8) void {
    writeRaw(h, buf);
}

pub fn closeHandle(h: HANDLE) void {
    _ = CloseHandle(h);
}

fn openLog() ?HANDLE {
    const h = CreateFileA(
        "aether_log.txt",
        GENERIC_WRITE,
        FILE_SHARE_READ,
        null,
        OPEN_ALWAYS,
        FILE_ATTRIBUTE_NORMAL,
        null,
    );
    if (h == INVALID_HANDLE) return null;
    _ = SetFilePointer(h, 0, null, 2); // FILE_END
    return h;
}

fn writeRaw(h: HANDLE, buf: []const u8) void {
    var written: DWORD = 0;
    _ = WriteFile(h, buf.ptr, @intCast(buf.len), &written, null);
}

fn writeConsole(buf: []const u8) void {
    if (console_handle) |ch| {
        var written: DWORD = 0;
        _ = WriteFile(ch, buf.ptr, @intCast(buf.len), &written, null);
    }
}

pub fn print(comptime msg: []const u8) void {
    const h = openLog() orelse return;
    defer _ = CloseHandle(h);
    writeRaw(h, msg ++ "\r\n");
    writeConsole(msg ++ "\r\n");
}

/// Print "prefix" + hex value + newline
pub fn hex(comptime prefix: []const u8, value: usize) void {
    const h = openLog() orelse return;
    defer _ = CloseHandle(h);
    writeRaw(h, prefix);
    var buf: [8]u8 = undefined;
    const digits = "0123456789ABCDEF";
    var v = value;
    var i: usize = 8;
    while (i > 0) {
        i -= 1;
        buf[i] = digits[v & 0xF];
        v >>= 4;
    }
    writeRaw(h, &buf);
    writeRaw(h, "\r\n");
    writeConsole(prefix);
    writeConsole(&buf);
    writeConsole("\r\n");
}

/// Print comptime prefix + runtime string slice + newline
pub fn printStr(comptime prefix: []const u8, s: []const u8) void {
    const h = openLog() orelse return;
    defer _ = CloseHandle(h);
    writeRaw(h, prefix);
    writeRaw(h, s);
    writeRaw(h, "\r\n");
    writeConsole(prefix);
    writeConsole(s);
    writeConsole("\r\n");
}
