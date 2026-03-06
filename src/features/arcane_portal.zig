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
const SUMMONER_TYPE: u32 = 1;
const SUMMONER_CLASS: u32 = 250;
const PORTAL_CLASS_ID: i32 = 0x3C;

var captured_pGame: usize = 0;
var portal_spawned: bool = false;
var last_level: u32 = 0;

fn init() void {
    if (patch.writeJump(ADDR_SERVER_GAME_LOOP, @intFromPtr(&serverGameLoopThunk))) {
        log.print("arcane_portal: ServerGameLoop hook installed");
    } else {
        log.print("arcane_portal: HOOK FAILED");
    }
}

fn deinit() void {
    patch.revertRange(ADDR_SERVER_GAME_LOOP, 5);
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

    if (level_no != last_level) {
        portal_spawned = false;
        last_level = level_no;
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

    // Find Arcane level and Summoner preset
    const arcane_level = GetLevelAndAlloc.call(pDrlg, @as(i32, LEVEL_ARCANE)) orelse return;
    if (arcane_level.pRoom2First == null) {
        d2.functions.InitLevel.call(arcane_level);
    }

    const info = findSummonerRoom(arcane_level, act) orelse {
        log.print("arcane: summoner not found");
        portal_spawned = true;
        return;
    };

    // AddRoomData on Summoner's Room2 to get a Room1 in Arcane
    const summoner_room2 = info.room2;
    var added_room = false;
    if (summoner_room2.pRoom1 == null) {
        d2.functions.AddRoomData.call(act, @as(c_int, @intCast(arcane_level.dwLevelNo)), @as(c_int, @intCast(summoner_room2.dwPosX)), @as(c_int, @intCast(summoner_room2.dwPosY)), summoner_room2.pRoom1);
        added_room = true;
    }

    const arcane_room1 = summoner_room2.pRoom1 orelse {
        log.print("arcane: AddRoomData failed to create Room1");
        if (added_room) {
            d2.functions.RemoveRoomData.call(act, @as(c_int, @intCast(arcane_level.dwLevelNo)), @as(c_int, @intCast(summoner_room2.dwPosX)), @as(c_int, @intCast(summoner_room2.dwPosY)), null);
        }
        portal_spawned = true;
        return;
    };

    // Spawn portal FROM Arcane (at Summoner) TO Canyon
    // LinkPortal will create the paired destination portal in Canyon near the player
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
        @as(i32, 1), // bIgnore=1 to skip FindSpawnLocation (we already have exact coords)
    });

    // Clean up the temporary Room1
    if (added_room) {
        d2.functions.RemoveRoomData.call(act, @as(c_int, @intCast(arcane_level.dwLevelNo)), @as(c_int, @intCast(summoner_room2.dwPosX)), @as(c_int, @intCast(summoner_room2.dwPosY)), summoner_room2.pRoom1);
    }

    if (portal_unit) |portal| {
        log.hex("arcane: portal spawned id=", portal.dwUnitId);
        log.hex("arcane: arcane x=", @as(u32, @bitCast(info.x)));
        log.hex("arcane: arcane y=", @as(u32, @bitCast(info.y)));
        log.print("arcane_portal: Portal spawned (Arcane->Canyon)");
    } else {
        log.print("arcane_portal: SpawnPortal returned null");
    }

    portal_spawned = true;
}

fn findSummonerRoom(arcane_level: *d2.types.Level, act: *d2.types.Act) ?SummonerInfo {
    var r2 = arcane_level.pRoom2First;
    while (r2) |room2| : (r2 = room2.pRoom2Next) {
        // Need AddRoomData to populate presets
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
            if (p.dwType == SUMMONER_TYPE and p.dwTxtFileNo == SUMMONER_CLASS) {
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
