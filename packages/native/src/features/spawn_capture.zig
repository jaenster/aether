const std = @import("std");
const feature = @import("../feature.zig");
const patch = @import("../hook/patch.zig");
const log = @import("../log.zig");
const spawn_logger = @import("../spawn_logger.zig");
const d2 = struct {
    const functions = @import("../d2/functions.zig");
    const globals = @import("../d2/globals.zig");
    const types = @import("../d2/types.zig");
};

// ============================================================================
// Game function pointers
// ============================================================================

const GetCoordList: *const fn (*anyopaque) callconv(.winapi) ?*D2RoomCoordListStrc =
    @ptrFromInt(0x0061ad50);

const GetLevelAndAlloc: *const fn (*anyopaque, i32) callconv(.winapi) ?*d2.types.Level =
    @ptrFromInt(0x00642bb0);

const ADDR_INIT_NEW_ROOMS: usize = 0x0052d160;
const ADDR_ENSURE_DRLG_ACT: usize = 0x0053afb0;
const ADDR_ALLOC_MONSTER_REGION: usize = 0x005479c0;
const ADDR_TXT_INIT_TXT_FILES: usize = 0x00619300;
const ADDR_EVENT_ALLOC_TIMER_QUEUE: usize = 0x00541470;
const ADDR_ALLOC_PARTY_CONTROL: usize = 0x0053ff90;
const ADDR_ALLOC_OBJECT_CONTROL: usize = 0x00546c60;
const ADDR_ALLOC_NPC_CONTROL: usize = 0x00536070;
const ADDR_ALLOC_QUEST_CONTROL: usize = 0x00545d80;

extern "kernel32" fn InitializeCriticalSection(lp: *anyopaque) callconv(.winapi) void;

const ADDR_MONSTER_SPAWN_ROOM_MONSTERS: usize = 0x0054ec90;
const ADDR_SUNIT_SPAWN_PRESET_UNITS: usize = 0x005559a0;

// ERROR_UnrecoverableInternalError_Halt hook — intercept game asserts during spawn capture
const ADDR_ERROR_HALT: usize = 0x00408a60;
const ADDR_ERROR_HALT_REJOIN: usize = 0x00408a68; // after overwritten 8 bytes
const ADDR_ERROR_HALT_HELPER: usize = 0x0040d8d0; // subroutine called in prologue

fn errorHaltHook() callconv(.naked) void {
    // Check if spawn capture is active — if so, recover instead of halting
    asm volatile (
        \\cmpl $0, %[flag]
        \\je 1f
        \\call *%[recover_fn]
        \\1:
        // Not protected — execute original prologue and continue
        \\push %%ebp
        \\mov %%esp, %%ebp
        \\call *%[helper]
        \\jmp *%[rejoin]
        :
        : [flag] "m" (spawn_protected),
          [recover_fn] "{eax}" (@intFromPtr(&recover)),
          [helper] "{ecx}" (@as(usize, ADDR_ERROR_HALT_HELPER)),
          [rejoin] "{edx}" (@as(usize, ADDR_ERROR_HALT_REJOIN)),
    );
}

fn callFastcall2(func_addr: usize, ecx: usize, edx: usize) void {
    asm volatile (
        \\call *%[func]
        :
        : [func] "r" (func_addr),
          [ecx] "{ecx}" (ecx),
          [edx] "{edx}" (edx),
        : .{ .eax = true, .ecx = true, .edx = true, .memory = true }
    );
}

fn callMonsterSpawnRoomMonsters(game_ptr: [*]u8, room_ptr: [*]u8) void {
    callFastcall2(ADDR_MONSTER_SPAWN_ROOM_MONSTERS, @intFromPtr(game_ptr), @intFromPtr(room_ptr));
}

fn callSpawnPresetUnitsForRoom(game_ptr: [*]u8, room_ptr: [*]u8) void {
    callFastcall2(ADDR_SUNIT_SPAWN_PRESET_UNITS, @intFromPtr(game_ptr), @intFromPtr(room_ptr));
}

