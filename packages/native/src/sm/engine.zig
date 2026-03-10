const std = @import("std");
pub const c = @cImport(@cInclude("sm_bridge.h"));
const log = @import("../log.zig");

pub const NativeFn = *const fn (?*anyopaque, c_uint, ?*anyopaque) callconv(.c) c_int;

pub const Engine = struct {
    runtime: ?*anyopaque = null,
    oog_context: ?*anyopaque = null,
    game_context: ?*anyopaque = null,

    pub fn init(heap_limit_mb: i32) Engine {
        if (c.sm_init() != 0) {
            log.print("sm: init failed");
            return .{};
        }
        const runtime = c.sm_create_runtime(heap_limit_mb);
        if (runtime == null) {
            log.print("sm: create_runtime failed");
            return .{};
        }
        return .{ .runtime = runtime };
    }

    pub fn deinit(self: *Engine) void {
        if (self.oog_context) |ctx| {
            c.sm_destroy_context(ctx);
            self.oog_context = null;
        }
        if (self.game_context) |ctx| {
            c.sm_destroy_context(ctx);
            self.game_context = null;
        }
        if (self.runtime) |rt| {
            c.sm_destroy_runtime(rt);
            self.runtime = null;
        }
        c.sm_shutdown();
    }

    pub fn createContext(self: *Engine) ?*anyopaque {
        const rt = self.runtime orelse return null;
        return c.sm_create_context(rt);
    }

    pub fn destroyContext(_: *Engine, ctx: *anyopaque) void {
        c.sm_destroy_context(ctx);
    }

    pub fn eval(_: *Engine, ctx: *anyopaque, source: []const u8) ?[]const u8 {
        var result_buf: [4096]u8 = undefined;
        const len = c.sm_eval(
            ctx,
            source.ptr,
            @intCast(source.len),
            &result_buf,
            result_buf.len,
        );
        if (len < 0) {
            const err_msg = std.mem.sliceTo(@as([*:0]const u8, @ptrCast(&result_buf)), 0);
            log.printStr("sm eval error: ", err_msg);
            return null;
        }
        return result_buf[0..@intCast(len)];
    }

    pub fn registerNativeFn(self: *Engine, ctx: *anyopaque, name: [*:0]const u8, func: NativeFn, nargs: c_uint) bool {
        _ = self;
        return c.sm_register_native_fn(ctx, name, func, nargs) == 0;
    }

    pub fn pumpMicrotasks(self: *Engine) void {
        if (self.game_context) |ctx| c.sm_pump_gc(ctx);
    }

    pub fn heapUsed(self: *Engine) usize {
        const rt = self.runtime orelse return 0;
        return @intCast(c.sm_get_heap_used(rt));
    }

    pub fn heapLimit(self: *Engine) usize {
        const rt = self.runtime orelse return 0;
        return @intCast(c.sm_get_heap_limit(rt));
    }
};
