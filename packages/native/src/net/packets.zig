//! Server-to-client packets as the scripts see them.
//!
//! Whoever owns the receive path calls `received` with each packet and its real
//! size before the game handles it. The injector does that from its handler
//! table wrappers (features/packet_hooks.zig); an embedding host does it from
//! its own receive hook. Nothing here writes to the game.

// D2 packet handler table at 0x007114D0: 175 entries of 12 bytes,
// { fpHandler, nExpectedSize, fpUnitHandler }.
pub const HANDLER_TABLE: usize = 0x007114D0;
pub const MAX_OPCODES = 175;
pub const ENTRY_SIZE = 12;

// Handlers are __fastcall with 1 arg: pBytes in ECX. Thiscall is equivalent for single-arg.
pub const HandlerFn = *const fn ([*]const u8) callconv(.{ .x86_thiscall = .{} }) void;

/// Which opcodes JS wants to see.
var js_registered: [MAX_OPCODES]bool = .{false} ** MAX_OPCODES;
/// Which client-to-server opcodes JS wants to see (256: every C->S id).
var js_registered_out: [256]bool = .{false} ** 256;

/// The packet being processed. JS reads it through the bindings.
pub var current_packet_ptr: ?[*]const u8 = null;
pub var current_packet_len: u32 = 0;

/// Set by the script host. Returns false to block the packet.
pub var on_packet_callback: ?*const fn (u8) bool = null;
pub var on_packet_out_callback: ?*const fn (u8) bool = null;

/// Where `inject` finds the handler for an opcode. By default it reads the
/// table as it is at call time; the injector points it at the handlers it
/// saved before it wrapped them.
pub var handler_source: *const fn (u8) ?HandlerFn = &tableHandler;

fn tableHandler(opcode: u8) ?HandlerFn {
    const table: [*]align(1) const u32 = @ptrFromInt(HANDLER_TABLE);
    const p = table[@as(usize, opcode) * 3];
    return if (p != 0) @ptrFromInt(p) else null;
}

/// A server-to-client packet arrived. Returns false when JS blocked it.
pub fn received(bytes: [*]const u8, size: u32) bool {
    if (size == 0) return true;
    const opcode = bytes[0];
    if (opcode >= MAX_OPCODES or !js_registered[opcode]) return true;
    const cb = on_packet_callback orelse return true;
    current_packet_ptr = bytes;
    current_packet_len = size;
    defer {
        current_packet_ptr = null;
        current_packet_len = 0;
    }
    return cb(opcode);
}

/// A client-to-server packet is about to be sent. Returns false when JS blocked it.
pub fn sending(bytes: [*]const u8, size: u32) bool {
    if (size == 0) return true;
    const opcode = bytes[0];
    if (!js_registered_out[opcode]) return true;
    const cb = on_packet_out_callback orelse return true;
    current_packet_ptr = bytes;
    current_packet_len = size;
    defer {
        current_packet_ptr = null;
        current_packet_len = 0;
    }
    return cb(opcode);
}

/// Hand a fake server-to-client packet to the game's handler for its opcode.
pub fn inject(data: [*]const u8, len: u32) void {
    if (len == 0) return;
    const opcode = data[0];
    if (opcode >= MAX_OPCODES) return;
    if (handler_source(opcode)) |handler| handler(data);
}

pub fn registerOpcode(opcode: u8) void {
    if (opcode >= MAX_OPCODES) return;
    js_registered[opcode] = true;
}

pub fn unregisterOpcode(opcode: u8) void {
    if (opcode >= MAX_OPCODES) return;
    js_registered[opcode] = false;
}

pub fn registerOutOpcode(opcode: u8) void {
    js_registered_out[opcode] = true;
}

pub fn unregisterAll() void {
    @memset(&js_registered, false);
    @memset(&js_registered_out, false);
}
