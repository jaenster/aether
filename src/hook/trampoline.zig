const std = @import("std");
const win = std.os.windows;
const WINAPI = win.WINAPI;
const patch = @import("patch.zig");

const DWORD = u32;
const BYTE = u8;

const MEM_COMMIT: DWORD = 0x1000;
const MEM_RESERVE: DWORD = 0x2000;
const MEM_RELEASE: DWORD = 0x8000;
const PAGE_EXECUTE_READWRITE: DWORD = 0x40;

extern "kernel32" fn VirtualAlloc(addr: ?*anyopaque, size: usize, alloc_type: DWORD, protect: DWORD) callconv(WINAPI) ?[*]BYTE;
extern "kernel32" fn VirtualFree(addr: *anyopaque, size: usize, free_type: DWORD) callconv(WINAPI) win.BOOL;

pub const Trampoline = struct {
    buffer: [*]BYTE,
    buffer_size: usize,

    pub fn destroy(self: *Trampoline) void {
        _ = VirtualFree(@ptrCast(self.buffer), 0, MEM_RELEASE);
        self.buffer = undefined;
    }
};

/// Build a trampoline for a detour hook.
///
/// Copies `hook_size` bytes from `target_addr` into an executable buffer,
/// fixes up any relative E8 (CALL) or E9 (JMP) instructions within those bytes,
/// then appends a JMP back to `target_addr + hook_size`.
///
/// Returns the trampoline struct, or null on failure.
pub fn build(target_addr: usize, hook_size: usize) ?Trampoline {
    const alloc_size = hook_size + 5; // copied bytes + JMP back
    const buf = VirtualAlloc(null, alloc_size, MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE) orelse return null;

    // Copy original bytes
    const src: [*]const BYTE = @ptrFromInt(target_addr);
    @memcpy(buf[0..hook_size], src[0..hook_size]);

    // Fix up relative CALL (E8) and JMP (E9) instructions
    var i: usize = 0;
    while (i < hook_size) {
        if ((buf[i] == 0xE8 or buf[i] == 0xE9) and i + 5 <= hook_size) {
            // Read the original relative offset
            const orig_rel: i32 = @bitCast([4]u8{ buf[i + 1], buf[i + 2], buf[i + 3], buf[i + 4] });
            // Calculate absolute target
            const abs_target: usize = @intCast(@as(isize, @intCast(target_addr + i + 5)) + @as(isize, orig_rel));
            // Calculate new relative offset from trampoline position
            const tramp_insn_addr: usize = @intFromPtr(buf) + i;
            const new_rel = patch.calcRelAddr(tramp_insn_addr, abs_target, 5);
            const new_bytes: [4]u8 = @bitCast(new_rel);
            buf[i + 1] = new_bytes[0];
            buf[i + 2] = new_bytes[1];
            buf[i + 3] = new_bytes[2];
            buf[i + 4] = new_bytes[3];
            i += 5;
        } else {
            i += 1;
        }
    }

    // Append JMP back to original + hook_size
    const jmp_back_addr: usize = @intFromPtr(buf) + hook_size;
    const return_addr = target_addr + hook_size;
    const jmp_rel = patch.calcRelAddr(jmp_back_addr, return_addr, 5);
    const jmp_bytes: [4]u8 = @bitCast(jmp_rel);
    buf[hook_size] = 0xE9;
    buf[hook_size + 1] = jmp_bytes[0];
    buf[hook_size + 2] = jmp_bytes[1];
    buf[hook_size + 3] = jmp_bytes[2];
    buf[hook_size + 4] = jmp_bytes[3];

    return .{
        .buffer = buf,
        .buffer_size = alloc_size,
    };
}
