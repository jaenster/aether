const std = @import("std");
const win = std.os.windows;
const WINAPI = win.WINAPI;

const DWORD = u32;
const BYTE = u8;

extern "kernel32" fn VirtualProtect(addr: *anyopaque, size: usize, new_protect: DWORD, old_protect: *DWORD) callconv(WINAPI) win.BOOL;

const PAGE_READWRITE: DWORD = 0x04;

const OriginalByte = struct {
    addr: usize,
    value: BYTE,
};

var original_bytes: [512]OriginalByte = undefined;
var original_count: usize = 0;

fn saveOriginal(addr: usize, value: BYTE) void {
    // Don't save duplicates
    for (original_bytes[0..original_count]) |entry| {
        if (entry.addr == addr) return;
    }
    if (original_count < original_bytes.len) {
        original_bytes[original_count] = .{ .addr = addr, .value = value };
        original_count += 1;
    }
}

fn writeBytesProtected(addr: usize, bytes: []const BYTE) bool {
    var old_protect: DWORD = 0;
    const ptr: *anyopaque = @ptrFromInt(addr);
    if (VirtualProtect(ptr, bytes.len, PAGE_READWRITE, &old_protect) == 0) return false;

    const dest: [*]BYTE = @ptrFromInt(addr);
    for (bytes, 0..) |b, i| {
        saveOriginal(addr + i, dest[i]);
        dest[i] = b;
    }

    _ = VirtualProtect(ptr, bytes.len, old_protect, &old_protect);
    return true;
}

fn fillBytesProtected(addr: usize, value: BYTE, len: usize) bool {
    var old_protect: DWORD = 0;
    const ptr: *anyopaque = @ptrFromInt(addr);
    if (VirtualProtect(ptr, len, PAGE_READWRITE, &old_protect) == 0) return false;

    const dest: [*]BYTE = @ptrFromInt(addr);
    for (0..len) |i| {
        saveOriginal(addr + i, dest[i]);
        dest[i] = value;
    }

    _ = VirtualProtect(ptr, len, old_protect, &old_protect);
    return true;
}

pub fn calcRelAddr(from: usize, to: usize, insn_len: usize) i32 {
    return @as(i32, @intCast(@as(isize, @bitCast(to)) - @as(isize, @bitCast(from)) - @as(isize, @intCast(insn_len))));
}

/// Write a 5-byte JMP (E9) from `addr` to `target`.
pub fn writeJump(addr: usize, target: usize) bool {
    const rel = calcRelAddr(addr, target, 5);
    const rel_bytes: [4]u8 = @bitCast(rel);
    const bytes = [5]BYTE{ 0xE9, rel_bytes[0], rel_bytes[1], rel_bytes[2], rel_bytes[3] };
    return writeBytesProtected(addr, &bytes);
}

/// Write a 5-byte CALL (E8) from `addr` to `target`.
pub fn writeCall(addr: usize, target: usize) bool {
    const rel = calcRelAddr(addr, target, 5);
    const rel_bytes: [4]u8 = @bitCast(rel);
    const bytes = [5]BYTE{ 0xE8, rel_bytes[0], rel_bytes[1], rel_bytes[2], rel_bytes[3] };
    return writeBytesProtected(addr, &bytes);
}

/// NOP fill from `addr` for `len` bytes.
pub fn writeNops(addr: usize, len: usize) bool {
    return fillBytesProtected(addr, 0x90, len);
}

/// Write arbitrary bytes at `addr`.
pub fn writeBytes(addr: usize, bytes: []const BYTE) bool {
    return writeBytesProtected(addr, bytes);
}

/// Revert all patched bytes to their original values.
pub fn revertAll() void {
    var i: usize = original_count;
    while (i > 0) {
        i -= 1;
        const entry = original_bytes[i];
        var old_protect: DWORD = 0;
        const ptr: *anyopaque = @ptrFromInt(entry.addr);
        if (VirtualProtect(ptr, 1, PAGE_READWRITE, &old_protect) != 0) {
            const dest: *BYTE = @ptrFromInt(entry.addr);
            dest.* = entry.value;
            _ = VirtualProtect(ptr, 1, old_protect, &old_protect);
        }
    }
    original_count = 0;
}

/// Revert bytes at a specific address range.
pub fn revertRange(addr: usize, len: usize) void {
    var old_protect: DWORD = 0;
    const ptr: *anyopaque = @ptrFromInt(addr);
    if (VirtualProtect(ptr, len, PAGE_READWRITE, &old_protect) == 0) return;

    for (original_bytes[0..original_count]) |entry| {
        if (entry.addr >= addr and entry.addr < addr + len) {
            const dest: *BYTE = @ptrFromInt(entry.addr);
            dest.* = entry.value;
        }
    }

    _ = VirtualProtect(ptr, len, old_protect, &old_protect);
}
