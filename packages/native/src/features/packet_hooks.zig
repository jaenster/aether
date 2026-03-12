const std = @import("std");
const feature = @import("../feature.zig");
const log = @import("../log.zig");
const patch = @import("../hook/patch.zig");

// =============================================================================
// D2 packet handler table at 0x007114D0
// 175 entries, 12 bytes each: { fpHandler(4), nExpectedSize(4), fpUnitHandler(4) }
// Size table at 0x00730AE8 (181 u32 entries — size per opcode, 0xFFFF = variable)
// =============================================================================

const HANDLER_TABLE: usize = 0x007114D0;
const SIZE_TABLE: usize = 0x00730AE8;
const MAX_OPCODES = 175;
const ENTRY_SIZE = 12;

const HandlerFn = *const fn ([*]const u8) callconv(.c) void;

// Original handler pointers saved at init
var original_handlers: [MAX_OPCODES]?HandlerFn = .{null} ** MAX_OPCODES;

// Packet sizes from table (cached at init)
var packet_sizes: [MAX_OPCODES]u32 = .{0} ** MAX_OPCODES;

// Which opcodes JS wants to intercept
var js_registered: [MAX_OPCODES]bool = .{false} ** MAX_OPCODES;

// Current packet being processed — JS reads this via native binding
pub var current_packet_ptr: ?[*]const u8 = null;
pub var current_packet_len: u32 = 0;

// Callback set by scripting.zig — returns false to block the packet
pub var on_packet_callback: ?*const fn (u8) bool = null;

// ============================================================================
// Comptime-generated wrapper functions — one per opcode
// ============================================================================

fn MakeWrapper(comptime opcode: u8) type {
    return struct {
        fn handler(pBytes: [*]const u8) callconv(.c) void {
            if (js_registered[opcode]) {
                current_packet_ptr = pBytes;
                current_packet_len = packet_sizes[opcode];
                if (on_packet_callback) |cb| {
                    if (!cb(opcode)) return; // JS blocked this packet
                }
                current_packet_ptr = null;
            }
            if (original_handlers[opcode]) |orig| {
                orig(pBytes);
            }
        }
    };
}

const wrappers: [MAX_OPCODES]HandlerFn = blk: {
    var w: [MAX_OPCODES]HandlerFn = undefined;
    for (0..MAX_OPCODES) |i| {
        w[i] = &MakeWrapper(i).handler;
    }
    break :blk w;
};

// ============================================================================
// Inject a fake S2C packet — calls original handler directly
// ============================================================================

pub fn injectPacket(data: [*]const u8, len: u32) void {
    if (len == 0) return;
    const opcode = data[0];
    if (opcode >= MAX_OPCODES) return;
    if (original_handlers[opcode]) |handler| {
        handler(data);
    }
}

// ============================================================================
// Register/unregister JS interest in an opcode
// ============================================================================

pub fn registerOpcode(opcode: u8) void {
    if (opcode >= MAX_OPCODES) return;
    js_registered[opcode] = true;
}

pub fn unregisterOpcode(opcode: u8) void {
    if (opcode >= MAX_OPCODES) return;
    js_registered[opcode] = false;
}

pub fn unregisterAll() void {
    @memset(&js_registered, false);
}

// ============================================================================
// Install / Uninstall — patch the handler table
// ============================================================================

fn init() void {
    const table: [*]align(1) u32 = @ptrFromInt(HANDLER_TABLE);
    const sizes: [*]align(1) u32 = @ptrFromInt(SIZE_TABLE);

    // Read original handlers and sizes, then replace with our wrappers
    for (0..MAX_OPCODES) |i| {
        const handler_ptr = table[i * 3]; // fpHandler at offset 0
        original_handlers[i] = if (handler_ptr != 0)
            @ptrFromInt(handler_ptr)
        else
            null;

        packet_sizes[i] = sizes[i];
    }

    // Patch the table — replace handler pointers with our wrappers
    var old_protect: u32 = 0;
    const table_ptr: *anyopaque = @ptrFromInt(HANDLER_TABLE);
    const table_size = MAX_OPCODES * ENTRY_SIZE;

    const kernel32 = struct {
        extern "kernel32" fn VirtualProtect(addr: *anyopaque, size: usize, new: u32, old: *u32) callconv(.winapi) i32;
    };

    if (kernel32.VirtualProtect(table_ptr, table_size, 0x04, &old_protect) != 0) {
        for (0..MAX_OPCODES) |i| {
            if (original_handlers[i] != null) {
                table[i * 3] = @intFromPtr(wrappers[i]);
            }
        }
        _ = kernel32.VirtualProtect(table_ptr, table_size, old_protect, &old_protect);
        log.print("packet_hooks: installed");
    } else {
        log.print("packet_hooks: VirtualProtect failed");
    }
}

fn deinit() void {
    // Restore original handler pointers
    const table: [*]align(1) u32 = @ptrFromInt(HANDLER_TABLE);
    var old_protect: u32 = 0;
    const table_ptr: *anyopaque = @ptrFromInt(HANDLER_TABLE);
    const table_size = MAX_OPCODES * ENTRY_SIZE;

    const kernel32 = struct {
        extern "kernel32" fn VirtualProtect(addr: *anyopaque, size: usize, new: u32, old: *u32) callconv(.winapi) i32;
    };

    if (kernel32.VirtualProtect(table_ptr, table_size, 0x04, &old_protect) != 0) {
        for (0..MAX_OPCODES) |i| {
            if (original_handlers[i]) |orig| {
                table[i * 3] = @intFromPtr(orig);
            }
        }
        _ = kernel32.VirtualProtect(table_ptr, table_size, old_protect, &old_protect);
    }
    log.print("packet_hooks: uninstalled");
}

pub const hooks = feature.Hooks{
    .init = &init,
    .deinit = &deinit,
};
