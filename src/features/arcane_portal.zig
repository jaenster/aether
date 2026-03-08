const feature = @import("../feature.zig");
const patch = @import("../hook/patch.zig");
const log = @import("../log.zig");
const d2 = struct {
    const functions = @import("../d2/functions.zig");
    const types = @import("../d2/types.zig");
};

const ADDR_SERVER_GAME_LOOP: usize = 0x0052d870;
const ADDR_SERVER_GAME_LOOP_REJOIN: usize = 0x0052d875;

const LEVEL_CANYON: u32 = 46;
const LEVEL_ARCANE: u32 = 74;
const JOURNAL_TYPE: u32 = 2;
const JOURNAL_CLASS: u32 = 357;
const PORTAL_CLASS_ID: i32 = 0x3C;

var captured_pGame: usize = 0;
var portal_spawned: bool = false;
var last_pGame: usize = 0;



fn init() void {
    if (patch.writeJump(ADDR_SERVER_GAME_LOOP, @intFromPtr(&serverGameLoopThunk))) {
        log.print("arcane_portal: game loop hooked");
    } else {
        log.print("arcane_portal: game loop HOOK FAILED");
    }
    // Hook SERVER_SpawnPortal: allow our call, block the rest
    if (patch.writeJump(ADDR_SPAWN_PORTAL, @intFromPtr(&spawnPortalHook))) {
        log.print("arcane_portal: SpawnPortal hooked");
    } else {
        log.print("arcane_portal: SpawnPortal HOOK FAILED");
    }
}

fn deinit() void {
    patch.revertRange(ADDR_SERVER_GAME_LOOP, 5);
    patch.revertRange(ADDR_SPAWN_PORTAL, 5);
}

fn serverGameLoopThunk() callconv(.naked) void {
    asm volatile ("mov %%ecx, %[game]"
        : [game] "=m" (captured_pGame),
    );
    asm volatile (
        \\pushal
        \\call *%[func]
        \\popal
        :
        : [func] "{eax}" (@intFromPtr(&onServerGameLoop)),
    );
    asm volatile (
        \\push %%ebx
        \\push %%esi
        \\push %%edi
        \\mov %%ecx, %%edi
        \\jmp *%[target]
        :
        : [target] "{eax}" (ADDR_SERVER_GAME_LOOP_REJOIN),
    );
}

/// GetLevelAndAlloc: __stdcall(pDrlg, eLevelId) → Level*
const GetLevelAndAlloc = struct {
    const Fn = *const fn (?*anyopaque, i32) callconv(.winapi) ?*d2.types.Level;
    const ptr: Fn = @ptrFromInt(0x00642bb0);
    pub inline fn call(pDrlg: ?*anyopaque, eLevelId: i32) ?*d2.types.Level {
        return ptr(pDrlg, eLevelId);
    }
};

const SummonerInfo = struct {
    x: i32,
    y: i32,
    room2: *d2.types.Room2,
};