fn callEnsureDrlgActLoaded(pGame: *anyopaque, nActNo: u8) void {
    asm volatile (
        \\call *%[func]
        :
        : [func] "r" (ADDR_ENSURE_DRLG_ACT),
          [ecx] "{ecx}" (@intFromPtr(pGame)),
          [edx] "{edx}" (@as(u32, nActNo)),
        : .{ .eax = true, .ecx = true, .edx = true, .memory = true }
    );
}

fn callFastcallPGame(func_addr: usize, game_ptr: [*]u8) void {
    asm volatile (
        \\call *%[func]
        :
        : [func] "r" (func_addr),
          [ecx] "{ecx}" (@intFromPtr(game_ptr)),
        : .{ .eax = true, .ecx = true, .edx = true, .memory = true }
    );
}

fn callTxtInitTxtFiles() void {
    // __fastcall(pMemory=null, nZero2=1, bGametypeIsOBNetHost=0)
    // callee cleans stack arg
    asm volatile (
        \\push $0
        \\call *%[func]
        :
        : [func] "r" (ADDR_TXT_INIT_TXT_FILES),
          [ecx] "{ecx}" (@as(usize, 0)),
          [edx] "{edx}" (@as(u32, 1)),
        : .{ .eax = true, .ecx = true, .edx = true, .memory = true }
    );
}

fn callAllocMonsterRegion(game_ptr: [*]u8, seed: u32, difficulty: u8, expansion: bool) void {
    const pMonRegion: usize = @intFromPtr(game_ptr) + GAME_MONREGION_OFF;
    const pSeed: usize = @intFromPtr(game_ptr) + GAME_GAMESEED_OFF;
    const args = [4]u32{
        @intCast(pSeed),
        seed,
        @as(u32, difficulty),
        if (expansion) @as(u32, 1) else @as(u32, 0),
    };
    asm volatile (
        \\push 12(%[args])
        \\push 8(%[args])
        \\push 4(%[args])
        \\push (%[args])
        \\call *%[func]
        :
        : [func] "r" (ADDR_ALLOC_MONSTER_REGION),
          [ecx] "{ecx}" (@as(usize, 0)), // null memory pool
          [edx] "{edx}" (pMonRegion),
          [args] "r" (&args),
        : .{ .eax = true, .ecx = true, .edx = true, .memory = true }
    );
}

// ============================================================================
// Types
// ============================================================================

const D2MonsterRegionFieldStrc = extern struct {
    nClassId: u16,
    nRarity: u8,
    pad: u8,
    aArray: [48]u8,
};
comptime { std.debug.assert(@sizeOf(D2MonsterRegionFieldStrc) == 52); }

const D2MonsterRegionStrc = extern struct {
    nAct: u8,
    pad_0x1: [3]u8,
    nRoomsCount: i32,
    nRoomsWithMonsters: i32,
    nLevelRoomsCount: i32,
    nCounter: u8,
    nTotalRarity: u8,
    nSpawnCount: u8,
    pad_0x13: u8,
    pMonData: [13]D2MonsterRegionFieldStrc,
    nMonsterDensity: i32,
    nBossMin: u8,
    nBossMax: u8,
    nMonWander: u8,
    pad_0x2BF: u8,
    eLevelId: u32,
    nMonsterCounter: i32,
    dwUniqueCount: i32,
    dwMonSpawnCount: i32,
    dwMonKillCount: i32,
    nBehaviorType: i32,
    bQuest: u8,
    pad_0x2D9: [3]u8,
    dwDungeonLevel: i32,
    dwDungeonLevelEx: i32,
};
comptime { std.debug.assert(@sizeOf(D2MonsterRegionStrc) == 740); }

const D2RoomCoordListStrc = extern struct {
    pBox: [16]u8,
    pRect: extern struct { left: i32, top: i32, right: i32, bottom: i32 },
    bNode: i32,
    nRoomActive: i32,
    nIndex: i32,
    pNext: ?*D2RoomCoordListStrc,
};
comptime { std.debug.assert(@sizeOf(D2RoomCoordListStrc) == 48); }

// ============================================================================
// D2GameStrc offsets
// ============================================================================

