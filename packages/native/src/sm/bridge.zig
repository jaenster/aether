//! The C ABI of sm_bridge.h as a table of function pointers.
//!
//! Every call into mozjs.dll goes through `api`. The injector (Aether.dll) links
//! mozjs.dll's import library and fills the table from those imports
//! (`bridge_linked.zig`). An embedding host loads mozjs.dll itself and fills it
//! with `resolve`, so its own import table never names mozjs.dll.
//!
//! Keep the fields in step with sm_bridge.h: one field per SM_API function,
//! same name, same C signature.

const std = @import("std");

pub const NativeFn = ?*const fn (?*anyopaque, c_uint, ?*anyopaque) callconv(.c) c_int;

pub const Api = struct {
    sm_init: *const fn () callconv(.c) c_int,
    sm_shutdown: *const fn () callconv(.c) void,

    sm_create_runtime: *const fn (heap_limit_mb: c_int) callconv(.c) ?*anyopaque,
    sm_destroy_runtime: *const fn (runtime: ?*anyopaque) callconv(.c) void,

    sm_create_context: *const fn (runtime: ?*anyopaque) callconv(.c) ?*anyopaque,
    sm_destroy_context: *const fn (context: ?*anyopaque) callconv(.c) void,

    sm_eval: *const fn (context: ?*anyopaque, source: [*c]const u8, source_len: c_int, result_buf: [*c]u8, result_buf_len: c_int) callconv(.c) c_int,
    sm_pump_gc: *const fn (context: ?*anyopaque) callconv(.c) void,

    sm_call_global_function: *const fn (context: ?*anyopaque, name: [*c]const u8) callconv(.c) c_int,
    sm_invalidate_call_cache: *const fn () callconv(.c) void,
    sm_get_native_call_stats: *const fn (out_count_lo: [*c]u32, out_count_hi: [*c]u32, out_ticks_lo: [*c]u32, out_ticks_hi: [*c]u32) callconv(.c) c_int,

    sm_register_native_fn: *const fn (context: ?*anyopaque, name: [*c]const u8, func: NativeFn, nargs: c_uint) callconv(.c) c_int,

    sm_arg_double: *const fn (argc: c_uint, vp: ?*anyopaque, idx: c_uint) callconv(.c) f64,
    sm_arg_int32: *const fn (argc: c_uint, vp: ?*anyopaque, idx: c_uint) callconv(.c) c_int,
    sm_arg_string: *const fn (context: ?*anyopaque, argc: c_uint, vp: ?*anyopaque, idx: c_uint, buf: [*c]u8, buf_len: c_int) callconv(.c) c_int,
    sm_ret_double: *const fn (argc: c_uint, vp: ?*anyopaque, val: f64) callconv(.c) void,
    sm_ret_int32: *const fn (argc: c_uint, vp: ?*anyopaque, val: c_int) callconv(.c) void,
    sm_ret_string: *const fn (context: ?*anyopaque, argc: c_uint, vp: ?*anyopaque, str: [*c]const u8, len: c_int) callconv(.c) void,
    sm_ret_bool: *const fn (argc: c_uint, vp: ?*anyopaque, val: c_int) callconv(.c) void,
    sm_ret_undefined: *const fn (argc: c_uint, vp: ?*anyopaque) callconv(.c) void,
    sm_arg_uint8array: *const fn (context: ?*anyopaque, argc: c_uint, vp: ?*anyopaque, idx: c_uint, out_data: [*c][*c]const u8) callconv(.c) c_int,
    sm_ret_int32array: *const fn (context: ?*anyopaque, argc: c_uint, vp: ?*anyopaque, data: [*c]const c_int, count: c_int) callconv(.c) void,
    sm_ret_uint8array: *const fn (context: ?*anyopaque, argc: c_uint, vp: ?*anyopaque, data: [*c]const u8, count: c_int) callconv(.c) void,
    sm_ret_external_int32array: *const fn (context: ?*anyopaque, argc: c_uint, vp: ?*anyopaque, data: [*c]c_int, count: c_int) callconv(.c) void,

    sm_module_init: *const fn (context: ?*anyopaque) callconv(.c) c_int,
    sm_module_compile: *const fn (context: ?*anyopaque, specifier: [*c]const u8, spec_len: c_int, source: [*c]const u8, source_len: c_int, err_buf: [*c]u8, err_buf_len: c_int) callconv(.c) c_int,
    sm_module_instantiate: *const fn (context: ?*anyopaque, entry_spec: [*c]const u8, spec_len: c_int, err_buf: [*c]u8, err_buf_len: c_int) callconv(.c) c_int,
    sm_module_evaluate: *const fn (context: ?*anyopaque, entry_spec: [*c]const u8, spec_len: c_int, err_buf: [*c]u8, err_buf_len: c_int) callconv(.c) c_int,
    sm_module_clear: *const fn (context: ?*anyopaque) callconv(.c) void,

    sm_get_heap_used: *const fn (runtime: ?*anyopaque) callconv(.c) c_int,
    sm_get_heap_limit: *const fn (runtime: ?*anyopaque) callconv(.c) c_int,
};

/// Number of functions the bridge exports.
pub const function_count = @typeInfo(Api).@"struct".fields.len;

/// The table every bridge call goes through. Valid once `ready` is true.
pub var api: Api = undefined;
pub var ready: bool = false;

/// Fill the table from an already linked set of functions.
pub fn install(table: Api) void {
    api = table;
    ready = true;
}

extern "kernel32" fn GetProcAddress(module: *anyopaque, name: [*:0]const u8) callconv(.winapi) ?*anyopaque;

/// Fill the table from a loaded mozjs.dll. On a missing export the table stays
/// unready and `missing` names the first export not found.
pub fn resolve(module: *anyopaque, missing: *?[:0]const u8) bool {
    var table: Api = undefined;
    inline for (@typeInfo(Api).@"struct".fields) |f| {
        const p = GetProcAddress(module, f.name) orelse {
            missing.* = f.name;
            return false;
        };
        @field(table, f.name) = @ptrCast(@alignCast(p));
    }
    install(table);
    return true;
}

test "the table has one field per bridge export" {
    try std.testing.expectEqual(@as(usize, 31), function_count);
}