fn onServerGameLoop() void {
    if (captured_pGame == 0) return;

    const pClient = readPtr(captured_pGame + 0x88) orelse return;
    const player: *d2.types.UnitAny = @ptrFromInt(readPtr(pClient + 0x174) orelse return);

    const path = player.pPath orelse return;
    const room1 = path.pRoom1 orelse return;
    const room2 = room1.pRoom2 orelse return;
    const level = room2.pLevel orelse return;
    const level_no = level.dwLevelNo;

    // Reset once per game
    if (captured_pGame != last_pGame) {
        portal_spawned = false;
        last_pGame = captured_pGame;

    }

    if (level_no != LEVEL_CANYON or portal_spawned) return;

    // Get server-side pDrlg and pAct
    const pActArray: [*]?*anyopaque = @ptrFromInt(captured_pGame + 0xBC);
    const pDrlgAct = pActArray[player.dwAct] orelse return;
    const pDrlg: ?*anyopaque = @as(*?*anyopaque, @ptrFromInt(@intFromPtr(pDrlgAct) + 72)).*;
    if (pDrlg == null) return;
    const pDrlgAddr = @intFromPtr(pDrlg.?);
    const pAct: ?*d2.types.Act = @as(*?*d2.types.Act, @ptrFromInt(pDrlgAddr + 0x46C)).*;
    const act = pAct orelse return;

    // Find Arcane level and journal preset
    const arcane_level = GetLevelAndAlloc.call(pDrlg, @as(i32, LEVEL_ARCANE)) orelse return;
    if (arcane_level.pRoom2First == null) {
        d2.functions.InitLevel.call(arcane_level);
    }

    const info = findSummonerRoom(arcane_level, act) orelse {
        log.print("arcane: journal not found");
        portal_spawned = true;
        return;
    };

    // AddRoomData on journal's Room2 to get a Room1 in Arcane
    const summoner_room2 = info.room2;
    var added_room = false;
    if (summoner_room2.pRoom1 == null) {
        d2.functions.AddRoomData.call(act, @as(c_int, @intCast(arcane_level.dwLevelNo)), @as(c_int, @intCast(summoner_room2.dwPosX)), @as(c_int, @intCast(summoner_room2.dwPosY)), summoner_room2.pRoom1);
        added_room = true;
    }

    const arcane_room1 = summoner_room2.pRoom1 orelse {
        if (added_room) {
            d2.functions.RemoveRoomData.call(act, @as(c_int, @intCast(arcane_level.dwLevelNo)), @as(c_int, @intCast(summoner_room2.dwPosX)), @as(c_int, @intCast(summoner_room2.dwPosY)), null);
        }
        portal_spawned = true;
        return;
    };

    // Spawn portal FROM Arcane (at journal) TO Canyon
    var portal_unit: ?*d2.types.UnitAny = null;
    d2.functions.SpawnPortal.call(.{
        @as(?*anyopaque, @ptrFromInt(captured_pGame)),
        player,
        @as(?*anyopaque, @ptrCast(arcane_room1)),
        info.x,
        info.y,
        @as(i32, @intCast(LEVEL_CANYON)),
        &portal_unit,
        PORTAL_CLASS_ID,
        @as(i32, 1),
    });

    if (added_room) {
        d2.functions.RemoveRoomData.call(act, @as(c_int, @intCast(arcane_level.dwLevelNo)), @as(c_int, @intCast(summoner_room2.dwPosX)), @as(c_int, @intCast(summoner_room2.dwPosY)), summoner_room2.pRoom1);
    }

    if (portal_unit) |_| {
        log.print("arcane_portal: Portal spawned (Arcane->Canyon)");
    } else {
        log.print("arcane_portal: SpawnPortal returned null");
    }

    portal_spawned = true;
}

// SERVER_SpawnPortal at 0x0056D130
// Prologue: push ebp; mov ebp,esp; sub esp,0x10 (6 bytes)
const ADDR_SPAWN_PORTAL: usize = 0x0056D130;
const ADDR_SPAWN_PORTAL_REJOIN: usize = 0x0056D136;

/// Hook SERVER_SpawnPortal: allow when portal_spawned==false, block when true.
/// __fastcall — ECX=pGame, EDX=pPlayer, stack args follow.
fn spawnPortalHook() callconv(.naked) void {
    asm volatile (
        \\cmpb $0, %[flag]
        \\jne 1f
        :
        : [flag] "m" (portal_spawned),
    );
    // Not yet spawned — run original prologue and continue
    asm volatile (
        \\push %%ebp
        \\mov %%esp, %%ebp
        \\sub $0x10, %%esp
        \\jmp *%[rejoin]
        :
        : [rejoin] "{eax}" (ADDR_SPAWN_PORTAL_REJOIN),
    );
    // Already spawned — return without creating portal
    // __fastcall with 7 stack params = 28 bytes to clean
    asm volatile (
        \\1:
        \\xor %%eax, %%eax
        \\ret $28
    );
}

fn findSummonerRoom(arcane_level: *d2.types.Level, act: *d2.types.Act) ?SummonerInfo {
    var r2 = arcane_level.pRoom2First;
    while (r2) |room2| : (r2 = room2.pRoom2Next) {
        var added = false;
        if (room2.pRoom1 == null) {
            d2.functions.AddRoomData.call(act, @as(c_int, @intCast(arcane_level.dwLevelNo)), @as(c_int, @intCast(room2.dwPosX)), @as(c_int, @intCast(room2.dwPosY)), room2.pRoom1);
            added = true;
        }
        defer {
            if (added) {
                d2.functions.RemoveRoomData.call(act, @as(c_int, @intCast(arcane_level.dwLevelNo)), @as(c_int, @intCast(room2.dwPosX)), @as(c_int, @intCast(room2.dwPosY)), room2.pRoom1);
            }
        }

        var preset = room2.pPreset;
        while (preset) |p| : (preset = p.pPresetNext) {
            if (p.dwType == JOURNAL_TYPE and p.dwTxtFileNo == JOURNAL_CLASS) {
                return SummonerInfo{
                    .x = @as(i32, @intCast(room2.dwPosX * 5 + p.dwPosX)),
                    .y = @as(i32, @intCast(room2.dwPosY * 5 + p.dwPosY)),
                    .room2 = room2,
                };
            }
        }
    }
    return null;
}

fn readPtr(addr: usize) ?usize {
    if (addr == 0) return null;
    const val = @as(*const usize, @ptrFromInt(addr)).*;
    return if (val == 0) null else val;
}

pub const hooks = feature.Hooks{
    .init = &init,
    .deinit = &deinit,
};