const GAME_SIZE: usize = 7672;
const GAME_CRITSEC_OFF: usize = 24;
const GAME_DIFFICULTY_OFF: usize = 109;
const GAME_EXPANSION_OFF: usize = 112;
const GAME_INITSEED_OFF: usize = 124;
const GAME_PACT_OFF: usize = 188;
const GAME_GAMESEED_OFF: usize = 208;
const GAME_MONREGION_OFF: usize = 240;
const GAME_ARENACTRL_OFF: usize = 0x1D28;

const ACT_PDRLG: usize = 72;
const ACT_BROOMDIRTY: usize = 84;
const ROOM_COORDS_OFF: usize = 76;
const ROOM_UNITLIST_OFF: usize = 116;
const UNIT_TYPE_OFF: usize = 0x00;
const UNIT_CLASSID_OFF: usize = 0x04;
const UNIT_UNITDATA_OFF: usize = 0x14;
const UNIT_ROOMNEXT_OFF: usize = 0xE8;
const MONDATA_TYPEFLAGS_OFF: usize = 0x16;
const MONDATA_MODUMOD_OFF: usize = 0x1C; // MonUModList[9] — byte array, 0-terminated
const LEVELSTXT_ACT_OFF: usize = 3;

// Room1 → Room2 link
const ROOM1_PROOM2_OFF: usize = 0x10;
// D2PresetUnitStrc offsets
const PRESET_TXTFILENO_OFF: usize = 0x04;
const PRESET_PNEXT_OFF: usize = 0x0C;
const PRESET_TYPE_OFF: usize = 0x14;
// sgptDataTable global + SuperUniques table
const ADDR_SGPT_DATA_TABLE: usize = 0x00744304;
const DATATABLE_PSUPERUNIQUES_OFF: usize = 2772;
const DATATABLE_NSUPERUNIQUES_OFF: usize = 2780;
const SUPERUNIQUE_TXT_SIZE: usize = 52;
const SUPERUNIQUE_CLASS_OFF: usize = 4;
// Room2 pPreset offset
const ROOM2_PPRESET_OFF: usize = 0x5C;

const MAX_LEVEL_ID: u32 = 136;
const NUM_SEEDS: u32 = 1;

// ============================================================================
// SEH recovery — setjmp/longjmp via VEH
// ============================================================================

pub var jmp_buf: [6]u32 = undefined; // ebx, esi, edi, ebp, esp, eip
pub var spawn_protected: bool = false;

fn setjmpImpl() callconv(.naked) void {
    asm volatile (
        \\mov 4(%%esp), %%eax
        \\mov %%ebx, 0(%%eax)
        \\mov %%esi, 4(%%eax)
        \\mov %%edi, 8(%%eax)
        \\mov %%ebp, 12(%%eax)
        \\lea 4(%%esp), %%ecx
        \\mov %%ecx, 16(%%eax)
        \\mov (%%esp), %%ecx
        \\mov %%ecx, 20(%%eax)
        \\xor %%eax, %%eax
        \\ret
    );
}
const setjmp: *const fn (*[6]u32) callconv(.c) u32 = @ptrCast(&setjmpImpl);

fn longjmpImpl() callconv(.naked) noreturn {
    // cdecl: arg1=buf at 4(%esp), arg2=val at 8(%esp)
    asm volatile (
        \\mov 4(%%esp), %%edx
        \\mov 0(%%edx), %%ebx
        \\mov 4(%%edx), %%esi
        \\mov 8(%%edx), %%edi
        \\mov 12(%%edx), %%ebp
        \\mov 16(%%edx), %%esp
        \\mov $1, %%eax
        \\jmp *20(%%edx)
    );
}
const longjmp: *const fn (*[6]u32, u32) callconv(.c) noreturn = @ptrCast(&longjmpImpl);

/// Called from ERROR_Halt hook and VEH handler to recover from crashes
pub fn recover() void {
    longjmp(&jmp_buf, 1);
}

// ============================================================================
// State
// ============================================================================

var capture_active: bool = false;
var logged_levels: [1024]bool = [_]bool{false} ** 1024;

