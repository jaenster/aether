const std = @import("std");
const win = std.os.windows;
const Allocator = std.mem.Allocator;

const patch = @import("hook/patch.zig");
const trampoline = @import("hook/trampoline.zig");
const types = @import("d2/types.zig");
const D2PoolManagerStrc = types.D2PoolManagerStrc;

const DWORD = u32;
const BYTE = u8;

// FOG pool function addresses (D2 1.14d)
const ADDR_INIT_POOL_SYSTEM: usize = 0x00409DD0; // stdcall (D2PoolManagerStrc**, char*, i32)
const ADDR_POOL_ALLOC: usize = 0x0040A080; // thiscall (this, size, char*, i32) -> void*
const ADDR_POOL_FREE: usize = 0x00409AB0; // thiscall (this, void**, char*, i32)
const ADDR_POOL_REALLOC: usize = 0x0040A1F0; // cdecl (D2PoolManagerStrc*, void*, size, char*, i32) -> void*
const ADDR_FREE_MEMORY_POOL: usize = 0x00409C80; // thiscall — the teardown hook target

// Thiscall: ECX = this, args on stack. On x86-windows Zig, .Thiscall puts first arg in ECX.
const PoolAllocFn = *const fn (*D2PoolManagerStrc, usize, [*:0]const u8, i32) callconv(.Thiscall) ?[*]BYTE;
const PoolFreeFn = *const fn (*D2PoolManagerStrc, *?[*]BYTE, [*:0]const u8, i32) callconv(.Thiscall) void;
const PoolReallocFn = *const fn (*D2PoolManagerStrc, ?[*]BYTE, usize, [*:0]const u8, i32) callconv(.Fastcall) ?[*]BYTE;

pub const pool_alloc: PoolAllocFn = @ptrFromInt(ADDR_POOL_ALLOC);
pub const pool_free: PoolFreeFn = @ptrFromInt(ADDR_POOL_FREE);
pub const pool_realloc: PoolReallocFn = @ptrFromInt(ADDR_POOL_REALLOC);

const InitPoolSystemFn = *const fn (**D2PoolManagerStrc, [*:0]const u8, i32) callconv(.Stdcall) void;
const init_pool_system: InitPoolSystemFn = @ptrFromInt(ADDR_INIT_POOL_SYSTEM);

var aether_pool: ?*D2PoolManagerStrc = null;

/// Create our own FOG memory pool. Call after FOG is initialized (DLL attach is fine).
pub fn initPool() ?*D2PoolManagerStrc {
    if (aether_pool != null) return aether_pool;
    var pool_ptr: *D2PoolManagerStrc = undefined;
    init_pool_system(&pool_ptr, "Aether", 0);
    aether_pool = pool_ptr;
    return aether_pool;
}

pub fn getPool() ?*D2PoolManagerStrc {
    return aether_pool;
}

// Cleanup callback for pool teardown notifications
const CleanupFn = *const fn (?*anyopaque) void;

const CleanupNode = struct {
    callback: CleanupFn,
    ctx: ?*anyopaque,
    next: ?*CleanupNode,
};

const FogPoolMeta = struct {
    pool: *D2PoolManagerStrc,
    cleanup_list: ?*CleanupNode,
};

// Registry: pool ptr -> FogPoolMeta ptr (max 8 active pools)
const MAX_POOLS = 8;
const RegistryEntry = struct {
    pool: *D2PoolManagerStrc,
    meta: *FogPoolMeta,
};
var pool_registry: [MAX_POOLS]?RegistryEntry = .{null} ** MAX_POOLS;

const FILE_TAG: [*:0]const u8 = "Aether";

fn findRegistryEntry(pool: *D2PoolManagerStrc) ?*RegistryEntry {
    for (&pool_registry) |*entry| {
        if (entry.*) |*e| {
            if (e.pool == pool) return e;
        }
    }
    return null;
}

fn lazyInitMeta(pool: *D2PoolManagerStrc) ?*FogPoolMeta {
    // Already registered?
    if (findRegistryEntry(pool)) |e| return e.meta;

    // Allocate FogPoolMeta from the pool itself
    const raw = pool_alloc(pool, @sizeOf(FogPoolMeta), FILE_TAG, 0) orelse return null;
    const meta: *FogPoolMeta = @ptrCast(@alignCast(raw));
    meta.* = .{ .pool = pool, .cleanup_list = null };

    // Register
    for (&pool_registry) |*slot| {
        if (slot.* == null) {
            slot.* = .{ .pool = pool, .meta = meta };
            return meta;
        }
    }

    // Registry full — free and fail
    var ptr_to_raw: ?[*]BYTE = raw;
    pool_free(pool, &ptr_to_raw, FILE_TAG, 0);
    return null;
}

/// Register a cleanup callback that fires when the given pool is destroyed.
pub fn registerCleanup(pool: *D2PoolManagerStrc, callback: CleanupFn, ctx: ?*anyopaque) bool {
    const meta = lazyInitMeta(pool) orelse return false;

    // Allocate CleanupNode from the pool
    const raw = pool_alloc(pool, @sizeOf(CleanupNode), FILE_TAG, 0) orelse return false;
    const node: *CleanupNode = @ptrCast(@alignCast(raw));
    node.* = .{ .callback = callback, .ctx = ctx, .next = meta.cleanup_list };
    meta.cleanup_list = node;
    return true;
}

// --- FreeMemoryPool hook ---
// We intercept FreeMemoryPool to run cleanup callbacks before the pool is destroyed.

