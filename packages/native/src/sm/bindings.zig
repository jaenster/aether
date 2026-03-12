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

fn jsGetTickCount(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    retInt32(argc, vp, @bitCast(GetTickCount()));
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

fn jsItemGetLocation(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const unit_id: u32 = @bitCast(argInt32(argc, vp, 0));
    const unit = units.findUnit(4, unit_id) orelse { retInt32(argc, vp, -1); return 1; };
    const data: *types.ItemData = @ptrCast(@alignCast(unit.pUnitData orelse { retInt32(argc, vp, -1); return 1; }));
    retInt32(argc, vp, @as(i32, data.game_location));
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
    d2.sendSelectSkill(@intCast(skill_id & 0xFFFF), hand != 0);
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
/// table: 0=monstats, 1=skills, 2=levels
/// Reads `size` bytes (1/2/4) at `offset` from the txt record, sign-extended.
fn jsTxtReadField(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const table = argInt32(argc, vp, 0);
    const record_id = argInt32(argc, vp, 1);
    const offset: u32 = @bitCast(argInt32(argc, vp, 2));
    const size = argInt32(argc, vp, 3);

    const record_ptr: ?[*]u8 = switch (table) {
        0 => d2.TxtMonStatsGetLine.call(.{record_id}),
        1 => d2.TxtSkillsGetLine.call(.{record_id}),
        2 => d2.TxtLevelsGetLine.call(@bitCast(record_id)),
        else => null,
    };

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

    const record_ptr: ?[*]u8 = switch (table) {
        0 => d2.TxtMonStatsGetLine.call(.{record_id}),
        1 => d2.TxtSkillsGetLine.call(.{record_id}),
        2 => d2.TxtLevelsGetLine.call(@bitCast(record_id)),
        else => null,
    };

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
    // Unit size 1 (player), collision mask 0x1C09 (PLAYER_COLLISION_DEFAULT)
    const coll = d2.CheckCollisionWidth.call(.{ target_room, x, y, @as(u32, 1), @as(u16, 0x1C09) });
    retInt32(argc, vp, @as(i32, coll));
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
    .{ .name = "log", .func = &jsLog, .nargs = 1 },
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
    .{ .name = "itemGetCode", .func = &jsItemGetCode, .nargs = 1 },
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