// Shared critical section for all fake game structs
var critsec_buf: [64]u8 align(8) = undefined;
var critsec_inited: bool = false;

// Fake arena control — zeroed so ARENA_IsArenaLevel returns 0
var fake_arena_ctrl: [256]u8 align(4) = [_]u8{0} ** 256;

// ============================================================================
// Helpers
// ============================================================================

fn readU32(base: [*]u8, off: usize) u32 {
    return @as(*const u32, @ptrCast(@alignCast(base + off))).*;
}
fn readI32(base: [*]u8, off: usize) i32 {
    return @as(*const i32, @ptrCast(@alignCast(base + off))).*;
}
fn readPtr(base: [*]u8, off: usize) ?[*]u8 {
    return @ptrCast(@as(*const ?*anyopaque, @ptrCast(@alignCast(base + off))).*);
}
fn setI32(base: [*]u8, off: usize, val: i32) void {
    @as(*i32, @ptrCast(@alignCast(base + off))).* = val;
}
fn setU32(base: [*]u8, off: usize, val: u32) void {
    @as(*u32, @ptrCast(@alignCast(base + off))).* = val;
}
fn setPtr(base: [*]u8, off: usize, val: ?*anyopaque) void {
    @as(*?*anyopaque, @ptrCast(@alignCast(base + off))).* = val;
}

fn getActForLevel(level_id: u32) ?u8 {
    const txt = d2.functions.GetLevelText.call(level_id) orelse return null;
    const txt_bytes: [*]const u8 = @ptrCast(txt);
    return txt_bytes[LEVELSTXT_ACT_OFF];
}

// ============================================================================
// Name resolution
// ============================================================================

const MONSTATS_NAMESTR_OFF: usize = 0x06;
const LEVELSTXT_SZNAME_OFF: usize = 0xF5;

var mon_name_buf: [64]u8 = undefined;
var level_name_buf: [64]u8 = undefined;

/// Convert a wide (u16) null-terminated string to ASCII, truncating to buf size.
fn wideToAscii(wide: [*]const u16, out: []u8) []const u8 {
    var i: usize = 0;
    while (i < out.len) : (i += 1) {
        const c = wide[i];
        if (c == 0) break;
        out[i] = if (c < 128) @truncate(c) else '?';
    }
    return out[0..i];
}

/// Get monster name from MonStatsTxt → NameStr → GetLocaleString
fn getMonsterName(class_id: u16) []const u8 {
    const txt = d2.functions.TxtMonStatsGetLine.call(.{@as(i32, @intCast(class_id))}) orelse return "?";
    const name_str_idx = @as(*const u16, @ptrCast(@alignCast(txt + MONSTATS_NAMESTR_OFF))).*;
    const wide = d2.functions.GetLocaleString.call(.{name_str_idx}) orelse return "?";
    return wideToAscii(wide, &mon_name_buf);
}

/// Get level name from LevelTxt → szName (ASCII, 40 bytes max)
fn getLevelName(level_id: u32) []const u8 {
    const txt_bytes = d2.functions.TxtLevelsGetLine.call(level_id) orelse return "?";
    const name_ptr = txt_bytes + LEVELSTXT_SZNAME_OFF;
    var len: usize = 0;
    while (len < 40 and name_ptr[len] != 0) : (len += 1) {}
    return name_ptr[0..len];
}

// ============================================================================
// Logging
// ============================================================================

fn logLevelPool(game_ptr: [*]u8, level_id: u32) void {
    const region_array: [*]const ?*D2MonsterRegionStrc = @ptrCast(@alignCast(game_ptr + GAME_MONREGION_OFF));
    const region = region_array[level_id] orelse return;
    spawn_logger.beginLevel(level_id, region.nMonsterDensity, region.nBossMin, region.nBossMax, region.dwDungeonLevel, getLevelName(level_id));
    const count: usize = @intCast(region.nCounter);
    for (0..count) |i| {
        spawn_logger.addPoolEntry(region.pMonData[i].nClassId, region.pMonData[i].nRarity, getMonsterName(region.pMonData[i].nClassId));
    }
    spawn_logger.endPoolBeginRooms();
}