var free_pool_trampoline: ?trampoline.Trampoline = null;
const FreePoolFn = *const fn (*D2PoolManagerStrc) callconv(.Thiscall) void;
var original_free_pool: ?FreePoolFn = null;

fn hookFreeMemoryPool(this: *D2PoolManagerStrc) callconv(.Thiscall) void {
    // Find and run cleanup for this pool
    for (&pool_registry) |*slot| {
        if (slot.*) |entry| {
            if (entry.pool == this) {
                // Walk cleanup list
                var node = entry.meta.cleanup_list;
                while (node) |n| {
                    n.callback(n.ctx);
                    node = n.next;
                }
                // Remove from registry
                slot.* = null;
                break;
            }
        }
    }

    // Call original FreeMemoryPool — nukes everything including our metadata
    if (original_free_pool) |f| f(this);
}

pub fn installFreePoolHook() void {
    if (trampoline.build(ADDR_FREE_MEMORY_POOL, 5)) |tramp| {
        free_pool_trampoline = tramp;
        original_free_pool = @ptrCast(@alignCast(tramp.buffer));
        _ = patch.writeJump(ADDR_FREE_MEMORY_POOL, @intFromPtr(&hookFreeMemoryPool));
    }
}

// --- std.mem.Allocator interface ---

fn fogAlloc(pool: *D2PoolManagerStrc, n: usize, alignment: u29) ?[*]u8 {
    // FOG pools use power-of-2 bucket sizes.
    // For alignment <= 8 (typical), natural alignment is satisfied.
    // For larger alignments, over-allocate and store a 1-byte header with the offset.
    if (alignment <= @sizeOf(usize)) {
        // No alignment overhead needed
        return pool_alloc(pool, n, FILE_TAG, 0);
    }

    // Over-allocate: need `n + alignment` bytes to guarantee alignment + 1 byte header
    const total = n + alignment;
    const raw = pool_alloc(pool, total, FILE_TAG, 0) orelse return null;
    const raw_addr = @intFromPtr(raw);

    // Find aligned address with room for 1-byte header
    const aligned_addr = std.mem.alignForward(usize, raw_addr + 1, alignment);
    const offset: u8 = @intCast(aligned_addr - raw_addr);

    // Store offset in byte immediately before aligned pointer
    const header: *u8 = @ptrFromInt(aligned_addr - 1);
    header.* = offset;

    return @ptrFromInt(aligned_addr);
}

fn fogFree(pool: *D2PoolManagerStrc, ptr: [*]u8, alignment: u29) void {
    if (alignment <= @sizeOf(usize)) {
        var raw_ptr: ?[*]BYTE = ptr;
        pool_free(pool, &raw_ptr, FILE_TAG, 0);
        return;
    }

    // Read the offset header
    const aligned_addr = @intFromPtr(ptr);
    const header: *const u8 = @ptrFromInt(aligned_addr - 1);
    const raw_addr = aligned_addr - @as(usize, header.*);
    var raw_ptr: ?[*]BYTE = @ptrFromInt(raw_addr);
    pool_free(pool, &raw_ptr, FILE_TAG, 0);
}

fn fogAllocFn(ctx: *anyopaque, n: usize, log2_align: u8, _: usize) ?[*]u8 {
    const pool: *D2PoolManagerStrc = @ptrCast(@alignCast(ctx));
    const alignment: u29 = @as(u29, 1) << @intCast(log2_align);
    return fogAlloc(pool, n, alignment);
}

fn fogResizeFn(_: *anyopaque, _: []u8, _: u8, _: usize) bool {
    // FOG pools don't support in-place resize
    return false;
}

fn fogFreeFn(ctx: *anyopaque, buf: []u8, log2_align: u8, _: usize) void {
    const pool: *D2PoolManagerStrc = @ptrCast(@alignCast(ctx));
    const alignment: u29 = @as(u29, 1) << @intCast(log2_align);
    fogFree(pool, buf.ptr, alignment);
}

/// Get a std.mem.Allocator backed by a specific FOG pool.
pub fn forPool(pool: *D2PoolManagerStrc) Allocator {
    return .{
        .ptr = @ptrCast(pool),
        .vtable = &fog_vtable,
    };
}

const fog_vtable = Allocator.VTable{
    .alloc = fogAllocFn,
    .resize = fogResizeFn,
    .free = fogFreeFn,
};

// --- Bootstrap allocator ---
// Static 64KB bump allocator for DLL_PROCESS_ATTACH (before FOG is ready).

var bootstrap_buf: [64 * 1024]u8 align(16) = undefined;
var bootstrap_offset: usize = 0;

fn bootstrapAllocFn(_: *anyopaque, n: usize, log2_align: u8, _: usize) ?[*]u8 {
    const alignment: usize = @as(usize, 1) << @intCast(log2_align);
    const aligned = std.mem.alignForward(usize, bootstrap_offset, alignment);
    if (aligned + n > bootstrap_buf.len) return null;
    bootstrap_offset = aligned + n;
    return @ptrCast(&bootstrap_buf[aligned]);
}

fn bootstrapResizeFn(_: *anyopaque, _: []u8, _: u8, _: usize) bool {
    return false;
}

fn bootstrapFreeFn(_: *anyopaque, _: []u8, _: u8, _: usize) void {
    // Bump allocator doesn't free
}

const bootstrap_vtable = Allocator.VTable{
    .alloc = bootstrapAllocFn,
    .resize = bootstrapResizeFn,
    .free = bootstrapFreeFn,
};

/// Static bump allocator for use before FOG pools are available.
pub fn bootstrapAllocator() Allocator {
    return .{
        .ptr = undefined,
        .vtable = &bootstrap_vtable,
    };
}
