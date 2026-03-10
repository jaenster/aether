const std = @import("std");
const engine_mod = @import("engine.zig");
const Engine = engine_mod.Engine;
const c = engine_mod.c;
const log = @import("../log.zig");
const d2 = @import("../d2/functions.zig");
const globals = @import("../d2/globals.zig");
const types = @import("../d2/types.zig");
const feature = @import("../feature.zig");

// SM arg/ret helpers — argc required for correct JS::CallArgs layout
fn argInt32(argc: c_uint, vp: ?*anyopaque, idx: c_uint) i32 {
    return c.sm_arg_int32(argc, vp, idx);
}

fn retInt32(argc: c_uint, vp: ?*anyopaque, val: i32) void {
    c.sm_ret_int32(argc, vp, val);
}

fn retUndefined(argc: c_uint, vp: ?*anyopaque) void {
    c.sm_ret_undefined(argc, vp);
}

fn retBool(argc: c_uint, vp: ?*anyopaque, val: bool) void {
    c.sm_ret_bool(argc, vp, if (val) 1 else 0);
}

// ── Native binding callbacks ────────────────────────────────────────

fn jsGetArea(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse { retInt32(argc, vp, -1); return 1; };
    const path = player.pPath orelse { retInt32(argc, vp, -1); return 1; };
    const room1 = path.pRoom1 orelse { retInt32(argc, vp, -1); return 1; };
    const room2 = room1.pRoom2 orelse { retInt32(argc, vp, -1); return 1; };
    const level = room2.pLevel orelse { retInt32(argc, vp, -1); return 1; };
    retInt32(argc, vp, @bitCast(level.dwLevelNo));
    return 1;
}

fn jsGetAct(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse { retInt32(argc, vp, -1); return 1; };
    retInt32(argc, vp, @bitCast(player.dwAct));
    return 1;
}

fn jsGetUnitX(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse { retInt32(argc, vp, 0); return 1; };
    const path = player.pPath orelse { retInt32(argc, vp, 0); return 1; };
    retInt32(argc, vp, @as(i32, path.xPos));
    return 1;
}

fn jsGetUnitY(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse { retInt32(argc, vp, 0); return 1; };
    const path = player.pPath orelse { retInt32(argc, vp, 0); return 1; };
    retInt32(argc, vp, @as(i32, path.yPos));
    return 1;
}

fn jsGetUnitHP(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse { retInt32(argc, vp, 0); return 1; };
    const hp = d2.GetUnitStat.call(player, 6, 0);
    retInt32(argc, vp, @bitCast(hp >> 8));
    return 1;
}

fn jsGetUnitMaxHP(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse { retInt32(argc, vp, 0); return 1; };
    const hp = d2.GetUnitStat.call(player, 7, 0);
    retInt32(argc, vp, @bitCast(hp >> 8));
    return 1;
}

fn jsGetUnitMP(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse { retInt32(argc, vp, 0); return 1; };
    const mp = d2.GetUnitStat.call(player, 8, 0);
    retInt32(argc, vp, @bitCast(mp >> 8));
    return 1;
}

fn jsGetUnitMaxMP(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse { retInt32(argc, vp, 0); return 1; };
    const mp = d2.GetUnitStat.call(player, 9, 0);
    retInt32(argc, vp, @bitCast(mp >> 8));
    return 1;
}

fn jsGetUnitStat(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse { retInt32(argc, vp, 0); return 1; };
    const stat_id: u32 = @bitCast(argInt32(argc, vp, 0));
    const layer: u32 = @bitCast(argInt32(argc, vp, 1));
    const val = d2.GetUnitStat.call(player, stat_id, layer);
    retInt32(argc, vp, @bitCast(val));
    return 1;
}

fn jsInGame(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    retBool(argc, vp, feature.in_game and globals.playerUnit().* != null);
    return 1;
}

fn jsGetDifficulty(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const gi_ptr = globals.gameInfo().*;
    if (gi_ptr) |gi| {
        const diff_ptr: *u32 = @ptrFromInt(@intFromPtr(gi) + 0x5C);
        retInt32(argc, vp, @bitCast(diff_ptr.*));
    } else {
        retInt32(argc, vp, -1);
    }
    return 1;
}

fn jsLog(cx: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    var buf: [1024]u8 = undefined;
    const len = c.sm_arg_string(cx, argc, vp, 0, &buf, buf.len);
    if (len > 0) {
        log.printStr("js: ", buf[0..@intCast(len)]);
    }
    retUndefined(argc, vp);
    return 1;
}

// ── Binding table ───────────────────────────────────────────────────

const Binding = struct {
    name: [*:0]const u8,
    func: engine_mod.NativeFn,
    nargs: c_uint,
};

const bindings = [_]Binding{
    .{ .name = "getArea", .func = &jsGetArea, .nargs = 0 },
    .{ .name = "getAct", .func = &jsGetAct, .nargs = 0 },
    .{ .name = "getUnitX", .func = &jsGetUnitX, .nargs = 0 },
    .{ .name = "getUnitY", .func = &jsGetUnitY, .nargs = 0 },
    .{ .name = "getUnitHP", .func = &jsGetUnitHP, .nargs = 0 },
    .{ .name = "getUnitMaxHP", .func = &jsGetUnitMaxHP, .nargs = 0 },
    .{ .name = "getUnitMP", .func = &jsGetUnitMP, .nargs = 0 },
    .{ .name = "getUnitMaxMP", .func = &jsGetUnitMaxMP, .nargs = 0 },
    .{ .name = "getUnitStat", .func = &jsGetUnitStat, .nargs = 2 },
    .{ .name = "inGame", .func = &jsInGame, .nargs = 0 },
    .{ .name = "getDifficulty", .func = &jsGetDifficulty, .nargs = 0 },
    .{ .name = "log", .func = &jsLog, .nargs = 1 },
};

pub fn registerAll(eng: *Engine, ctx: *anyopaque) bool {
    var ok: usize = 0;
    for (bindings) |b| {
        if (eng.registerNativeFn(ctx, b.name, b.func, b.nargs)) {
            ok += 1;
        } else {
            log.printStr("sm: failed to register: ", std.mem.sliceTo(b.name, 0));
        }
    }
    log.print("sm: native bindings registered");
    return ok == bindings.len;
}