fn isSuperUnique(class_id: u32) bool {
    const dt_ptr = @as(*const ?[*]u8, @ptrFromInt(ADDR_SGPT_DATA_TABLE)).*;
    const dt = dt_ptr orelse return false;
    const su_base = readPtr(dt, DATATABLE_PSUPERUNIQUES_OFF) orelse return false;
    const su_count = readU32(dt, DATATABLE_NSUPERUNIQUES_OFF);
    for (0..su_count) |i| {
        const entry = su_base + i * SUPERUNIQUE_TXT_SIZE;
        const su_class: u32 = @as(*const u32, @ptrCast(@alignCast(entry + SUPERUNIQUE_CLASS_OFF))).*;
        if (su_class == class_id) return true;
    }
    return false;
}

fn logPresetSuperUniques(room_ptr: [*]u8) void {
    // Room1 → Room2 → pPreset linked list
    const room2_ptr = readPtr(room_ptr, ROOM1_PROOM2_OFF) orelse return;
    var preset = readPtr(room2_ptr, ROOM2_PPRESET_OFF);
    while (preset) |p| {
        const etype = readU32(p, PRESET_TYPE_OFF);
        if (etype == 1) { // UNIT_MONSTER
            const class_id = readU32(p, PRESET_TXTFILENO_OFF);
            const cid: u16 = @truncate(class_id);
            const name = getMonsterName(cid);
            if (isSuperUnique(class_id)) {
                spawn_logger.addSpawn(cid, 3, 1, &.{}, name, 0);
            } else {
                spawn_logger.addSpawn(cid, 5, 1, &.{}, name, 0);
            }
        }
        preset = readPtr(p, PRESET_PNEXT_OFF);
    }
}

fn logRoom(room_ptr: [*]u8) void {
    spawn_logger.beginRoom();
    const x_start = readI32(room_ptr, ROOM_COORDS_OFF);
    const y_start = readI32(room_ptr, ROOM_COORDS_OFF + 4);
    const x_size = readI32(room_ptr, ROOM_COORDS_OFF + 8);
    const y_size = readI32(room_ptr, ROOM_COORDS_OFF + 12);
    spawn_logger.addRect(x_start, y_start, x_start + x_size, y_start + y_size);

    var cl = GetCoordList(@ptrCast(room_ptr));
    while (cl) |entry| {
        if (entry.nIndex != 0 and entry.bNode == 0) {
            spawn_logger.addRect(entry.pRect.left, entry.pRect.top, entry.pRect.right, entry.pRect.bottom);
        }
        cl = entry.pNext;
    }
    spawn_logger.endRectsBeginSpawns();

    // Log preset super uniques from Room2 data (no CreateUnit needed)
    logPresetSuperUniques(room_ptr);

    // Log density-spawned units from Room1 unit list
    var unit_ptr = readPtr(room_ptr, ROOM_UNITLIST_OFF);
    while (unit_ptr) |unit| {
        const unit_type = readU32(unit, UNIT_TYPE_OFF);
        if (unit_type == 1) {
            const class_id: u16 = @truncate(readU32(unit, UNIT_CLASSID_OFF));
            var spawn_type: u8 = 2; // normal
            var mods: []const u8 = &.{};
            if (readPtr(unit, UNIT_UNITDATA_OFF)) |md| {
                const type_flags = md[MONDATA_TYPEFLAGS_OFF];
                // Read MonUModList — up to 9 bytes, null-terminated
                const mod_base = md + MONDATA_MODUMOD_OFF;
                var mod_len: usize = 0;
                while (mod_len < 9 and mod_base[mod_len] != 0) : (mod_len += 1) {}
                if (mod_len > 0) {
                    mods = mod_base[0..mod_len];
                }
                // Classify: superunique > unique > minion > champion (has mods, no flag) > normal
                if ((type_flags & 0x02) != 0) {
                    spawn_type = 3; // MONTYPE_SUPERUNIQUE
                } else if ((type_flags & 0x08) != 0) {
                    spawn_type = 0; // MONTYPE_UNIQUE (boss)
                } else if ((type_flags & 0x10) != 0) {
                    spawn_type = 4; // MONTYPE_MINION
                } else if (mod_len > 0) {
                    spawn_type = 1; // Champion — has mods but no boss/minion flag
                }
            }
            // Read max HP from the unit's stat list (stat 7 = maxhp, fixed-point >> 8)
            const unit_any: ?*d2.types.UnitAny = @ptrCast(@alignCast(unit));
            const max_hp = d2.functions.GetUnitStat.call(unit_any, 7, 0) >> 8;
            spawn_logger.addSpawn(class_id, spawn_type, 1, mods, getMonsterName(class_id), max_hp);
        }
        unit_ptr = readPtr(unit, UNIT_ROOMNEXT_OFF);
    }
    spawn_logger.endRoom();
}

