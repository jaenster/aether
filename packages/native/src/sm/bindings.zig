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
    const path = unit.pPath orelse { retInt32(argc, vp, 0); return 1; };
    retInt32(argc, vp, @as(i32, path.xPos));
    return 1;
}

fn jsUnitGetY(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const unit_type: u32 = @bitCast(argInt32(argc, vp, 0));
    const unit_id: u32 = @bitCast(argInt32(argc, vp, 1));
    const unit = units.findUnit(unit_type, unit_id) orelse { retInt32(argc, vp, 0); return 1; };
    const path = unit.pPath orelse { retInt32(argc, vp, 0); return 1; };
    retInt32(argc, vp, @as(i32, path.yPos));
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
    const path = unit.pPath orelse { retInt32(argc, vp, -1); return 1; };
    const room1 = path.pRoom1 orelse { retInt32(argc, vp, -1); return 1; };
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
    // szCode is 4 bytes, may not be null-terminated
    var len: usize = 0;
    while (len < 4 and txt.szCode[len] != 0) len += 1;
    retString(cx, argc, vp, txt.szCode[0..len]);
    return 1;
}

// ── Tile property bindings ───────────────────────────────────────────

fn jsTileGetDestArea(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const unit_id: u32 = @bitCast(argInt32(argc, vp, 0));
    const unit = units.findUnit(5, unit_id) orelse { retInt32(argc, vp, -1); return 1; };
    // For room tiles, pPath leads to the warp destination info
    // The RoomTile linked via the room2 has the dest area
    const path = unit.pPath orelse { retInt32(argc, vp, -1); return 1; };
    const room1 = path.pRoom1 orelse { retInt32(argc, vp, -1); return 1; };
    const room2 = room1.pRoom2 orelse { retInt32(argc, vp, -1); return 1; };
    // Walk room tiles to find the one matching this unit's classid
    var tile: ?*types.RoomTile = room2.pRoomTiles;
    while (tile) |t| {
        if (t.pRoom2) |dest_room2| {
            if (dest_room2.pLevel) |dest_level| {
                // The tile's classid (dwTxtFileNo) corresponds to the warp ID
                retInt32(argc, vp, @bitCast(dest_level.dwLevelNo));
                return 1;
            }
        }
        tile = t.pNext;
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

// ── Action bindings (Step 4) ─────────────────────────────────────────

fn jsClickMap(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const click_type = argInt32(argc, vp, 0);
    const shift = argInt32(argc, vp, 1);
    const x = argInt32(argc, vp, 2);
    const y = argInt32(argc, vp, 3);
    d2.clickAtWorld(click_type, x, y);
    _ = shift;
    retUndefined(argc, vp);
    return 1;
}

fn jsMove(_: ?*anyopaque, argc: c_uint, vp: ?*anyopaque) callconv(.c) c_int {
    const x: u32 = @bitCast(argInt32(argc, vp, 0));
    const y: u32 = @bitCast(argInt32(argc, vp, 1));
    d2.sendRunToLocation(@intCast(x & 0xFFFF), @intCast(y & 0xFFFF));
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
    const x: u32 = @bitCast(argInt32(argc, vp, 0));
    const y: u32 = @bitCast(argInt32(argc, vp, 1));
    d2.castRightSkillAt(@intCast(x & 0xFFFF), @intCast(y & 0xFFFF));
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
    // Item properties
    .{ .name = "itemGetQuality", .func = &jsItemGetQuality, .nargs = 1 },
    .{ .name = "itemGetFlags", .func = &jsItemGetFlags, .nargs = 1 },
    .{ .name = "itemGetLocation", .func = &jsItemGetLocation, .nargs = 1 },
    .{ .name = "itemGetCode", .func = &jsItemGetCode, .nargs = 1 },
    // Tile properties
    .{ .name = "tileGetDestArea", .func = &jsTileGetDestArea, .nargs = 1 },
    // Player
    .{ .name = "meGetCharName", .func = &jsMeGetCharName, .nargs = 0 },
    // Actions (Step 4)
    .{ .name = "clickMap", .func = &jsClickMap, .nargs = 4 },
    .{ .name = "move", .func = &jsMove, .nargs = 2 },
    .{ .name = "selectSkill", .func = &jsSelectSkill, .nargs = 2 },
    .{ .name = "castSkillAt", .func = &jsCastSkillAt, .nargs = 2 },
    .{ .name = "getUIFlag", .func = &jsGetUIFlag, .nargs = 1 },
    .{ .name = "say", .func = &jsSay, .nargs = 1 },
};

/// Comptime-generated ES module source for "diablo:native".
/// Exports all bindings from the global object so scripts can:
///   import { getArea, log } from "diablo:native"
/// Uses Function('return this')() since SM60 lacks globalThis.
pub const native_module_source: []const u8 = blk: {
    @setEvalBranchQuota(10000);
    var src: []const u8 = "const __g = Function('return this')();\n";
    for (bindings) |b| {
        const name = std.mem.sliceTo(b.name, 0);
        src = src ++ "export const " ++ name ++ " = __g." ++ name ++ ";\n";
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
    log.print("sm: native bindings registered");
    return ok == bindings.len;
}
