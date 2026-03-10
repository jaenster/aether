const std = @import("std");
const engine_mod = @import("engine.zig");
const Engine = engine_mod.Engine;
const c = engine_mod.c;
const log = @import("../log.zig");
const d2 = @import("../d2/functions.zig");
const globals = @import("../d2/globals.zig");
const types = @import("../d2/types.zig");
const feature = @import("../feature.zig");

// SM arg/ret helpers — thin wrappers around the C bridge
fn argInt32(vp: ?*anyopaque, idx: c_uint) i32 {
    return c.sm_arg_int32(vp, idx);
}

fn retInt32(vp: ?*anyopaque, val: i32) void {
    c.sm_ret_int32(vp, val);
}

fn retUndefined(vp: ?*anyopaque) void {
    c.sm_ret_undefined(vp);
}

fn retBool(vp: ?*anyopaque, val: bool) void {
    c.sm_ret_bool(vp, if (val) 1 else 0);
}

fn retString(cx: ?*anyopaque, vp: ?*anyopaque, s: []const u8) void {
    c.sm_ret_string(cx, vp, s.ptr, @intCast(s.len));
}

// ── Native binding callbacks ────────────────────────────────────────

/// getArea() → level id of the player's current room, or -1
fn jsGetArea(_: ?*anyopaque, _: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse {
        retInt32(vp, -1);
        return 1;
    };
    const path = player.pPath orelse {
        retInt32(vp, -1);
        return 1;
    };
    const room1 = path.pRoom1 orelse {
        retInt32(vp, -1);
        return 1;
    };
    const room2 = room1.pRoom2 orelse {
        retInt32(vp, -1);
        return 1;
    };
    const level = room2.pLevel orelse {
        retInt32(vp, -1);
        return 1;
    };
    retInt32(vp, @bitCast(level.dwLevelNo));
    return 1;
}

/// getAct() → current act number (0-4)
fn jsGetAct(_: ?*anyopaque, _: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse {
        retInt32(vp, -1);
        return 1;
    };
    retInt32(vp, @bitCast(player.dwAct));
    return 1;
}

/// getUnitX() → player X coordinate
fn jsGetUnitX(_: ?*anyopaque, _: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse {
        retInt32(vp, 0);
        return 1;
    };
    const path = player.pPath orelse {
        retInt32(vp, 0);
        return 1;
    };
    retInt32(vp, @as(i32, path.xPos));
    return 1;
}

/// getUnitY() → player Y coordinate
fn jsGetUnitY(_: ?*anyopaque, _: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse {
        retInt32(vp, 0);
        return 1;
    };
    const path = player.pPath orelse {
        retInt32(vp, 0);
        return 1;
    };
    retInt32(vp, @as(i32, path.yPos));
    return 1;
}

/// getUnitHP() → player current HP (shifted by 8)
fn jsGetUnitHP(_: ?*anyopaque, _: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse {
        retInt32(vp, 0);
        return 1;
    };
    const hp = d2.GetUnitStat.call(player, 6, 0); // stat 6 = hitpoints
    retInt32(vp, @bitCast(hp >> 8));
    return 1;
}

/// getUnitMaxHP() → player max HP (shifted by 8)
fn jsGetUnitMaxHP(_: ?*anyopaque, _: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse {
        retInt32(vp, 0);
        return 1;
    };
    const hp = d2.GetUnitStat.call(player, 7, 0); // stat 7 = maxhp
    retInt32(vp, @bitCast(hp >> 8));
    return 1;
}

/// getUnitMP() → player current mana (shifted by 8)
fn jsGetUnitMP(_: ?*anyopaque, _: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse {
        retInt32(vp, 0);
        return 1;
    };
    const mp = d2.GetUnitStat.call(player, 8, 0); // stat 8 = mana
    retInt32(vp, @bitCast(mp >> 8));
    return 1;
}

/// getUnitMaxMP() → player max mana (shifted by 8)
fn jsGetUnitMaxMP(_: ?*anyopaque, _: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse {
        retInt32(vp, 0);
        return 1;
    };
    const mp = d2.GetUnitStat.call(player, 9, 0); // stat 9 = maxmana
    retInt32(vp, @bitCast(mp >> 8));
    return 1;
}

/// getUnitStat(statId, layer) → raw stat value
fn jsGetUnitStat(_: ?*anyopaque, _: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse {
        retInt32(vp, 0);
        return 1;
    };
    const stat_id: u32 = @bitCast(argInt32(vp, 0));
    const layer: u32 = @bitCast(argInt32(vp, 1));
    const val = d2.GetUnitStat.call(player, stat_id, layer);
    retInt32(vp, @bitCast(val));
    return 1;
}

/// inGame() → true if player unit exists and we're in the game loop
fn jsInGame(_: ?*anyopaque, _: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    retBool(vp, feature.in_game and globals.playerUnit().* != null);
    return 1;
}

/// getDifficulty() → 0=normal, 1=nightmare, 2=hell
fn jsGetDifficulty(_: ?*anyopaque, _: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    // Difficulty is at offset 0x5C in the GameInfo struct
    const gi_ptr = globals.gameInfo().*;
    if (gi_ptr) |gi| {
        const diff_ptr: *u32 = @ptrFromInt(@intFromPtr(gi) + 0x5C);
        retInt32(vp, @bitCast(diff_ptr.*));
    } else {
        retInt32(vp, -1);
    }
    return 1;
}

/// print(msg) → log a message (currently just logs the call, string arg extraction TBD)
fn jsPrint(_: ?*anyopaque, _: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    log.print("js: print() called");
    retUndefined(vp);
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
};

/// Register all native bindings on the given SM context.
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