// ============================================================================
// Game struct creation
// ============================================================================

const SMemAlloc: *const fn (u32, [*:0]const u8, u32, u32) callconv(.winapi) ?[*]u8 =
    @ptrFromInt(0x00413020);

fn createGameStruct(seed: u32, difficulty: u8, expansion: bool) ?[*]u8 {
    const game_ptr = SMemAlloc(GAME_SIZE, "spawn", 0, 8) orelse return null;
    @memset(game_ptr[0..GAME_SIZE], 0);

    // Memory pool (required for CreateUnit / AllocUnit)
    InitializePoolSystem(@ptrCast(@alignCast(game_ptr + GAME_MEMPOOL_OFF)), "spawn", 0x4000);

    // Critical section
    if (!critsec_inited) {
        InitializeCriticalSection(@ptrCast(&critsec_buf));
        critsec_inited = true;
    }
    setPtr(game_ptr, GAME_CRITSEC_OFF, @ptrCast(&critsec_buf));

    // Seed
    setU32(game_ptr, GAME_INITSEED_OFF, seed);
    setU32(game_ptr, GAME_INITSEED_OFF + 4, 0x29a);
    setU32(game_ptr, GAME_GAMESEED_OFF, seed);
    setU32(game_ptr, GAME_GAMESEED_OFF + 4, 0x29a);

    // Difficulty + expansion
    game_ptr[GAME_DIFFICULTY_OFF] = difficulty;
    setI32(game_ptr, GAME_EXPANSION_OFF, if (expansion) @as(i32, 1) else @as(i32, 0));

    // bGameIsSetup flag
    game_ptr[0x6D] = 1;

    // Allocate game subsystems (order matches GAME_CreateSingleplayerGame)
    callFastcallPGame(ADDR_EVENT_ALLOC_TIMER_QUEUE, game_ptr);
    setPtr(game_ptr, GAME_ARENACTRL_OFF, @ptrCast(&fake_arena_ctrl));
    callFastcallPGame(ADDR_ALLOC_PARTY_CONTROL, game_ptr);
    callAllocMonsterRegion(game_ptr, seed, difficulty, expansion);
    callFastcallPGame(ADDR_ALLOC_OBJECT_CONTROL, game_ptr);
    callFastcallPGame(ADDR_ALLOC_NPC_CONTROL, game_ptr);
    callFastcallPGame(ADDR_ALLOC_QUEST_CONTROL, game_ptr);

    return game_ptr;
}

const ADDR_FREE_MONSTER_REGION: usize = 0x00547b50;
const ADDR_FREE_OBJECT_CONTROL: usize = 0x00546e90;
const ADDR_FREE_QUEST_CONTROL: usize = 0x00543800;
const ADDR_FREE_NPC_CONTROL: usize = 0x00536640;
const ADDR_FREE_ALL_UNITS: usize = 0x0053afd0;
const ADDR_FREE_INACTIVE_LISTS: usize = 0x00542e70;
const ADDR_FREE_TIMER_QUEUE: usize = 0x00541400;
const ADDR_FREE_PARTY_CONTROL: usize = 0x00540000;
const FreeAct: *const fn (*anyopaque) callconv(.winapi) void = @ptrFromInt(0x0061afd0);
const SMemFree: *const fn (?*anyopaque, [*:0]const u8, u32, u32) callconv(.winapi) i32 =
    @ptrFromInt(0x00412650);
