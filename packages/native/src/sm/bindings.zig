const std = @import("std");
const engine_mod = @import("engine.zig");
const Engine = engine_mod.Engine;
const c = engine_mod.c;
const log = @import("../log.zig");
const d2 = @import("../d2/functions.zig");
const globals = @import("../d2/globals.zig");
const types = @import("../d2/types.zig");
const feature = @import("../feature.zig");
const units = @import("units.zig");
const walk_reducer = @import("../pathing/walk_reducer.zig");
const teleport_reducer = @import("../pathing/teleport_reducer.zig");
const act_map = @import("../pathing/act_map.zig");

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

fn retString(cx: ?*anyopaque, argc: c_uint, vp: ?*anyopaque, s: []const u8) void {
    c.sm_ret_string(cx, argc, vp, s.ptr, @intCast(s.len));
}

// ── State bindings (existing) ────────────────────────────────────────

fn jsGetArea(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse { retInt32(argc, vp, -1); return 1; };
    const path = player.dynamicPath() orelse { retInt32(argc, vp, -1); return 1; };
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
    const path = player.dynamicPath() orelse { retInt32(argc, vp, 0); return 1; };
    retInt32(argc, vp, @as(i32, path.xPos));
    return 1;
}

fn jsGetUnitY(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse { retInt32(argc, vp, 0); return 1; };
    const path = player.dynamicPath() orelse { retInt32(argc, vp, 0); return 1; };
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

fn jsLogVerbose(cx: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    var buf: [1024]u8 = undefined;
    const len = c.sm_arg_string(cx, argc, vp, 0, &buf, buf.len);
    if (len > 0) {
        log.printStrVerbose("js: ", buf[0..@intCast(len)]);
    }
    retUndefined(argc, vp);
    return 1;
}

fn jsPrintScreen(cx: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const headless = @import("../features/headless.zig");
    if (headless.isHeadless()) {
        retUndefined(argc, vp);
        return 1;
    }

    var buf: [512]u8 = undefined;
    const len = c.sm_arg_string(cx, argc, vp, 0, &buf, buf.len);
    const color: i32 = if (argc >= 2) argInt32(argc, vp, 1) else 0;

    if (len > 0) {
        // Convert ASCII to UTF-16
        var wbuf: [256]u16 = undefined;
        const slen: usize = @intCast(len);
        const wlen = @min(slen, wbuf.len - 1);
        for (0..wlen) |i| {
            wbuf[i] = buf[i];
        }
        wbuf[wlen] = 0;
        const wptr: [*:0]const u16 = @ptrCast(&wbuf);
        d2.PrintGameString.call(.{ wptr, color });
    }
    retUndefined(argc, vp);
    return 1;
}

const DWORD = u32;
extern "kernel32" fn GetTickCount() callconv(.winapi) DWORD;

const win32 = struct {
    extern "kernel32" fn CreateFileA(lpFileName: [*:0]const u8, dwDesiredAccess: u32, dwShareMode: u32, lpSA: ?*anyopaque, dwCreationDisposition: u32, dwFlagsAndAttrs: u32, hTemplate: ?*anyopaque) callconv(.winapi) ?*anyopaque;
    extern "kernel32" fn WriteFile(hFile: *anyopaque, lpBuffer: [*]const u8, nNumberOfBytesToWrite: u32, lpNumberOfBytesWritten: ?*u32, lpOverlapped: ?*anyopaque) callconv(.winapi) i32;
    extern "kernel32" fn ReadFile(hFile: *anyopaque, lpBuffer: [*]u8, nNumberOfBytesToRead: u32, lpNumberOfBytesRead: ?*u32, lpOverlapped: ?*anyopaque) callconv(.winapi) i32;
    extern "kernel32" fn CloseHandle(hObject: *anyopaque) callconv(.winapi) i32;
    extern "kernel32" fn FlushFileBuffers(hFile: *anyopaque) callconv(.winapi) i32;
    extern "kernel32" fn GetLastError() callconv(.winapi) u32;
};

fn jsGetTickCount(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    retInt32(argc, vp, @bitCast(GetTickCount()));
    return 1;
}

// ── Merc bindings ───────────────────────────────────────────────────

/// Returns merc state: -1 = no merc, 0 = dead, >0 = alive (mode)
/// Walks Room1 chains looking for a merc monster owned by the player (d2bs approach)
fn jsGetMercState(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse {
        retInt32(argc, vp, -1);
        return 1;
    };
    const player_id = player.dwUnitId;
    const act = player.pAct orelse {
        retInt32(argc, vp, -1);
        return 1;
    };

    // Merc classids: A1=271, A2=338, A3=359, A5=560
    const merc_ids = [_]u32{ 271, 338, 359, 560 };

    // Walk Room1 chains
    var room1: ?*types.Room1 = act.pRoom1;
    while (room1) |room| : (room1 = room.pRoomNext) {
        var unit: ?*types.UnitAny = room.pUnitFirst;
        while (unit) |u| : (unit = u.pListNext) {
            if (u.dwType == 1) { // monster
                for (merc_ids) |mid| {
                    if (u.dwTxtFileNo == mid) {
                        // Check owner via D2CLIENT_GetMonsterOwner
                        const owner = d2.GetMonsterOwner.call(.{u.dwUnitId});
                        if (owner == player_id) {
                            // Found our merc — mode 12 = dead
                            if (u.dwMode == 12) {
                                retInt32(argc, vp, 0);
                            } else {
                                retInt32(argc, vp, 1);
                            }
                            return 1;
                        }
                    }
                }
            }
        }
    }
    retInt32(argc, vp, -1);
    return 1;
}

// ── Unit iteration bindings ──────────────────────────────────────────

fn jsUnitCount(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const unit_type: u32 = @bitCast(argInt32(argc, vp, 0));
    const count = units.snapshotUnits(unit_type);
    retInt32(argc, vp, @bitCast(count));
    return 1;
}

fn jsUnitAtIndex(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const idx: u32 = @bitCast(argInt32(argc, vp, 0));
    if (units.getSnapshotUnit(idx)) |entry| {
        retInt32(argc, vp, @bitCast(entry.unit_id));
    } else {
        retInt32(argc, vp, -1);
    }
    return 1;
}

fn jsUnitValid(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const unit_type: u32 = @bitCast(argInt32(argc, vp, 0));
    const unit_id: u32 = @bitCast(argInt32(argc, vp, 1));
    retBool(argc, vp, units.findUnit(unit_type, unit_id) != null);
    return 1;
}

// ── Unit property bindings ───────────────────────────────────────────

fn jsUnitGetX(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const unit_type: u32 = @bitCast(argInt32(argc, vp, 0));
    const unit_id: u32 = @bitCast(argInt32(argc, vp, 1));
    const unit = units.findUnit(unit_type, unit_id) orelse { retInt32(argc, vp, 0); return 1; };
    retInt32(argc, vp, unit.getPos().x);
    return 1;
}

fn jsUnitGetY(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const unit_type: u32 = @bitCast(argInt32(argc, vp, 0));
    const unit_id: u32 = @bitCast(argInt32(argc, vp, 1));
    const unit = units.findUnit(unit_type, unit_id) orelse { retInt32(argc, vp, 0); return 1; };
    retInt32(argc, vp, unit.getPos().y);
    return 1;
}

fn jsUnitGetMode(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const unit_type: u32 = @bitCast(argInt32(argc, vp, 0));
    const unit_id: u32 = @bitCast(argInt32(argc, vp, 1));
    const unit = units.findUnit(unit_type, unit_id) orelse { retInt32(argc, vp, 0); return 1; };
    retInt32(argc, vp, @bitCast(unit.dwMode));
    return 1;
}

fn jsUnitGetClassId(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const unit_type: u32 = @bitCast(argInt32(argc, vp, 0));
    const unit_id: u32 = @bitCast(argInt32(argc, vp, 1));
    const unit = units.findUnit(unit_type, unit_id) orelse { retInt32(argc, vp, -1); return 1; };
    retInt32(argc, vp, @bitCast(unit.dwTxtFileNo));
    return 1;
}

fn jsUnitGetStat(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const unit_type: u32 = @bitCast(argInt32(argc, vp, 0));
    const unit_id: u32 = @bitCast(argInt32(argc, vp, 1));
    const stat_id: u32 = @bitCast(argInt32(argc, vp, 2));
    const layer: u32 = @bitCast(argInt32(argc, vp, 3));
    const unit = units.findUnit(unit_type, unit_id) orelse { retInt32(argc, vp, 0); return 1; };
    const val = d2.GetUnitStat.call(unit, stat_id, layer);
    retInt32(argc, vp, @bitCast(val));
    return 1;
}

fn jsUnitGetState(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const unit_type: u32 = @bitCast(argInt32(argc, vp, 0));
    const unit_id: u32 = @bitCast(argInt32(argc, vp, 1));
    const state_no: u32 = @bitCast(argInt32(argc, vp, 2));
    const unit = units.findUnit(unit_type, unit_id) orelse { retBool(argc, vp, false); return 1; };
    const result = d2.GetUnitState.call(unit, state_no);
    retBool(argc, vp, result != 0);
    return 1;
}

fn jsUnitGetArea(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const unit_type: u32 = @bitCast(argInt32(argc, vp, 0));
    const unit_id: u32 = @bitCast(argInt32(argc, vp, 1));
    const unit = units.findUnit(unit_type, unit_id) orelse { retInt32(argc, vp, -1); return 1; };
    const room1 = unit.getRoom1() orelse { retInt32(argc, vp, -1); return 1; };
    const room2 = room1.pRoom2 orelse { retInt32(argc, vp, -1); return 1; };
    const level = room2.pLevel orelse { retInt32(argc, vp, -1); return 1; };
    retInt32(argc, vp, @bitCast(level.dwLevelNo));
    return 1;
}

fn jsUnitGetFlags(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const unit_type: u32 = @bitCast(argInt32(argc, vp, 0));
    const unit_id: u32 = @bitCast(argInt32(argc, vp, 1));
    const unit = units.findUnit(unit_type, unit_id) orelse { retInt32(argc, vp, 0); return 1; };
    retInt32(argc, vp, @bitCast(unit.dwFlags));
    return 1;
}

fn jsUnitGetOwnerId(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const unit_type: u32 = @bitCast(argInt32(argc, vp, 0));
    const unit_id: u32 = @bitCast(argInt32(argc, vp, 1));
    const unit = units.findUnit(unit_type, unit_id) orelse { retInt32(argc, vp, -1); return 1; };
    retInt32(argc, vp, @bitCast(unit.dwOwnerId));
    return 1;
}

fn jsUnitGetOwnerType(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const unit_type: u32 = @bitCast(argInt32(argc, vp, 0));
    const unit_id: u32 = @bitCast(argInt32(argc, vp, 1));
    const unit = units.findUnit(unit_type, unit_id) orelse { retInt32(argc, vp, -1); return 1; };
    retInt32(argc, vp, @bitCast(unit.dwOwnerType));
    return 1;
}

fn jsUnitGetName(cx: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const unit_type: u32 = @bitCast(argInt32(argc, vp, 0));
    const unit_id: u32 = @bitCast(argInt32(argc, vp, 1));
    const unit = units.findUnit(unit_type, unit_id) orelse { retString(cx, argc, vp, ""); return 1; };
    // GetUnitName returns wide string — convert to ascii
    const name_w = d2.GetUnitName.call(.{unit}) orelse { retString(cx, argc, vp, ""); return 1; };
    var buf: [64]u8 = undefined;
    var i: usize = 0;
    while (i < buf.len - 1) {
        const ch = name_w[i];
        if (ch == 0) break;
        buf[i] = if (ch < 128) @intCast(ch) else '?';
        i += 1;
    }
    retString(cx, argc, vp, buf[0..i]);
    return 1;
}

// ── Monster property bindings ────────────────────────────────────────

// HP lookup table per monster level — [normal, nightmare, hell]
// Index = monster level (0-109), value = HP multiplier for that difficulty
const hp_lookup = [111][3]u32{
    .{1,1,1},.{7,107,830},.{9,113,852},.{12,120,875},.{15,125,897},.{17,132,920},
    .{20,139,942},.{23,145,965},.{27,152,987},.{31,157,1010},.{35,164,1032},
    .{36,171,1055},.{40,177,1077},.{44,184,1100},.{48,189,1122},.{52,196,1145},
    .{56,203,1167},.{60,209,1190},.{64,216,1212},.{68,221,1235},.{73,228,1257},
    .{78,236,1280},.{84,243,1302},.{89,248,1325},.{94,255,1347},.{100,261,1370},
    .{106,268,1392},.{113,275,1415},.{120,280,1437},.{126,287,1460},.{134,320,1482},
    .{142,355,1505},.{150,388,1527},.{158,423,1550},.{166,456,1572},.{174,491,1595},
    .{182,525,1617},.{190,559,1640},.{198,593,1662},.{206,627,1685},.{215,661,1707},
    .{225,696,1730},.{234,729,1752},.{243,764,1775},.{253,797,1797},.{262,832,1820},
    .{271,867,1842},.{281,900,1865},.{290,935,1887},.{299,968,1910},.{310,1003,1932},
    .{321,1037,1955},.{331,1071,1977},.{342,1105,2000},.{352,1139,2030},.{363,1173,2075},
    .{374,1208,2135},.{384,1241,2222},.{395,1276,2308},.{406,1309,2394},.{418,1344,2480},
    .{430,1379,2567},.{442,1412,2653},.{454,1447,2739},.{466,1480,2825},.{477,1515,2912},
    .{489,1549,2998},.{501,1583,3084},.{513,1617,3170},.{525,1651,3257},.{539,1685,3343},
    .{552,1720,3429},.{565,1753,3515},.{579,1788,3602},.{592,1821,3688},.{605,1856,3774},
    .{618,1891,3860},.{632,1924,3947},.{645,1959,4033},.{658,1992,4119},.{673,2027,4205},
    .{688,2061,4292},.{702,2095,4378},.{717,2129,4464},.{732,2163,4550},.{746,2197,4637},
    .{761,2232,4723},.{775,2265,4809},.{790,2300,4895},.{805,2333,4982},.{821,2368,5068},
    .{837,2403,5154},.{853,2436,5240},.{868,2471,5327},.{884,2504,5413},.{900,2539,5499},
    .{916,2573,5585},.{932,2607,5672},.{948,2641,5758},.{964,2675,5844},.{982,2709,5930},
    .{999,2744,6017},.{1016,2777,6103},.{1033,2812,6189},.{1051,2845,6275},.{1068,2880,6362},
    .{1085,2915,6448},.{1103,2948,6534},.{1120,2983,6620},.{1137,3016,6707},.{10000,10000,10000},
};

// MonStatsTxt field offsets for HP and Level per difficulty
const MONSTATS_LEVEL_OFF: usize = 0xAA;
const MONSTATS_MAXHP_OFF = [3]usize{ 0xB6, 0xB8, 0xBA };

/// Compute monster max HP: HPLookup[mlvl][diff] * monstats.maxHP[diff] / 100
pub fn computeMonsterMaxHP(class_id: u32, diff: u32) u32 {
    const txt = d2.TxtMonStatsGetLine.call(.{@as(i32, @intCast(class_id))}) orelse return 0;
    const mlvl_raw: i16 = @as(*align(1) const i16, @ptrCast(txt + MONSTATS_LEVEL_OFF)).*;
    const mlvl: usize = @intCast(std.math.clamp(mlvl_raw, 0, 110));
    const d: usize = @intCast(std.math.clamp(diff, 0, 2));
    const hp_base: i16 = @as(*align(1) const i16, @ptrCast(txt + MONSTATS_MAXHP_OFF[d])).*;
    if (hp_base <= 0) return 0;
    return hp_lookup[mlvl][d] * @as(u32, @intCast(hp_base)) / 100;
}

fn jsMonGetMaxHP(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const class_id: u32 = @bitCast(argInt32(argc, vp, 0));
    const gi_ptr = globals.gameInfo().*;
    const diff: u32 = if (gi_ptr) |gi| blk: {
        const diff_ptr: *u32 = @ptrFromInt(@intFromPtr(gi) + 0x5C);
        break :blk diff_ptr.*;
    } else 0;
    retInt32(argc, vp, @bitCast(computeMonsterMaxHP(class_id, diff)));
    return 1;
}

fn jsMonGetSpecType(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const unit_id: u32 = @bitCast(argInt32(argc, vp, 0));
    const unit = units.findUnit(1, unit_id) orelse { retInt32(argc, vp, 0); return 1; };
    const data: *types.MonsterData = @ptrCast(@alignCast(unit.pUnitData orelse { retInt32(argc, vp, 0); return 1; }));
    retInt32(argc, vp, @as(i32, data.type_flags));
    return 1;
}

fn jsMonGetEnchants(cx: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const unit_id: u32 = @bitCast(argInt32(argc, vp, 0));
    const unit = units.findUnit(1, unit_id) orelse { retString(cx, argc, vp, ""); return 1; };
    const data: *types.MonsterData = @ptrCast(@alignCast(unit.pUnitData orelse { retString(cx, argc, vp, ""); return 1; }));
    var buf: [64]u8 = undefined;
    var pos: usize = 0;
    for (data.enchants) |e| {
        if (e == 0) break;
        if (pos > 0) {
            buf[pos] = ',';
            pos += 1;
        }
        // Write number as decimal
        var v: u32 = e;
        var digits: [3]u8 = undefined;
        var di: usize = 3;
        while (di > 0) {
            di -= 1;
            digits[di] = '0' + @as(u8, @intCast(v % 10));
            v /= 10;
            if (v == 0) break;
        }
        const dslice = digits[di..3];
        @memcpy(buf[pos .. pos + dslice.len], dslice);
        pos += dslice.len;
    }
    retString(cx, argc, vp, buf[0..pos]);
    return 1;
}

// ── Item property bindings ───────────────────────────────────────────

fn jsItemGetQuality(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const unit_id: u32 = @bitCast(argInt32(argc, vp, 0));
    const unit = units.findUnit(4, unit_id) orelse { retInt32(argc, vp, 0); return 1; };
    const data: *types.ItemData = @ptrCast(@alignCast(unit.pUnitData orelse { retInt32(argc, vp, 0); return 1; }));
    retInt32(argc, vp, @bitCast(data.dwQuality));
    return 1;
}

fn jsItemGetFlags(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const unit_id: u32 = @bitCast(argInt32(argc, vp, 0));
    const unit = units.findUnit(4, unit_id) orelse { retInt32(argc, vp, 0); return 1; };
    const data: *types.ItemData = @ptrCast(@alignCast(unit.pUnitData orelse { retInt32(argc, vp, 0); return 1; }));
    retInt32(argc, vp, @bitCast(data.dwItemFlags));
    return 1;
}

fn jsItemGetRunewordIndex(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const unit_id: u32 = @bitCast(argInt32(argc, vp, 0));
    const unit = units.findUnit(4, unit_id) orelse { retInt32(argc, vp, 0); return 1; };
    const data: *types.ItemData = @ptrCast(@alignCast(unit.pUnitData orelse { retInt32(argc, vp, 0); return 1; }));
    retInt32(argc, vp, @as(i32, data.wRuneWordIndex));
    return 1;
}

fn jsItemGetLocation(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const unit_id: u32 = @bitCast(argInt32(argc, vp, 0));
    const unit = units.findUnit(4, unit_id) orelse { retInt32(argc, vp, -1); return 1; };
    const data: *types.ItemData = @ptrCast(@alignCast(unit.pUnitData orelse { retInt32(argc, vp, -1); return 1; }));
    // Map to JS location: 0=inv, 1=equipped, 2=belt, 3=cube, 4=stash, 6=vendor
    //
    // item_location (0x45): the inventory page (0=player, 3=cube, 4=stash, 6-7=vendor, 255=none)
    // game_location (0x68): sometimes duplicates page info for container items
    // body_location (0x44): non-zero = equipped body slot
    // node_page (0x69):     0=none, 1=inv grid, 2=belt, 3=bodyloc, 4=swapped
    const page = data.item_location;
    const grid = data.game_location;
    const body = data.body_location;
    const npage = data.node_page;

    // First: check explicit container pages
    const result: i32 = blk: {
        // item_location or game_location == 3 → cube
        if (page == 3 or grid == 3) break :blk 3;
        // item_location or game_location == 4 → stash
        if (page == 4 or grid == 4) break :blk 4;
        // vendor pages
        if (page == 6 or page == 7 or grid == 6 or grid == 7) break :blk 6;

        // Ground items: not in any inventory
        if (data.pOwnerInventory == null) break :blk @as(i32, 5); // ground

        // Player-owned: use body_location and node_page to disambiguate
        if (body != 0) break :blk @as(i32, 1); // equipped (has body slot)
        if (npage == 2) break :blk @as(i32, 2); // belt
        if (npage == 3 or npage == 4) break :blk @as(i32, 1); // bodyloc/swapped = equipped
        // page=0 means INVPAGE_INVENTORY, page=255 means INVPAGE_None
        // Socketed gems/runes have page=255 + npage=1 (they're in parent's inv grid)
        if (page == 0) break :blk @as(i32, 0); // genuinely in inventory grid
        // page=255 with no body/belt = socketed inside another item
        break :blk @as(i32, -1);
    };
    retInt32(argc, vp, result);
    return 1;
}

/// Returns (page << 8) | grid — lets JS inspect both raw fields
fn jsItemGetLocationRaw(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const unit_id: u32 = @bitCast(argInt32(argc, vp, 0));
    const unit = units.findUnit(4, unit_id) orelse { retInt32(argc, vp, -1); return 1; };
    const data: *types.ItemData = @ptrCast(@alignCast(unit.pUnitData orelse { retInt32(argc, vp, -1); return 1; }));
    retInt32(argc, vp, (@as(i32, data.item_location) << 8) | @as(i32, data.game_location));
    return 1;
}

fn jsItemGetCode(cx: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const unit_id: u32 = @bitCast(argInt32(argc, vp, 0));
    const unit = units.findUnit(4, unit_id) orelse { retString(cx, argc, vp, ""); return 1; };
    const txt = d2.GetItemText.call(unit.dwTxtFileNo) orelse { retString(cx, argc, vp, ""); return 1; };
    // szCode is 4 bytes, may not be null-terminated, space-padded
    var len: usize = 0;
    while (len < 4 and txt.szCode[len] != 0) len += 1;
    while (len > 0 and txt.szCode[len - 1] == ' ') len -= 1;
    retString(cx, argc, vp, txt.szCode[0..len]);
    return 1;
}

// ── Tile property bindings ───────────────────────────────────────────

fn jsTileGetDestArea(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const unit_id: u32 = @bitCast(argInt32(argc, vp, 0));
    const unit = units.findUnit(5, unit_id) orelse { retInt32(argc, vp, -1); return 1; };
    const room1 = unit.getRoom1() orelse { retInt32(argc, vp, -1); return 1; };
    const room2 = room1.pRoom2 orelse { retInt32(argc, vp, -1); return 1; };
    // Match unit's warp number (dwTxtFileNo) against RoomTile.nNum to find correct dest
    const warp_no = unit.dwTxtFileNo;
    var tile: ?*types.RoomTile = room2.pRoomTiles;
    while (tile) |t| : (tile = t.pNext) {
        if (t.nNum) |n| {
            if (n.* == warp_no) {
                if (t.pRoom2) |dest_room2| {
                    if (dest_room2.pLevel) |dest_level| {
                        retInt32(argc, vp, @bitCast(dest_level.dwLevelNo));
                        return 1;
                    }
                }
            }
        }
    }
    retInt32(argc, vp, -1);
    return 1;
}

// ── Player bindings ──────────────────────────────────────────────────

fn jsMeGetCharName(cx: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse { retString(cx, argc, vp, ""); return 1; };
    const data: *types.PlayerData = @ptrCast(@alignCast(player.pUnitData orelse { retString(cx, argc, vp, ""); return 1; }));
    var len: usize = 0;
    while (len < 16 and data.szName[len] != 0) len += 1;
    retString(cx, argc, vp, data.szName[0..len]);
    return 1;
}

fn jsMeGetUnitId(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse { retInt32(argc, vp, -1); return 1; };
    retInt32(argc, vp, @bitCast(player.dwUnitId));
    return 1;
}

// ── Action bindings (Step 4) ─────────────────────────────────────────

fn jsClickMap(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const click_type = argInt32(argc, vp, 0);
    const x = argInt32(argc, vp, 2);
    const y = argInt32(argc, vp, 3);
    d2.clickAtWorld(click_type, x, y);
    retUndefined(argc, vp);
    return 1;
}

fn jsMove(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const x = argInt32(argc, vp, 0);
    const y = argInt32(argc, vp, 1);
    // clickType=0 = left click down (proven working via clickScreen test)
    d2.clickAtWorld(0, x, y);
    retUndefined(argc, vp);
    return 1;
}


fn jsSelectSkill(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const hand = argInt32(argc, vp, 0);
    const skill_id: u32 = @bitCast(argInt32(argc, vp, 1));
    const sid: u16 = @intCast(skill_id & 0xFFFF);
    const left = hand != 0;

    // Walk the player's skill list to:
    // 1. Update client-side skill pointer so clickAtWorld uses the correct skill
    //    (only for skills with level > 0 — CTA oskills have level=0 and their
    //    Skill struct becomes invalid after weapon swap back)
    // 2. Find the item owner GUID for the 0x3C packet
    var owner_id: u32 = 0xFFFFFFFF;
    if (globals.playerUnit().*) |player| {
        if (player.pInfo) |info| {
            var skill = info.pFirstSkill;
            while (skill) |s| {
                if (s.pSkillInfo) |si| {
                    if (si.wSkillId == sid) {
                        if (left) {
                            info.pLeftSkill = s;
                        } else {
                            info.pRightSkill = s;
                        }
                        owner_id = s.item_id;
                        break;
                    }
                }
                skill = s.pNextSkill;
            }
        }
    }

    // Send packet 0x3C with correct owner (item GUID for CTA, 0xFFFFFFFF for natural)
    var skill_val: u32 = sid;
    if (left) skill_val |= 0x80000000;
    var buf: [9]u8 = .{ 0x3C, 0, 0, 0, 0, 0, 0, 0, 0 };
    const skill_bytes = @as([4]u8, @bitCast(skill_val));
    buf[1] = skill_bytes[0];
    buf[2] = skill_bytes[1];
    buf[3] = skill_bytes[2];
    buf[4] = skill_bytes[3];
    const owner_bytes = @as([4]u8, @bitCast(owner_id));
    buf[5] = owner_bytes[0];
    buf[6] = owner_bytes[1];
    buf[7] = owner_bytes[2];
    buf[8] = owner_bytes[3];
    d2.sendPacket(&buf);

    retUndefined(argc, vp);
    return 1;
}

fn jsCastSkillAt(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const x = argInt32(argc, vp, 0);
    const y = argInt32(argc, vp, 1);
    // Right-click through client (type 3 = right click down) so animations render
    d2.clickAtWorld(3, x, y);
    retUndefined(argc, vp);
    return 1;
}

fn jsCastSkillPacket(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const x: u16 = @bitCast(@as(i16, @truncate(argInt32(argc, vp, 0))));
    const y: u16 = @bitCast(@as(i16, @truncate(argInt32(argc, vp, 1))));
    // Packet 0x0C: cast right skill at world coords — works off-screen
    d2.sendRightSkillAtLocation(x, y);
    retUndefined(argc, vp);
    return 1;
}

fn jsGetRightSkill(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse {
        retInt32(argc, vp, -1);
        return 1;
    };
    const info = player.pInfo orelse {
        retInt32(argc, vp, -1);
        return 1;
    };
    const rs = info.pRightSkill orelse {
        retInt32(argc, vp, -1);
        return 1;
    };
    const si = rs.pSkillInfo orelse {
        retInt32(argc, vp, -1);
        return 1;
    };
    retInt32(argc, vp, @as(i32, si.wSkillId));
    return 1;
}

fn jsInteract(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const unit_type = argInt32(argc, vp, 0);
    const unit_id = argInt32(argc, vp, 1);
    // Packet 0x13: Entity interaction (dwType, dwId)
    d2.SendIntInt.call(.{ 0x13, unit_type, unit_id });
    retUndefined(argc, vp);
    return 1;
}

fn jsNpcMenuSelect(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const menu_index: u32 = @bitCast(argInt32(argc, vp, 0));

    // Get the currently interacted NPC
    const npc = d2.GetInteractedUnit.call() orelse {
        retBool(argc, vp, false);
        return 1;
    };

    const ok = d2.callNpcMenuOption(npc.dwTxtFileNo, menu_index);
    retBool(argc, vp, ok);
    return 1;
}

fn jsRunToEntity(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const unit_type = argInt32(argc, vp, 0);
    const unit_id = argInt32(argc, vp, 1);
    // Packet 0x04: Run to entity (dwType, dwId)
    d2.SendIntInt.call(.{ 0x04, unit_type, unit_id });
    retUndefined(argc, vp);
    return 1;
}

fn jsGetUIFlag(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const flag: u32 = @bitCast(argInt32(argc, vp, 0));
    retBool(argc, vp, d2.GetUiFlag.call(.{flag}) != 0);
    return 1;
}

fn jsSay(cx: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    var buf: [256]u8 = undefined;
    const len = c.sm_arg_string(cx, argc, vp, 0, &buf, buf.len);
    if (len > 0) {
        // Build say packet: 0x15 + string + null
        var pkt: [258]u8 = undefined;
        pkt[0] = 0x15;
        const slen: usize = @intCast(len);
        @memcpy(pkt[3 .. 3 + slen], buf[0..slen]);
        pkt[3 + slen] = 0;
        pkt[1] = 0x01; // message type
        pkt[2] = 0x00;
        d2.sendPacket(pkt[0 .. 3 + slen + 1]);
    }
    retUndefined(argc, vp);
    return 1;
}

// ── Pathfinding ─────────────────────────────────────────────────────

/// Ensure act_map is initialized for the current level. Called before pathfinding.
fn ensureActMap() void {
    const player = globals.playerUnit().* orelse return;
    const path = player.dynamicPath() orelse return;
    const room1 = path.pRoom1 orelse return;
    const room2 = room1.pRoom2 orelse return;
    const lvl = room2.pLevel orelse return;
    const player_act = player.pAct orelse return;

    // Check if act_map is already initialized for this level
    if (act_map.level) |current| {
        if (current.dwLevelNo == lvl.dwLevelNo) return;
    }

    act_map.cleanup();
    act_map.init(player_act, lvl);
}

/// A* pathfind from current position to (x, y). Returns JSON: [[x,y],[x,y],...]
fn jsFindPath(cx: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse { retString(cx, argc, vp, "[]"); return 1; };
    const ppath = player.dynamicPath() orelse { retString(cx, argc, vp, "[]"); return 1; };
    const sx: i32 = @intCast(ppath.xPos);
    const sy: i32 = @intCast(ppath.yPos);
    const ex = argInt32(argc, vp, 0);
    const ey = argInt32(argc, vp, 1);

    ensureActMap();
    const wp_count = walk_reducer.findPath(sx, sy, ex, ey);
    if (wp_count == 0) { retString(cx, argc, vp, "[]"); return 1; }

    var buf: [8192]u8 = undefined;
    var pos: usize = 0;
    buf[0] = '[';
    pos = 1;
    var i: u32 = 0;
    while (i < wp_count) : (i += 1) {
        const wp = walk_reducer.waypoints[i];
        const written = std.fmt.bufPrint(buf[pos..], "{s}[{d},{d}]", .{
            if (i > 0) @as([]const u8, ",") else @as([]const u8, ""),
            wp.x, wp.y,
        }) catch break;
        pos += written.len;
    }
    buf[pos] = ']';
    pos += 1;
    retString(cx, argc, vp, buf[0..pos]);
    return 1;
}

/// A* pathfind for teleporting from current position to (x, y).
/// Uses teleport_reducer which finds waypoints at teleport range intervals.
/// Returns JSON: [[x,y],[x,y],...]
fn jsFindTelePath(cx: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse { retString(cx, argc, vp, "[]"); return 1; };
    const ppath = player.dynamicPath() orelse { retString(cx, argc, vp, "[]"); return 1; };
    const sx: i32 = @intCast(ppath.xPos);
    const sy: i32 = @intCast(ppath.yPos);
    const ex = argInt32(argc, vp, 0);
    const ey = argInt32(argc, vp, 1);

    ensureActMap();
    const tp_range: u32 = 40;
    const t0 = std.time.milliTimestamp();
    const wp_count = teleport_reducer.findPath(sx, sy, ex, ey, tp_range);
    const dt = std.time.milliTimestamp() - t0;
    var tbuf: [128]u8 = undefined;
    const tmsg = std.fmt.bufPrint(&tbuf, "tele path: {d}ms, {d} wps", .{ dt, wp_count }) catch "?";
    log.printStr("", tmsg);
    if (wp_count == 0) { retString(cx, argc, vp, "[]"); return 1; }

    var buf: [8192]u8 = undefined;
    var pos: usize = 0;
    buf[0] = '[';
    pos = 1;
    var i: u32 = 0;
    while (i < wp_count) : (i += 1) {
        const wp = teleport_reducer.waypoints[i];
        const written = std.fmt.bufPrint(buf[pos..], "{s}[{d},{d}]", .{
            if (i > 0) @as([]const u8, ",") else @as([]const u8, ""),
            wp.x, wp.y,
        }) catch break;
        pos += written.len;
    }
    buf[pos] = ']';
    pos += 1;
    retString(cx, argc, vp, buf[0..pos]);
    return 1;
}

// ── Map/exit bindings ───────────────────────────────────────────────

/// Get level exits using act_map's proper exit detection (presets + linkage).
/// Returns comma-separated "area:x:y" entries.
fn jsGetExits(cx: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    ensureActMap();

    var exits: [32]act_map.Exit = undefined;
    const exit_count = act_map.getExits(&exits);
    if (exit_count == 0) { retString(cx, argc, vp, ""); return 1; }

    var buf: [512]u8 = undefined;
    var pos: usize = 0;
    var i: u32 = 0;
    while (i < exit_count) : (i += 1) {
        if (pos > 0 and pos < buf.len) {
            buf[pos] = ',';
            pos += 1;
        }
        const written = std.fmt.bufPrint(buf[pos..], "{d}:{d}:{d}", .{
            exits[i].target, exits[i].x, exits[i].y,
        }) catch break;
        pos += written.len;
    }

    retString(cx, argc, vp, buf[0..pos]);
    return 1;
}

// ── Preset search ───────────────────────────────────────────────────

/// findPreset(unitType, classid) -> "x:y" or ""
/// Walks Room2 preset units in the current level to find a matching preset.
fn jsFindPreset(cx: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const preset_type: u32 = @bitCast(argInt32(argc, vp, 0));
    const classid: u32 = @bitCast(argInt32(argc, vp, 1));

    const player = globals.playerUnit().* orelse { retString(cx, argc, vp, ""); return 1; };
    const path = player.dynamicPath() orelse { retString(cx, argc, vp, ""); return 1; };
    const room1 = path.pRoom1 orelse { retString(cx, argc, vp, ""); return 1; };
    const room2 = room1.pRoom2 orelse { retString(cx, argc, vp, ""); return 1; };
    const level = room2.pLevel orelse { retString(cx, argc, vp, ""); return 1; };

    // Walk all Room2s in this level
    var r2 = level.pRoom2First;
    while (r2) |room| : (r2 = room.pRoom2Next) {
        var preset = room.pPreset;
        while (preset) |unit| : (preset = unit.pPresetNext) {
            if (unit.dwType == preset_type and unit.dwTxtFileNo == classid) {
                const wx = unit.dwPosX + room.dwPosX * 5;
                const wy = unit.dwPosY + room.dwPosY * 5;
                var buf: [32]u8 = undefined;
                const result = std.fmt.bufPrint(&buf, "{d}:{d}", .{ wx, wy }) catch { retString(cx, argc, vp, ""); return 1; };
                retString(cx, argc, vp, result);
                return 1;
            }
        }
    }

    retString(cx, argc, vp, "");
    return 1;
}

// ── Skill level ─────────────────────────────────────────────────────

/// getSkillLevel(skillId: i32, mode: i32) -> i32
/// mode 0 = base (hard points via stat 107), mode 1 = effective (with +skills)
fn jsGetSkillLevel(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const skill_id = argInt32(argc, vp, 0);
    const mode = argInt32(argc, vp, 1);

    const player = globals.playerUnit().* orelse { retInt32(argc, vp, 0); return 1; };

    if (mode == 0) {
        // Base level = hard skill points (stat 107, layer = skillId)
        const val = d2.GetUnitStat.call(player, 107, @bitCast(skill_id));
        retInt32(argc, vp, @bitCast(val));
    } else {
        // Effective level via GetSkillLevelById (fastcall, includes +skills)
        const val = d2.GetSkillLevelById.call(.{ player, skill_id });
        retInt32(argc, vp, val);
    }
    return 1;
}

// ── Locale strings ──────────────────────────────────────────────────

/// getLocaleString(index: i32) -> string
/// Returns the D2 locale string for the given string table index.
fn jsGetLocaleString(cx: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const index: u16 = @intCast(@as(u32, @bitCast(argInt32(argc, vp, 0))));
    const name_w = d2.GetLocaleString.call(.{index}) orelse { retString(cx, argc, vp, ""); return 1; };
    var buf: [256]u8 = undefined;
    var i: usize = 0;
    while (i < buf.len - 1) {
        const ch = name_w[i];
        if (ch == 0) break;
        buf[i] = if (ch < 128) @intCast(ch) else '?';
        i += 1;
    }
    retString(cx, argc, vp, buf[0..i]);
    return 1;
}

// ── Txt record field access ─────────────────────────────────────────

/// txtReadField(table: i32, recordId: i32, offset: i32, size: i32) -> i32
/// table: 0=monstats, 1=skills, 2=levels, 3=missiles
/// Reads `size` bytes (1/2/4) at `offset` from the txt record, sign-extended.
/// Shared table lookup: resolves table ID + record ID to a raw byte pointer.
/// Table IDs: 0=monstats, 1=skills, 2=levels, 3=missiles, 4=items, 5=monstats2,
/// 6=states, 7=itemstatcost, 8=charstats, 9=objects, 10=superuniques,
/// 11=experience, 12=difficultylevels, 13=uniqueitems, 14=setitems,
/// 15=itemtypes, 16=properties, 17=overlay, 18=shrines, 19=qualityitems,
/// 20=magicaffixes, 21=npc, 22=levelDefs, 23=lvlPrest
fn txtLookup(table: i32, record_id: i32) ?[*]u8 {
    return switch (table) {
        0 => d2.TxtMonStatsGetLine.call(.{record_id}),
        1 => d2.TxtSkillsGetLine.call(.{record_id}),
        2 => d2.TxtLevelsGetLine.call(@as(u32, @bitCast(record_id))),
        3 => globals.txtMissilesGetLine(record_id),
        4 => d2.TxtItemsGetLine.call(@as(u32, @bitCast(record_id))),
        5 => d2.TxtMonStats2GetLine.call(.{record_id}),
        6 => d2.TxtStatesGetLine.call(.{record_id}),
        7 => d2.TxtItemStatCostGetLine.call(.{record_id}),
        8 => d2.TxtCharStatsGetLine.call(.{record_id}),
        9 => d2.TxtObjectsGetLine.call(@as(u32, @bitCast(record_id))),
        10 => d2.TxtSuperUniquesGetLine.call(@as(u32, @bitCast(record_id))),
        11 => globals.txtExperienceGetLine(record_id),
        12 => d2.TxtDifficultyLevelsGetLine.call(@as(u32, @bitCast(record_id))),
        13 => globals.txtUniqueItemsGetLine(record_id),
        14 => globals.txtSetItemsGetLine(record_id),
        15 => globals.txtItemTypesGetLine(record_id),
        16 => globals.txtPropertiesGetLine(record_id),
        17 => globals.txtOverlayGetLine(record_id),
        18 => d2.TxtShrinesGetLine.call(@as(u32, @bitCast(record_id))),
        19 => d2.TxtQualityItemsGetLine.call(@as(u32, @bitCast(record_id))),
        20 => d2.TxtMagicAffixesGetLine.call(@as(u32, @bitCast(record_id))),
        21 => d2.TxtNpcGetLine.call(@as(u32, @bitCast(record_id))),
        22 => d2.TxtLevelDefsGetLine.call(@as(u32, @bitCast(record_id))),
        23 => d2.TxtLvlPrestGetLine.call(@as(u32, @bitCast(record_id))),
        else => null,
    };
}

fn jsTxtReadField(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const table = argInt32(argc, vp, 0);
    const record_id = argInt32(argc, vp, 1);
    const offset: u32 = @bitCast(argInt32(argc, vp, 2));
    const size = argInt32(argc, vp, 3);

    const record_ptr = txtLookup(table, record_id);
    if (record_ptr == null) {
        retInt32(argc, vp, 0);
        return 1;
    }

    const ptr = record_ptr.? + offset;
    const val: i32 = switch (size) {
        1 => @as(i32, @as(i8, @bitCast(ptr[0]))),
        2 => @as(i32, @as(i16, @bitCast(ptr[0..2].*))),
        4 => @as(i32, @bitCast(ptr[0..4].*)),
        else => 0,
    };

    retInt32(argc, vp, val);
    return 1;
}

/// txtReadFieldU(table: i32, recordId: i32, offset: i32, size: i32) -> i32
/// Same but zero-extends (unsigned).
fn jsTxtReadFieldU(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const table = argInt32(argc, vp, 0);
    const record_id = argInt32(argc, vp, 1);
    const offset: u32 = @bitCast(argInt32(argc, vp, 2));
    const size = argInt32(argc, vp, 3);

    const record_ptr = txtLookup(table, record_id);
    if (record_ptr == null) {
        retInt32(argc, vp, 0);
        return 1;
    }

    const ptr = record_ptr.? + offset;
    const val: i32 = switch (size) {
        1 => @as(i32, @as(u8, ptr[0])),
        2 => @as(i32, @as(u16, @bitCast(ptr[0..2].*))),
        4 => @as(i32, @bitCast(ptr[0..4].*)),
        else => 0,
    };

    retInt32(argc, vp, val);
    return 1;
}

// ── Game control ────────────────────────────────────────────────────

fn jsCloseNPCInteract(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    d2.CloseNPCInteract.call(.{});
    retUndefined(argc, vp);
    return 1;
}

fn jsExitGame(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    log.print("js: exitGame — leaving game gracefully");
    d2.ExitGame.call(.{0});
    retUndefined(argc, vp);
    return 1;
}

extern "kernel32" fn TerminateProcess(hProcess: ?*anyopaque, uExitCode: u32) callconv(.winapi) i32;
extern "kernel32" fn GetCurrentProcess() callconv(.winapi) ?*anyopaque;

fn jsExitClient(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    _ = argc;
    _ = vp;
    log.print("js: exitClient — terminating process");
    _ = TerminateProcess(GetCurrentProcess(), 0);
    return 1;
}

fn jsSendPacket(cx: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    var data_ptr: [*c]const u8 = null;
    const len = c.sm_arg_uint8array(cx, argc, vp, 0, &data_ptr);
    if (len > 0 and data_ptr != null) {
        const ptr: [*]const u8 = @ptrCast(data_ptr);
        d2.sendPacket(ptr[0..@intCast(len)]);
    }
    retUndefined(argc, vp);
    return 1;
}

fn jsTakeWaypoint(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const wp_id: u32 = @bitCast(argInt32(argc, vp, 0));
    const dest_area: u32 = @bitCast(argInt32(argc, vp, 1));
    log.print("js: takeWaypoint");
    d2.takeWaypoint(wp_id, dest_area);
    retUndefined(argc, vp);
    return 1;
}

// ── Packet hooks ────────────────────────────────────────────────────

const packet_hooks = @import("../features/packet_hooks.zig");

/// Register JS interest in an S2C packet opcode. JS __onPacket(opcode) will be called.
fn jsRegisterPacketHook(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const opcode = argInt32(argc, vp, 0);
    if (opcode >= 0 and opcode < 175) {
        packet_hooks.registerOpcode(@intCast(@as(u32, @bitCast(opcode))));
    }
    retUndefined(argc, vp);
    return 1;
}

/// Get current packet data as a copy. Only valid inside __onPacket callback.
/// Returns the raw packet bytes (including opcode at [0]) via Uint8Array.
fn jsGetPacketData(cx: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const ptr = packet_hooks.current_packet_ptr;
    const len = packet_hooks.current_packet_len;
    if (ptr != null and len > 0) {
        c.sm_ret_uint8array(cx, argc, vp, @ptrCast(ptr.?), @intCast(len));
    } else {
        retUndefined(argc, vp);
    }
    return 1;
}

/// Get current packet size. Only valid inside __onPacket callback.
fn jsGetPacketSize(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    retInt32(argc, vp, @intCast(packet_hooks.current_packet_len));
    return 1;
}

/// Inject a fake S2C packet — calls the original handler as if the server sent it.
fn jsInjectPacket(cx: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    var data_ptr: [*c]const u8 = null;
    const len = c.sm_arg_uint8array(cx, argc, vp, 0, &data_ptr);
    if (len > 0 and data_ptr != null) {
        const ptr: [*]const u8 = @ptrCast(data_ptr);
        packet_hooks.injectPacket(ptr, @intCast(len));
    }
    retUndefined(argc, vp);
    return 1;
}

// ── Collision ───────────────────────────────────────────────────────

/// getCollision(x, y) → collision flags at (x,y), 0 = free
fn jsGetCollision(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const x = argInt32(argc, vp, 0);
    const y = argInt32(argc, vp, 1);
    const player = globals.playerUnit().* orelse { retInt32(argc, vp, -1); return 1; };
    const path = player.dynamicPath() orelse { retInt32(argc, vp, -1); return 1; };
    const room1 = path.pRoom1 orelse { retInt32(argc, vp, -1); return 1; };
    const target_room = d2.FindBetterNearbyRoom.call(.{ room1, x, y }) orelse {
        retInt32(argc, vp, -1);
        return 1;
    };
    // Read collision directly from the room's collision map (safe, no D2 function call)
    const pColl = target_room.pColl orelse {
        retInt32(argc, vp, -1);
        return 1;
    };
    const cx = x - @as(i32, @bitCast(pColl.dwPosGameX));
    const cy = y - @as(i32, @bitCast(pColl.dwPosGameY));
    const sx: i32 = @bitCast(pColl.dwSizeGameX);
    const sy: i32 = @bitCast(pColl.dwSizeGameY);
    if (cx < 0 or cy < 0 or cx >= sx or cy >= sy) {
        retInt32(argc, vp, -1);
        return 1;
    }
    const map = pColl.pMapStart orelse {
        retInt32(argc, vp, -1);
        return 1;
    };
    const idx: usize = @intCast(cy * sx + cx);
    retInt32(argc, vp, @as(i32, map[idx]));
    return 1;
}

/// getMapSeed() → the act's map seed (u32)
fn jsGetMapSeed(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse { retInt32(argc, vp, 0); return 1; };
    const act = player.pAct orelse { retInt32(argc, vp, 0); return 1; };
    retInt32(argc, vp, @bitCast(act.dwMapSeed));
    return 1;
}

/// getRoomSeed(x, y) → [seedLow, seedHigh] of the room at (x,y), as a single i64-packed i32
/// Returns two values via string "low:high" so JS can parse both 32-bit values.
fn jsGetRoomSeed(cx_ptr: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const x = argInt32(argc, vp, 0);
    const y = argInt32(argc, vp, 1);
    const player = globals.playerUnit().* orelse { retString(cx_ptr, argc, vp, ""); return 1; };
    const path = player.dynamicPath() orelse { retString(cx_ptr, argc, vp, ""); return 1; };
    const room1 = path.pRoom1 orelse { retString(cx_ptr, argc, vp, ""); return 1; };
    const target_room = d2.FindBetterNearbyRoom.call(.{ room1, x, y }) orelse {
        retString(cx_ptr, argc, vp, "");
        return 1;
    };
    // Room1 seed at offset 0x6C: D2SeedStrc { nSeedLow: u32, nSeedHigh: u32 }
    const seed_ptr: *const [2]u32 = @ptrCast(@alignCast(@as([*]const u8, @ptrCast(target_room)) + 0x6C));
    var buf: [32]u8 = undefined;
    var pos: usize = 0;
    // Write seedLow as decimal
    var v: u32 = seed_ptr[0];
    var digits: [10]u8 = undefined;
    var dlen: usize = 0;
    if (v == 0) { digits[0] = '0'; dlen = 1; } else {
        while (v > 0) : (dlen += 1) { digits[dlen] = @intCast('0' + (v % 10)); v /= 10; }
    }
    var i: usize = dlen;
    while (i > 0) { i -= 1; buf[pos] = digits[i]; pos += 1; }
    buf[pos] = ':'; pos += 1;
    // Write seedHigh as decimal
    v = seed_ptr[1];
    dlen = 0;
    if (v == 0) { digits[0] = '0'; dlen = 1; } else {
        while (v > 0) : (dlen += 1) { digits[dlen] = @intCast('0' + (v % 10)); v /= 10; }
    }
    i = dlen;
    while (i > 0) { i -= 1; buf[pos] = digits[i]; pos += 1; }
    retString(cx_ptr, argc, vp, buf[0..pos]);
    return 1;
}

/// getRooms() → "x,y,w,h;x,y,w,h;..." for all Room1s in the current act
fn jsGetRooms(cx_ptr: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse { retString(cx_ptr, argc, vp, ""); return 1; };
    const act = player.pAct orelse { retString(cx_ptr, argc, vp, ""); return 1; };

    // Max ~200 rooms, each "x,y,w,h;" is at most 30 chars → 6000 bytes
    var buf: [8192]u8 = undefined;
    var pos: usize = 0;
    var room1: ?*types.Room1 = act.pRoom1;
    while (room1) |room| : (room1 = room.pRoomNext) {
        const coll = room.pColl orelse continue;
        // Write "x,y,w,h;"
        const vals = [4]u32{ coll.dwPosGameX, coll.dwPosGameY, coll.dwSizeGameX, coll.dwSizeGameY };
        for (vals, 0..) |v, vi| {
            if (vi > 0) { buf[pos] = ','; pos += 1; }
            pos += writeDecimal(buf[pos..], v);
        }
        buf[pos] = ';';
        pos += 1;
        if (pos > buf.len - 40) break;
    }
    retString(cx_ptr, argc, vp, buf[0..pos]);
    return 1;
}

fn writeDecimal(buf: []u8, val: u32) usize {
    if (val == 0) { buf[0] = '0'; return 1; }
    var v = val;
    var digits: [10]u8 = undefined;
    var dlen: usize = 0;
    while (v > 0) : (dlen += 1) {
        digits[dlen] = @intCast('0' + (v % 10));
        v /= 10;
    }
    var i: usize = dlen;
    var pos: usize = 0;
    while (i > 0) {
        i -= 1;
        buf[pos] = digits[i];
        pos += 1;
    }
    return pos;
}

/// getCollisionRect(x, y, w, h) → packed collision data as string of hex nibbles
/// Each tile is one WORD, encoded as 4 hex chars. Tiles in row-major order.
/// Max 80x80 = 6400 tiles = 25600 hex chars.
fn jsGetCollisionRect(cx_ptr: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const rx = argInt32(argc, vp, 0);
    const ry = argInt32(argc, vp, 1);
    const rw: u32 = @intCast(@max(1, @min(80, argInt32(argc, vp, 2))));
    const rh: u32 = @intCast(@max(1, @min(80, argInt32(argc, vp, 3))));
    const player = globals.playerUnit().* orelse { retString(cx_ptr, argc, vp, ""); return 1; };
    const path = player.dynamicPath() orelse { retString(cx_ptr, argc, vp, ""); return 1; };
    const base_room = path.pRoom1 orelse { retString(cx_ptr, argc, vp, ""); return 1; };

    const hex = "0123456789abcdef";
    // 4 hex chars per tile, max 80*80 = 25600
    var buf: [25600]u8 = undefined;
    var pos: usize = 0;

    var dy: u32 = 0;
    while (dy < rh) : (dy += 1) {
        var dx: u32 = 0;
        while (dx < rw) : (dx += 1) {
            const tx = rx + @as(i32, @intCast(dx));
            const ty = ry + @as(i32, @intCast(dy));
            var val: u16 = 0xFFFF; // default: blocked
            if (d2.FindBetterNearbyRoom.call(.{ base_room, tx, ty })) |room| {
                if (room.pColl) |coll| {
                    const cx = tx - @as(i32, @bitCast(coll.dwPosGameX));
                    const cy = ty - @as(i32, @bitCast(coll.dwPosGameY));
                    const sx: i32 = @bitCast(coll.dwSizeGameX);
                    const sy: i32 = @bitCast(coll.dwSizeGameY);
                    if (cx >= 0 and cy >= 0 and cx < sx and cy < sy) {
                        if (coll.pMapStart) |map| {
                            val = map[@intCast(cy * sx + cx)];
                        }
                    }
                }
            }
            buf[pos] = hex[(val >> 12) & 0xF];
            buf[pos + 1] = hex[(val >> 8) & 0xF];
            buf[pos + 2] = hex[(val >> 4) & 0xF];
            buf[pos + 3] = hex[val & 0xF];
            pos += 4;
        }
    }
    retString(cx_ptr, argc, vp, buf[0..pos]);
    return 1;
}

/// hasLineOfSight(x1, y1, x2, y2) → true if no wall/object blocks the path
fn jsHasLineOfSight(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const x1 = argInt32(argc, vp, 0);
    const y1 = argInt32(argc, vp, 1);
    const x2 = argInt32(argc, vp, 2);
    const y2 = argInt32(argc, vp, 3);
    const player = globals.playerUnit().* orelse { retInt32(argc, vp, 0); return 1; };
    const path = player.dynamicPath() orelse { retInt32(argc, vp, 0); return 1; };
    const room1 = path.pRoom1 orelse { retInt32(argc, vp, 0); return 1; };
    // Find the room at the target position for the raycast
    const target_room = d2.FindBetterNearbyRoom.call(.{ room1, x2, y2 }) orelse {
        retInt32(argc, vp, 0);
        return 1;
    };
    // Mask 0xC04 = missile-blocking walls (0x4) + objects (0x400) + doors (0x800)
    // NOT 0x01 (block walk) — missiles fly over lava/gaps
    const clear = d2.HasLineOfSight.call(x1, y1, x2, y2, target_room, 0xC04);
    retInt32(argc, vp, if (clear) 1 else 0);
    return 1;
}

// ── Quest / Waypoint / Player type bindings ─────────────────────────

/// getQuest(questId, subId) → 1 if quest bit set, 0 otherwise
/// Reads from PlayerData quest buffers indexed by current difficulty.
fn jsGetQuest(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const quest_id: u32 = @bitCast(argInt32(argc, vp, 0));
    const sub_id: u32 = @bitCast(argInt32(argc, vp, 1));
    const player = globals.playerUnit().* orelse { retInt32(argc, vp, 0); return 1; };
    const pdata: *types.PlayerData = @ptrCast(@alignCast(player.pUnitData orelse { retInt32(argc, vp, 0); return 1; }));
    // Select quest buffer by difficulty
    const gi_ptr = globals.gameInfo().*;
    const diff: u32 = if (gi_ptr) |gi| blk: {
        const diff_ptr: *u32 = @ptrFromInt(@intFromPtr(gi) + 0x5C);
        break :blk diff_ptr.*;
    } else 0;
    const quest_buf: ?*anyopaque = switch (diff) {
        0 => pdata.pNormalQuest,
        1 => pdata.pNightmareQuest,
        2 => pdata.pHellQuest,
        else => pdata.pNormalQuest,
    };
    if (quest_buf == null) { retInt32(argc, vp, 0); return 1; }
    const result = d2.GetQuestState.call(.{ quest_buf, quest_id, sub_id });
    retInt32(argc, vp, result);
    return 1;
}

/// hasWaypoint(wpIndex) → true if waypoint is activated
/// Reads from PlayerData waypoint buffers, which are bitfields.
fn jsHasWaypoint(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const wp_index: u32 = @bitCast(argInt32(argc, vp, 0));
    const player = globals.playerUnit().* orelse { retBool(argc, vp, false); return 1; };
    const pdata: *types.PlayerData = @ptrCast(@alignCast(player.pUnitData orelse { retBool(argc, vp, false); return 1; }));
    // Select waypoint buffer by difficulty
    const gi_ptr = globals.gameInfo().*;
    const diff: u32 = if (gi_ptr) |gi| blk: {
        const diff_ptr: *u32 = @ptrFromInt(@intFromPtr(gi) + 0x5C);
        break :blk diff_ptr.*;
    } else 0;
    const wp_buf: ?*anyopaque = switch (diff) {
        0 => pdata.pNormalWaypoint,
        1 => pdata.pNightmareWaypoint,
        2 => pdata.pHellWaypoint,
        else => pdata.pNormalWaypoint,
    };
    const buf_ptr = wp_buf orelse { retBool(argc, vp, false); return 1; };
    // Waypoint buffer is a bitfield — each waypoint is one bit
    // The buffer starts with a 2-byte header, then the bitfield
    const bytes: [*]const u8 = @ptrCast(buf_ptr);
    const byte_idx = wp_index / 8;
    const bit_idx: u3 = @intCast(wp_index % 8);
    // Offset 2 bytes past start (standard D2 waypoint buffer layout)
    const val = bytes[2 + byte_idx];
    retBool(argc, vp, (val >> bit_idx) & 1 == 1);
    return 1;
}

/// meGetClassId() → player class (0=ama, 1=sor, 2=nec, 3=pal, 4=bar, 5=dru, 6=ass)
fn jsMeGetClassId(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse { retInt32(argc, vp, -1); return 1; };
    retInt32(argc, vp, @bitCast(player.dwTxtFileNo));
    return 1;
}

/// meGetGameType() → 0=classic, 1=expansion
fn jsMeGetGameType(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse { retInt32(argc, vp, 0); return 1; };
    const pdata: *types.PlayerData = @ptrCast(@alignCast(player.pUnitData orelse { retInt32(argc, vp, 0); return 1; }));
    // PlayerData + 0x28 contains the player status flags
    const status_ptr: *const types.PlayerStatus = @ptrCast(@alignCast(@as([*]const u8, @ptrCast(pdata)) + 0x28));
    retInt32(argc, vp, if (status_ptr.expansion) @as(i32, 1) else @as(i32, 0));
    return 1;
}

/// meGetPlayerType() → 0=softcore, 1=hardcore
fn jsMeGetPlayerType(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse { retInt32(argc, vp, 0); return 1; };
    const pdata: *types.PlayerData = @ptrCast(@alignCast(player.pUnitData orelse { retInt32(argc, vp, 0); return 1; }));
    const status_ptr: *const types.PlayerStatus = @ptrCast(@alignCast(@as([*]const u8, @ptrCast(pdata)) + 0x28));
    retInt32(argc, vp, if (status_ptr.hardcore) @as(i32, 1) else @as(i32, 0));
    return 1;
}

/// clickItem(mode, unitId) → send item click packet
/// Modes: 0=use (right-click), 1=equip/unequip, 2=move to belt, etc.
fn jsClickItem(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const mode: u32 = @bitCast(argInt32(argc, vp, 0));
    const unit_id: u32 = @bitCast(argInt32(argc, vp, 1));
    // Packet 0x20: PickupBufferItem — pickup from inventory/stash/cube to cursor
    // Packet 0x1A: DropItem — drop from cursor to ground
    // Packet 0x16: PickupGroundItem
    // For general item actions, packet 0x20 is the standard pick-to-cursor:
    // [0x20, u32:unitId]
    // For use-item, packet 0x26: [0x26, u32:unitId, u32:posX, u32:posY]
    switch (mode) {
        0 => {
            // Use item (right-click in inventory) — packet 0x26
            var buf: [13]u8 = undefined;
            buf[0] = 0x26;
            @as(*align(1) u32, @ptrCast(buf[1..5])).* = unit_id;
            @as(*align(1) u32, @ptrCast(buf[5..9])).* = 0; // posX
            @as(*align(1) u32, @ptrCast(buf[9..13])).* = 0; // posY
            d2.sendPacket(&buf);
        },
        1 => {
            // Pick to cursor from buffer — packet 0x20
            var buf: [5]u8 = undefined;
            buf[0] = 0x20;
            @as(*align(1) u32, @ptrCast(buf[1..5])).* = unit_id;
            d2.sendPacket(&buf);
        },
        2 => {
            // Pick from ground — packet 0x16
            var buf: [13]u8 = undefined;
            buf[0] = 0x16;
            @as(*align(1) u32, @ptrCast(buf[1..5])).* = 4; // unit type = item
            @as(*align(1) u32, @ptrCast(buf[5..9])).* = unit_id;
            @as(*align(1) u32, @ptrCast(buf[9..13])).* = 0; // action
            d2.sendPacket(&buf);
        },
        3 => {
            // Drop from cursor — packet 0x17
            var buf: [5]u8 = undefined;
            buf[0] = 0x17;
            @as(*align(1) u32, @ptrCast(buf[1..5])).* = unit_id;
            d2.sendPacket(&buf);
        },
        else => {},
    }
    retUndefined(argc, vp);
    return 1;
}

/// getInteractedNPC() → unitId of currently interacted NPC, or -1
fn jsGetInteractedNPC(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const npc = d2.GetInteractedUnit.call() orelse {
        retInt32(argc, vp, -1);
        return 1;
    };
    retInt32(argc, vp, @bitCast(npc.dwUnitId));
    return 1;
}

/// meGetLevel() → player character level
fn jsMeGetLevel(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse { retInt32(argc, vp, 0); return 1; };
    const lvl = d2.GetUnitStat.call(player, 12, 0); // stat 12 = level
    retInt32(argc, vp, @bitCast(lvl));
    return 1;
}

/// meGetGold() → gold on person
fn jsMeGetGold(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse { retInt32(argc, vp, 0); return 1; };
    const gold = d2.GetUnitStat.call(player, 14, 0); // stat 14 = gold
    retInt32(argc, vp, @bitCast(gold));
    return 1;
}

/// meGetGoldStash() → gold in stash
fn jsMeGetGoldStash(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const player = globals.playerUnit().* orelse { retInt32(argc, vp, 0); return 1; };
    const gold = d2.GetUnitStat.call(player, 15, 0); // stat 15 = goldbank
    retInt32(argc, vp, @bitCast(gold));
    return 1;
}

// ── OOG Control System ──────────────────────────────────────────────
//
// Exposes the D2 forms/control linked list to JS for full OOG introspection.
// Controls are UI widgets (buttons, editboxes, textboxes, lists, etc.) that
// the game creates on each OOG screen. JS can enumerate them, read their
// properties, get/set text, and invoke click callbacks.
//
// D2ControlStrc layout (64 bytes):
//   0x00 eD2FormType  (1=EditBox, 2=Image, 3=AnimImage, 4=TextBox, 5=Scrollbar,
//                      6=Button, 7=List, 8=Timer, 9=Smack, 10=ProgressBar,
//                      11=Popup, 12=AccountList, 13=ImageEx)
//   0x08 dwState      (visibility/enabled flags)
//   0x0C dwPosX
//   0x10 dwPosY
//   0x14 dwSizeX
//   0x18 dwSizeY
//   0x24 fpPush       (click callback)
//   0x34 fpOnPress    (press callback)
//   0x3C pNext        (linked list next)
//
// Subtypes extend this:
//   D2WinEditBox (644 bytes): wszText at offset 0x5C (254 WCHAR)
//   D2WinButton  (628 bytes): wszLabel at offset 0x64 (256 WCHAR)
//   D2WinTextBox (172 bytes): text in dynamic line storage
//
// pFormsList global: 0x007D55BC

const FORMS_LIST: *?*anyopaque = @ptrFromInt(0x007D55BC);

const D2Control = extern struct {
    eD2FormType: i32,    // 0x00
    pDC6: ?*anyopaque,   // 0x04
    dwState: i32,        // 0x08
    dwPosX: i32,         // 0x0C
    dwPosY: i32,         // 0x10
    dwSizeX: i32,        // 0x14
    dwSizeY: i32,        // 0x18
    fpDraw: ?*anyopaque, // 0x1C
    fpDrawEx: ?*anyopaque, // 0x20
    fpPush: ?*anyopaque, // 0x24
    fpMouse: ?*anyopaque, // 0x28
    fpListCheck: ?*anyopaque, // 0x2C
    fpKey: ?*anyopaque,  // 0x30
    fpOnPress: ?*anyopaque, // 0x34
    fpDrawAnim: ?*anyopaque, // 0x38
    pNext: ?*D2Control,  // 0x3C
};

// ── Deferred OOG actions ────────────────────────────────────────────
// Some actions (like clicking OK to create a char) need to run from the game's
// normal oogLoop context rather than from inside a JS native binding callback.
// The binding sets the pending action, and scripting.zig's oogLoop calls
// processPendingOogAction() each frame.

const OogAction = enum { none, click_ok };
var pending_oog_action: OogAction = .none;

pub fn processPendingOogAction() void {
    const action = pending_oog_action;
    pending_oog_action = .none;

    switch (action) {
        .click_ok => {
            // Click the create-char OK button through the forms dispatch
            const ok_btn_ptr: *?*D2Control = @ptrFromInt(0x007795CC);
            if (ok_btn_ptr.*) |ok_btn| {
                const cx_coord = ok_btn.dwPosX + @divTrunc(ok_btn.dwSizeX, 2);
                const cy_coord = ok_btn.dwPosY - @divTrunc(ok_btn.dwSizeY, 2);
                simulateOogClick(cx_coord, cy_coord);
                log.print("oog: deferred OK click executed");
            } else {
                log.print("oog: deferred OK click — button not found");
            }
        },
        .none => {},
    }
}

// Snapshot buffer — walk the list once, store up to 128 control pointers
const MAX_CONTROLS = 128;
var ctrl_snapshot: [MAX_CONTROLS]*D2Control = undefined;
var ctrl_count: u32 = 0;

fn snapshotControls() void {
    ctrl_count = 0;
    var cur: ?*D2Control = @ptrCast(@alignCast(FORMS_LIST.*));
    while (cur) |ctrl| {
        if (ctrl_count >= MAX_CONTROLS) break;
        ctrl_snapshot[ctrl_count] = ctrl;
        ctrl_count += 1;
        cur = ctrl.pNext;
    }
}

fn getControl(idx: u32) ?*D2Control {
    if (idx >= ctrl_count) return null;
    return ctrl_snapshot[idx];
}

/// Read wide text from a control subtype and convert to ASCII.
/// EditBox: 254 WCHAR at offset 0x5C from control base
/// Button: 256 WCHAR at offset 0x64 from control base
fn readControlText(ctrl: *D2Control, buf: []u8) usize {
    const base: [*]const u8 = @ptrCast(ctrl);
    const form_type = ctrl.eD2FormType;
    var wptr: [*]const u16 = undefined;
    var max_chars: usize = 0;

    if (form_type == 1) {
        // EditBox: wszText at offset 0x5C
        wptr = @ptrCast(@alignCast(base + 0x5C));
        max_chars = 254;
    } else if (form_type == 6) {
        // Button: wszLabel at offset 0x64
        wptr = @ptrCast(@alignCast(base + 0x64));
        max_chars = 256;
    } else {
        return 0;
    }

    var i: usize = 0;
    while (i < max_chars and i < buf.len - 1) {
        const ch = wptr[i];
        if (ch == 0) break;
        buf[i] = if (ch < 128) @intCast(ch) else '?';
        i += 1;
    }
    return i;
}

/// oogControlCount() → snapshot controls and return count
fn jsOogControlCount(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    snapshotControls();
    retInt32(argc, vp, @bitCast(ctrl_count));
    return 1;
}

/// oogControlGetInfo(index) → "type,state,x,y,w,h"
fn jsOogControlGetInfo(cx_ptr: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const idx: u32 = @bitCast(argInt32(argc, vp, 0));
    const ctrl = getControl(idx) orelse { retString(cx_ptr, argc, vp, ""); return 1; };
    var buf: [128]u8 = undefined;
    const written = std.fmt.bufPrint(&buf, "{d},{d},{d},{d},{d},{d}", .{
        ctrl.eD2FormType, ctrl.dwState, ctrl.dwPosX, ctrl.dwPosY, ctrl.dwSizeX, ctrl.dwSizeY,
    }) catch { retString(cx_ptr, argc, vp, ""); return 1; };
    retString(cx_ptr, argc, vp, written);
    return 1;
}

/// oogControlGetText(index) → text content of editbox or button label
fn jsOogControlGetText(cx_ptr: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const idx: u32 = @bitCast(argInt32(argc, vp, 0));
    const ctrl = getControl(idx) orelse { retString(cx_ptr, argc, vp, ""); return 1; };
    var buf: [512]u8 = undefined;
    const len = readControlText(ctrl, &buf);
    retString(cx_ptr, argc, vp, buf[0..len]);
    return 1;
}

/// oogControlSetText(index, text) → set text on an editbox via D2WINEDITBOX_SetTextWide
/// Updates cursor position and fires the validation callback (which enables/disables OK).
fn jsOogControlSetText(cx_ptr: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const idx: u32 = @bitCast(argInt32(argc, vp, 0));
    const ctrl = getControl(idx) orelse { retBool(argc, vp, false); return 1; };
    if (ctrl.eD2FormType != 1) { retBool(argc, vp, false); return 1; } // only editboxes

    var text_buf: [256]u8 = undefined;
    const text_len = c.sm_arg_string(cx_ptr, argc, vp, 1, &text_buf, text_buf.len);
    if (text_len < 0) { retBool(argc, vp, false); return 1; }

    // Convert ASCII to wide string
    const slen: usize = @intCast(text_len);
    var wbuf: [256]u16 = undefined;
    const wlen = @min(slen, 254);
    for (0..wlen) |i| {
        wbuf[i] = text_buf[i];
    }
    wbuf[wlen] = 0;

    // D2WINEDITBOX_SetTextWide at 0x004FF5A0 — __fastcall(editbox*, wchar_t*)
    // Copies text, updates cursor position, fires validation callback
    const SetTextWide = d2.fastcall(0x004FF5A0, fn (?[*]u8, [*]const u16) u32);
    _ = SetTextWide.call(.{ @as(?[*]u8, @ptrCast(ctrl)), &wbuf });

    retBool(argc, vp, true);
    return 1;
}

/// oogControlClick(index) → invoke the control's push/click callback
fn jsOogControlClick(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const idx: u32 = @bitCast(argInt32(argc, vp, 0));
    const ctrl = getControl(idx) orelse { retBool(argc, vp, false); return 1; };

    // For buttons, use D2WINBUTTON_InvokeClickCallback — safe and correct
    if (ctrl.eD2FormType == 6) {
        const InvokeClick = d2.fastcall(0x00500ab0, fn (*?*D2Control) void);
        var ctrl_ptr: ?*D2Control = ctrl;
        InvokeClick.call(.{&ctrl_ptr});
        retBool(argc, vp, true);
        return 1;
    }

    // For other controls: simulate a mouse click at their center via the forms
    // dispatch system. This handles Image clicks (class selection etc.) safely.
    const cx_coord: i32 = ctrl.dwPosX + @divTrunc(ctrl.dwSizeX, 2);
    const cy_coord: i32 = ctrl.dwPosY + @divTrunc(ctrl.dwSizeY, 2);
    simulateOogClick(cx_coord, cy_coord);
    retBool(argc, vp, true);
    return 1;
}

/// oogClickScreen(x, y) → simulate a mouse click at screen coordinates
/// Uses the game's ClickScreen function (0x0043E1E0) to dispatch through the
/// normal D2 OOG input pipeline — handles form mouse events properly.
fn jsOogClickScreen(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const x = argInt32(argc, vp, 0);
    const y = argInt32(argc, vp, 1);
    simulateOogClick(x, y);
    retUndefined(argc, vp);
    return 1;
}

fn simulateOogClick(x: i32, y: i32) void {
    // Set mouse position globals (used by INPUT_FormMouseHandler for hit-testing)
    const MouseX: *i32 = @ptrFromInt(0x007D55A4);
    const MouseY: *i32 = @ptrFromInt(0x007D55A8);
    MouseX.* = x;
    MouseY.* = y;

    // INPUT_FormMouseHandler at 0x004FA860 — __stdcall(D2UnderMouseStrc*)
    // It switches on pPlayer as Windows message ID:
    //   0x201 = WM_LBUTTONDOWN → walks controls, calls fpPush on hit
    //   0x202 = WM_LBUTTONUP   → calls fpMouse on all controls
    const InputFormMouse: *const fn (*types.D2UnderMouseStrc) callconv(.winapi) void = @ptrFromInt(0x004FA860);

    // Build a fake D2UnderMouseStrc for left-button-down.
    // The forms handler reinterprets pPlayer as the Windows message ID (0x201/0x202).
    var under_mouse: types.D2UnderMouseStrc = std.mem.zeroes(types.D2UnderMouseStrc);
    under_mouse.nX = @bitCast(x);
    under_mouse.nY = @bitCast(y);
    // Write 0x201 (WM_LBUTTONDOWN) into pPlayer field via pointer cast
    const player_slot: *u32 = @ptrCast(&under_mouse.pPlayer);
    player_slot.* = 0x201;
    InputFormMouse(&under_mouse);

    // Send button-up too
    player_slot.* = 0x202; // WM_LBUTTONUP
    InputFormMouse(&under_mouse);
}

/// oogControlFind(type, x, y, w, h) → index of matching control, or -1
/// Pass -1 for any param to match any value (wildcard).
fn jsOogControlFind(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const want_type = argInt32(argc, vp, 0);
    const want_x = argInt32(argc, vp, 1);
    const want_y = argInt32(argc, vp, 2);
    const want_w = argInt32(argc, vp, 3);
    const want_h = argInt32(argc, vp, 4);

    // Re-snapshot to get fresh data
    snapshotControls();

    var i: u32 = 0;
    while (i < ctrl_count) : (i += 1) {
        const ctrl = ctrl_snapshot[i];
        if (want_type != -1 and ctrl.eD2FormType != want_type) continue;
        if (want_x != -1 and ctrl.dwPosX != want_x) continue;
        if (want_y != -1 and ctrl.dwPosY != want_y) continue;
        if (want_w != -1 and ctrl.dwSizeX != want_w) continue;
        if (want_h != -1 and ctrl.dwSizeY != want_h) continue;
        retInt32(argc, vp, @bitCast(i));
        return 1;
    }
    retInt32(argc, vp, -1);
    return 1;
}

/// oogControlGetAll() → JSON array of all controls: [{"type":N,"state":N,"x":N,"y":N,"w":N,"h":N,"text":"..."},...]
/// Gives a complete dump so JS can see everything at once.
fn jsOogControlGetAll(cx_ptr: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    snapshotControls();

    // Budget ~200 bytes per control, 128 controls max = ~25KB
    var buf: [25600]u8 = undefined;
    var pos: usize = 0;
    buf[0] = '[';
    pos = 1;

    var i: u32 = 0;
    while (i < ctrl_count) : (i += 1) {
        if (i > 0 and pos < buf.len - 1) {
            buf[pos] = ',';
            pos += 1;
        }
        const ctrl = ctrl_snapshot[i];

        // Read text if available
        var text_buf: [256]u8 = undefined;
        const text_len = readControlText(ctrl, &text_buf);

        // Write JSON — escape text minimally (just quotes)
        const written = std.fmt.bufPrint(buf[pos..], "{{\"i\":{d},\"type\":{d},\"state\":{d},\"x\":{d},\"y\":{d},\"w\":{d},\"h\":{d}", .{
            i, ctrl.eD2FormType, ctrl.dwState, ctrl.dwPosX, ctrl.dwPosY, ctrl.dwSizeX, ctrl.dwSizeY,
        }) catch break;
        pos += written.len;

        if (text_len > 0) {
            const tw = std.fmt.bufPrint(buf[pos..], ",\"text\":\"{s}\"", .{text_buf[0..text_len]}) catch break;
            pos += tw.len;
        }
        buf[pos] = '}';
        pos += 1;

        if (pos > buf.len - 300) break;
    }
    if (pos < buf.len) {
        buf[pos] = ']';
        pos += 1;
    }
    retString(cx_ptr, argc, vp, buf[0..pos]);
    return 1;
}

/// oogSelectClass(classId, expansion) → select class + set expansion flag
/// classId: 0=ama, 1=sor, 2=nec, 3=pal, 4=bar, 5=dru, 6=ass
fn jsOogSelectClass(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const class_id: u8 = @intCast(@as(u32, @bitCast(argInt32(argc, vp, 0))) & 0xFF);
    const expansion: bool = if (argc >= 2) argInt32(argc, vp, 1) != 0 else true;
    if (class_id >= 7) { retBool(argc, vp, false); return 1; }

    // AnimImage globals: ama=0x779574, sor=0x779578, nec=0x779570,
    // pal=0x77957C, bar=0x77956C, dru=0x779584, ass=0x779580
    const class_to_anim = [_]usize{ 0x779574, 0x779578, 0x779570, 0x77957C, 0x77956C, 0x779584, 0x779580 };
    const anim_ptr: *?*anyopaque = @ptrFromInt(class_to_anim[class_id]);
    if (anim_ptr.* == null) { retBool(argc, vp, false); return 1; }

    const ClickOnClass: *const fn (*?*anyopaque) callconv(.winapi) u32 = @ptrFromInt(0x00433BF0);
    _ = ClickOnClass(anim_ptr);

    // Set expansion flag on launcher (ClickOnClassCreate only sets it for dru/ass)
    if (expansion) {
        const launcher_ptr: *?[*]u8 = @ptrFromInt(0x007795D4);
        if (launcher_ptr.*) |launcher| {
            // eCTEMP_eD2PlayerStatus at offset 495 (u16)
            const status: *align(1) u16 = @ptrCast(launcher + 495);
            status.* = status.* | 0x20; // PLAYERSTATUS_Expansion
        }
    }

    retBool(argc, vp, true);
    return 1;
}

/// oogSelectChar(name) → select character by name and enter game
fn jsOogSelectChar(cx: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    var name_buf: [64]u8 = undefined;
    const name_len = c.sm_arg_string(cx, argc, vp, 0, &name_buf, name_buf.len);
    if (name_len <= 0) { retBool(argc, vp, false); return 1; }
    const target = name_buf[0..@intCast(name_len)];

    const first_ptr: *?*const types.D2CharSelStrc = @ptrFromInt(0x00779dbc);
    var cur = first_ptr.* orelse { retBool(argc, vp, false); return 1; };

    while (true) {
        const name = std.mem.sliceTo(&cur.szCharname, 0);
        if (std.mem.eql(u8, name, target)) {
            _ = d2.SelectedCharBnetSingleTcpIp.call(.{
                @constCast(cur),
                @as(i16, @bitCast(cur.nCharacterFlags)),
                @as(u32, cur.ePlayerClassID),
                @as([*:0]u8, @constCast(@ptrCast("".ptr))),
            });
            retBool(argc, vp, true);
            return 1;
        }
        cur = cur.pNext orelse break;
    }
    retBool(argc, vp, false);
    return 1;
}

// ── File persistence (aether_state.json) ────────────────────────────

extern "kernel32" fn GetModuleFileNameA(hModule: ?*anyopaque, lpFilename: [*]u8, nSize: u32) callconv(.winapi) u32;

/// Get the directory where Game.exe lives (for storing state files next to it)
fn getGameDir(buf: []u8) usize {
    var path: [260]u8 = undefined;
    const len = GetModuleFileNameA(null, &path, 260);
    if (len == 0) return 0;
    // Find last backslash
    var last_sep: usize = 0;
    for (0..len) |i| {
        if (path[i] == '\\') last_sep = i;
    }
    if (last_sep == 0 or last_sep >= buf.len) return 0;
    @memcpy(buf[0 .. last_sep + 1], path[0 .. last_sep + 1]);
    return last_sep + 1;
}

/// readFile(filename) → file contents as string, or ""
fn jsReadFile(cx: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    var name_buf: [64]u8 = undefined;
    const name_len = c.sm_arg_string(cx, argc, vp, 0, &name_buf, name_buf.len);
    if (name_len <= 0) { retString(cx, argc, vp, ""); return 1; }

    var filepath: [300]u8 = undefined;
    const dir_len = getGameDir(&filepath);
    if (dir_len == 0) { retString(cx, argc, vp, ""); return 1; }
    const nlen: usize = @intCast(name_len);
    @memcpy(filepath[dir_len .. dir_len + nlen], name_buf[0..nlen]);
    filepath[dir_len + nlen] = 0;

    const fp: [*:0]const u8 = @ptrCast(filepath[0 .. dir_len + nlen + 1]);
    const INVALID: usize = 0xFFFFFFFF;
    const hFile = win32.CreateFileA(fp, 0x80000000, 1, null, 3, 0x80, null);
    const hAddr = if (hFile) |h| @intFromPtr(h) else INVALID;
    if (hAddr == INVALID or hFile == null) { retString(cx, argc, vp, ""); return 1; }

    var data: [8192]u8 = undefined;
    var bytesRead: u32 = 0;
    _ = win32.ReadFile(hFile.?, &data, data.len, &bytesRead, null);
    _ = win32.CloseHandle(hFile.?);

    if (bytesRead > 0) {
        retString(cx, argc, vp, data[0..bytesRead]);
    } else {
        retString(cx, argc, vp, "");
    }
    return 1;
}

/// writeFile(filename, content) → true on success
fn jsWriteFile(cx: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    var name_buf: [64]u8 = undefined;
    const name_len = c.sm_arg_string(cx, argc, vp, 0, &name_buf, name_buf.len);
    if (name_len <= 0) { retBool(argc, vp, false); return 1; }

    var content_buf: [8192]u8 = undefined;
    const content_len = c.sm_arg_string(cx, argc, vp, 1, &content_buf, content_buf.len);
    if (content_len < 0) { retBool(argc, vp, false); return 1; }

    var filepath: [300]u8 = undefined;
    const dir_len = getGameDir(&filepath);
    if (dir_len == 0) { retBool(argc, vp, false); return 1; }
    const nlen: usize = @intCast(name_len);
    @memcpy(filepath[dir_len .. dir_len + nlen], name_buf[0..nlen]);
    filepath[dir_len + nlen] = 0;

    const fp: [*:0]const u8 = @ptrCast(filepath[0 .. dir_len + nlen + 1]);
    const INVALID: usize = 0xFFFFFFFF;
    const hFile = win32.CreateFileA(fp, 0x40000000, 0, null, 2, 0x80, null); // CREATE_ALWAYS, WRITE
    const hAddr = if (hFile) |h| @intFromPtr(h) else INVALID;
    if (hAddr == INVALID or hFile == null) { retBool(argc, vp, false); return 1; }

    var written: u32 = 0;
    _ = win32.WriteFile(hFile.?, &content_buf, @intCast(content_len), &written, null);
    _ = win32.FlushFileBuffers(hFile.?);
    _ = win32.CloseHandle(hFile.?);
    retBool(argc, vp, true);
    return 1;
}

// ── Binding table ───────────────────────────────────────────────────

const Binding = struct {
    name: [*:0]const u8,
    func: engine_mod.NativeFn,
    nargs: c_uint,
};

const bindings = [_]Binding{
    // State (existing)
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
    .{ .name = "getTickCount", .func = &jsGetTickCount, .nargs = 0 },
    .{ .name = "getMercState", .func = &jsGetMercState, .nargs = 0 },
    .{ .name = "log", .func = &jsLog, .nargs = 1 },
    .{ .name = "logVerbose", .func = &jsLogVerbose, .nargs = 1 },
    .{ .name = "printScreen", .func = &jsPrintScreen, .nargs = 2 },
    // Unit iteration
    .{ .name = "unitCount", .func = &jsUnitCount, .nargs = 1 },
    .{ .name = "unitAtIndex", .func = &jsUnitAtIndex, .nargs = 1 },
    .{ .name = "unitValid", .func = &jsUnitValid, .nargs = 2 },
    // Unit properties (handle-based: type, id)
    .{ .name = "unitGetX", .func = &jsUnitGetX, .nargs = 2 },
    .{ .name = "unitGetY", .func = &jsUnitGetY, .nargs = 2 },
    .{ .name = "unitGetMode", .func = &jsUnitGetMode, .nargs = 2 },
    .{ .name = "unitGetClassId", .func = &jsUnitGetClassId, .nargs = 2 },
    .{ .name = "unitGetStat", .func = &jsUnitGetStat, .nargs = 4 },
    .{ .name = "unitGetState", .func = &jsUnitGetState, .nargs = 3 },
    .{ .name = "unitGetName", .func = &jsUnitGetName, .nargs = 2 },
    .{ .name = "unitGetArea", .func = &jsUnitGetArea, .nargs = 2 },
    .{ .name = "unitGetFlags", .func = &jsUnitGetFlags, .nargs = 2 },
    .{ .name = "unitGetOwnerId", .func = &jsUnitGetOwnerId, .nargs = 2 },
    .{ .name = "unitGetOwnerType", .func = &jsUnitGetOwnerType, .nargs = 2 },
    // Monster properties
    .{ .name = "monGetSpecType", .func = &jsMonGetSpecType, .nargs = 1 },
    .{ .name = "monGetEnchants", .func = &jsMonGetEnchants, .nargs = 1 },
    .{ .name = "monGetMaxHP", .func = &jsMonGetMaxHP, .nargs = 1 },
    // Item properties
    .{ .name = "itemGetQuality", .func = &jsItemGetQuality, .nargs = 1 },
    .{ .name = "itemGetFlags", .func = &jsItemGetFlags, .nargs = 1 },
    .{ .name = "itemGetLocation", .func = &jsItemGetLocation, .nargs = 1 },
    .{ .name = "itemGetLocationRaw", .func = &jsItemGetLocationRaw, .nargs = 1 },
    .{ .name = "itemGetCode", .func = &jsItemGetCode, .nargs = 1 },
    .{ .name = "itemGetRunewordIndex", .func = &jsItemGetRunewordIndex, .nargs = 1 },
    // Tile properties
    .{ .name = "tileGetDestArea", .func = &jsTileGetDestArea, .nargs = 1 },
    // Player
    .{ .name = "meGetCharName", .func = &jsMeGetCharName, .nargs = 0 },
    .{ .name = "meGetUnitId", .func = &jsMeGetUnitId, .nargs = 0 },
    // Actions (Step 4)
    .{ .name = "clickMap", .func = &jsClickMap, .nargs = 4 },
    .{ .name = "move", .func = &jsMove, .nargs = 2 },
    .{ .name = "selectSkill", .func = &jsSelectSkill, .nargs = 2 },
    .{ .name = "castSkillAt", .func = &jsCastSkillAt, .nargs = 2 },
    .{ .name = "castSkillPacket", .func = &jsCastSkillPacket, .nargs = 2 },
    .{ .name = "getRightSkill", .func = &jsGetRightSkill, .nargs = 0 },
    .{ .name = "getUIFlag", .func = &jsGetUIFlag, .nargs = 1 },
    .{ .name = "say", .func = &jsSay, .nargs = 1 },
    .{ .name = "interact", .func = &jsInteract, .nargs = 2 },
    .{ .name = "runToEntity", .func = &jsRunToEntity, .nargs = 2 },
    // Map & pathfinding
    .{ .name = "getExits", .func = &jsGetExits, .nargs = 0 },
    .{ .name = "findPath", .func = &jsFindPath, .nargs = 2 },
    .{ .name = "findTelePath", .func = &jsFindTelePath, .nargs = 2 },
    .{ .name = "findPreset", .func = &jsFindPreset, .nargs = 2 },
    // Skills
    .{ .name = "getSkillLevel", .func = &jsGetSkillLevel, .nargs = 2 },
    // Locale strings
    .{ .name = "getLocaleString", .func = &jsGetLocaleString, .nargs = 1 },
    // Txt record access
    .{ .name = "txtReadField", .func = &jsTxtReadField, .nargs = 4 },
    .{ .name = "txtReadFieldU", .func = &jsTxtReadFieldU, .nargs = 4 },
    // Process control
    .{ .name = "closeNPCInteract", .func = &jsCloseNPCInteract, .nargs = 0 },
    .{ .name = "npcMenuSelect", .func = &jsNpcMenuSelect, .nargs = 1 },
    .{ .name = "exitGame", .func = &jsExitGame, .nargs = 0 },
    .{ .name = "exitClient", .func = &jsExitClient, .nargs = 0 },
    .{ .name = "takeWaypoint", .func = &jsTakeWaypoint, .nargs = 2 },
    // Raw packet sending — accepts Uint8Array
    .{ .name = "sendPacket", .func = &jsSendPacket, .nargs = 1 },
    // Packet hooks — S2C interception
    .{ .name = "registerPacketHook", .func = &jsRegisterPacketHook, .nargs = 1 },
    .{ .name = "getPacketData", .func = &jsGetPacketData, .nargs = 0 },
    .{ .name = "getPacketSize", .func = &jsGetPacketSize, .nargs = 0 },
    .{ .name = "injectPacket", .func = &jsInjectPacket, .nargs = 1 },
    // Collision
    .{ .name = "getCollision", .func = &jsGetCollision, .nargs = 2 },
    .{ .name = "getCollisionRect", .func = &jsGetCollisionRect, .nargs = 4 },
    .{ .name = "getRooms", .func = &jsGetRooms, .nargs = 0 },
    .{ .name = "getMapSeed", .func = &jsGetMapSeed, .nargs = 0 },
    .{ .name = "getRoomSeed", .func = &jsGetRoomSeed, .nargs = 2 },
    .{ .name = "hasLineOfSight", .func = &jsHasLineOfSight, .nargs = 4 },
    // Quest / waypoint / player type
    .{ .name = "getQuest", .func = &jsGetQuest, .nargs = 2 },
    .{ .name = "hasWaypoint", .func = &jsHasWaypoint, .nargs = 1 },
    .{ .name = "meGetClassId", .func = &jsMeGetClassId, .nargs = 0 },
    .{ .name = "meGetGameType", .func = &jsMeGetGameType, .nargs = 0 },
    .{ .name = "meGetPlayerType", .func = &jsMeGetPlayerType, .nargs = 0 },
    .{ .name = "meGetLevel", .func = &jsMeGetLevel, .nargs = 0 },
    .{ .name = "meGetGold", .func = &jsMeGetGold, .nargs = 0 },
    .{ .name = "meGetGoldStash", .func = &jsMeGetGoldStash, .nargs = 0 },
    .{ .name = "clickItem", .func = &jsClickItem, .nargs = 2 },
    .{ .name = "getInteractedNPC", .func = &jsGetInteractedNPC, .nargs = 0 },
    // OOG control system
    .{ .name = "oogControlCount", .func = &jsOogControlCount, .nargs = 0 },
    .{ .name = "oogControlGetInfo", .func = &jsOogControlGetInfo, .nargs = 1 },
    .{ .name = "oogControlGetText", .func = &jsOogControlGetText, .nargs = 1 },
    .{ .name = "oogControlSetText", .func = &jsOogControlSetText, .nargs = 2 },
    .{ .name = "oogControlClick", .func = &jsOogControlClick, .nargs = 1 },
    .{ .name = "oogClickScreen", .func = &jsOogClickScreen, .nargs = 2 },
    .{ .name = "oogControlFind", .func = &jsOogControlFind, .nargs = 5 },
    .{ .name = "oogControlGetAll", .func = &jsOogControlGetAll, .nargs = 0 },
    .{ .name = "oogSelectClass", .func = &jsOogSelectClass, .nargs = 2 },
    .{ .name = "oogSelectChar", .func = &jsOogSelectChar, .nargs = 1 },
    // File persistence
    .{ .name = "readFile", .func = &jsReadFile, .nargs = 1 },
    .{ .name = "writeFile", .func = &jsWriteFile, .nargs = 2 },
};

/// Comptime-generated ES module source for "diablo:native".
/// Exports all bindings from the global object so scripts can:
///   import { getArea, log } from "diablo:native"
/// globalThis is set up by polyfill.js before any modules load.
pub const native_module_source: []const u8 = blk: {
    @setEvalBranchQuota(10000);
    var src: []const u8 = "";
    for (bindings) |b| {
        const name = std.mem.sliceTo(b.name, 0);
        src = src ++ "export const " ++ name ++ " = globalThis." ++ name ++ ";\n";
    }
    break :blk src;
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
    return ok == bindings.len;
}
