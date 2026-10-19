const std = @import("std");
const feature = @import("../feature.zig");
const log = @import("../log.zig");
const packets = @import("../net/packets.zig");

// =============================================================================
// Injector side of net/packets.zig: wraps every handler of the table at
// 0x007114D0 so each S2C packet passes packets.received first.
// Size table at 0x00730AE8 (181 u32 entries — size per opcode, 0xFFFF = variable)
// =============================================================================

const HANDLER_TABLE = packets.HANDLER_TABLE;
const SIZE_TABLE: usize = 0x00730AE8;
const MAX_OPCODES = packets.MAX_OPCODES;
const ENTRY_SIZE = packets.ENTRY_SIZE;
const HandlerFn = packets.HandlerFn;

// Original handler pointers saved at init
var original_handlers: [MAX_OPCODES]?HandlerFn = .{null} ** MAX_OPCODES;

// Packet sizes from table (cached at init)
var packet_sizes: [MAX_OPCODES]u32 = .{0} ** MAX_OPCODES;

fn originalHandler(opcode: u8) ?HandlerFn {
    if (opcode >= MAX_OPCODES) return null;
    return original_handlers[opcode];
}

// ============================================================================
// Comptime-generated wrapper functions — one per opcode
// ============================================================================

fn MakeWrapper(comptime opcode: u8) type {
    return struct {
        fn handler(pBytes: [*]const u8) callconv(.{ .x86_thiscall = .{} }) void {
            if (!packets.received(pBytes, packet_sizes[opcode])) return; // JS blocked this packet
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
// Install / Uninstall — patch the handler table
// ============================================================================

const kernel32 = struct {
    extern "kernel32" fn VirtualProtect(addr: *anyopaque, size: usize, new: u32, old: *u32) callconv(.winapi) i32;
};

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
    packets.handler_source = &originalHandler;

    // Patch the table — replace handler pointers with our wrappers
    var old_protect: u32 = 0;
    const table_ptr: *anyopaque = @ptrFromInt(HANDLER_TABLE);
    const table_size = MAX_OPCODES * ENTRY_SIZE;

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