const InitializePoolSystem: *const fn (?*?*anyopaque, [*:0]const u8, i32) callconv(.winapi) void =
    @ptrFromInt(0x00409dd0);
const FreeMemoryPool: *const fn (?*anyopaque) callconv(.winapi) void =
    @ptrFromInt(0x00409c80);
const GAME_MEMPOOL_OFF: usize = 0x1C;

fn destroyGameStruct(game_ptr: [*]u8) void {
    setPtr(game_ptr, GAME_ARENACTRL_OFF, null);

    const pMemPool = readPtr(game_ptr, GAME_MEMPOOL_OFF);

    // FreeMonsterRegion: __fastcall(pMemory, pMonsterRegion)
    const mon_region = readU32(game_ptr, GAME_MONREGION_OFF);
    if (mon_region != 0) {
        asm volatile (
            \\call *%[func]
            :
            : [func] "r" (ADDR_FREE_MONSTER_REGION),
              [ecx] "{ecx}" (if (pMemPool) |p| @intFromPtr(p) else @as(usize, 0)),
              [edx] "{edx}" (mon_region),
            : .{ .eax = true, .ecx = true, .edx = true, .memory = true }
        );
    }

    callFastcallPGame(ADDR_FREE_OBJECT_CONTROL, game_ptr);
    callFastcallPGame(ADDR_FREE_QUEST_CONTROL, game_ptr);
    callFastcallPGame(ADDR_FREE_NPC_CONTROL, game_ptr);
    callFastcallPGame(ADDR_FREE_ALL_UNITS, game_ptr);
    // Skip FREE_INACTIVE_LISTS — crashes because inactive unit tracking not fully initialized
    callFastcallPGame(ADDR_FREE_TIMER_QUEUE, game_ptr);
    callFastcallPGame(ADDR_FREE_PARTY_CONTROL, game_ptr);

    const act_array: [*]?*anyopaque = @ptrCast(@alignCast(game_ptr + GAME_PACT_OFF));
    for (0..5) |i| {
        if (act_array[i]) |act| {
            FreeAct(act);
            act_array[i] = null;
        }
    }

    if (pMemPool) |pool| {
        FreeMemoryPool(@ptrCast(pool));
    }

    setPtr(game_ptr, GAME_CRITSEC_OFF, null);
    _ = SMemFree(@ptrCast(game_ptr), "spawn", 0, 0);
}

// ============================================================================
// Capture logic
// ============================================================================

fn captureOneSeed(seed: u32, difficulty: u8, expansion: bool) void {
    log.hex("seed ", seed);
    const game_ptr = createGameStruct(seed, difficulty, expansion) orelse {
        log.hex("  createGameStruct FAILED for seed ", seed);
        return;
    };
    const game_addr = @intFromPtr(game_ptr);

    @memset(&logged_levels, false);
    spawn_logger.beginGame(seed, difficulty, expansion);

    for (0..5) |act_idx| {
        callEnsureDrlgActLoaded(@ptrFromInt(game_addr), @intCast(act_idx));
    }

    const act_array: [*]const ?[*]u8 = @ptrCast(@alignCast(game_ptr + GAME_PACT_OFF));

    const town_levels = [_]u32{ 1, 40, 75, 103, 109 };

    for (1..MAX_LEVEL_ID + 1) |level_id_usize| {
        const level_id: u32 = @intCast(level_id_usize);

        // Skip town levels — no monsters, complex object/NPC spawning
        var is_town = false;
        for (town_levels) |t| {
            if (level_id == t) {
                is_town = true;
                break;
            }
        }
        if (is_town) continue;

        const act_no = getActForLevel(level_id) orelse continue;
        if (act_no > 4) continue;

        const act_ptr = act_array[act_no] orelse continue;
        const drlg_ptr = readPtr(act_ptr, ACT_PDRLG) orelse continue;
        const lvl = GetLevelAndAlloc(@ptrCast(@alignCast(drlg_ptr)), @intCast(level_id)) orelse continue;
        captureLevel(game_ptr, lvl, level_id, @ptrCast(@alignCast(act_ptr)));
    }

    spawn_logger.endGame();
    spawn_logger.flush(seed);

    destroyGameStruct(game_ptr);
}

fn captureLevel(game_ptr: [*]u8, lvl: *d2.types.Level, level_no: u32, act_ptr: ?*d2.types.Act) void {
    if (lvl.pRoom2First == null) {
        d2.functions.InitLevel.call(lvl);
    }

    var room2 = lvl.pRoom2First;
    while (room2) |r2| {
        if (r2.pRoom1 == null) {
            d2.functions.AddRoomData.call(act_ptr, @intCast(level_no), @intCast(r2.dwPosX), @intCast(r2.dwPosY), null);
        }
        room2 = r2.pRoom2Next;
    }

    var has_rooms = false;
    room2 = lvl.pRoom2First;
    while (room2) |r2| {
        if (r2.pRoom1) |r1| {
            const room1_ptr: [*]u8 = @ptrCast(r1);
            // TODO: callSpawnPresetUnitsForRoom needs more game struct setup (crashes on CreateUnit)
            callMonsterSpawnRoomMonsters(game_ptr, room1_ptr);

            if (!logged_levels[level_no]) {
                logged_levels[level_no] = true;
                logLevelPool(game_ptr, level_no);
                has_rooms = true;
            }
            logRoom(room1_ptr);
        }
        room2 = r2.pRoom2Next;
    }

    if (has_rooms) {
        spawn_logger.endLevel();
    }
}

pub fn startCapture() void {
    if (capture_active) return;
    capture_active = true;

    log.print("spawn_capture: batch started");

    // Load D2Common data tables (not loaded at main menu)
    log.print("spawn_capture: loading txt files");
    callTxtInitTxtFiles();
    log.print("spawn_capture: txt files loaded");

    // Use Hell difficulty, expansion
    const difficulty: u8 = 2;
    const expansion = true;

    for (1..NUM_SEEDS + 1) |seed_usize| {
        const seed: u32 = @intCast(seed_usize);
        // Re-initialize critsec before each seed to clear any stuck locks from prior crashes
        InitializeCriticalSection(@ptrCast(&critsec_buf));
        critsec_inited = true;
        if (setjmp(&jmp_buf) != 0) {
            log.hex("spawn_capture: seed CRASHED: ", seed);
            spawn_protected = false;
            // Reset critsec again after crash recovery
            InitializeCriticalSection(@ptrCast(&critsec_buf));
            continue;
        }
        spawn_protected = true;
        captureOneSeed(seed, difficulty, expansion);
        spawn_protected = false;

        if (seed % 10 == 0) {
            log.hex("spawn_capture: seeds done: ", seed);
        }
    }

    capture_active = false;
    log.print("spawn_capture: batch done");
}

// ============================================================================
// Feature hooks
// ============================================================================

var auto_started: bool = false;
var oog_frames: u32 = 0;

fn init() void {
    // Hook ERROR_Halt: overwrite 8 bytes (push ebp; mov ebp,esp; call helper)
    if (patch.writeJump(ADDR_ERROR_HALT, @intFromPtr(&errorHaltHook))) {
        _ = patch.writeNops(ADDR_ERROR_HALT + 5, 3);
        log.print("spawn_capture: ERROR_Halt hooked");
    }
}

fn deinit() void {
    patch.revertRange(ADDR_ERROR_HALT, 8);
}

fn onOogLoop() void {
    if (auto_started or capture_active) return;
    oog_frames += 1;
    if (oog_frames < 30) return;
    auto_started = true;
    startCapture();
}

fn onKeyEvent(key: u32, down: bool, _: u32) bool {
    if (key == 0x78 and down and !capture_active) { // F9
        startCapture();
        return false;
    }
    return true;
}

pub const hooks = feature.Hooks{
    .init = &init,
    .deinit = &deinit,
    .oogLoop = &onOogLoop,
    .keyEvent = &onKeyEvent,
};
