const std = @import("std");
const types = @import("types.zig");
const UnitAny = types.UnitAny;
const Act = types.Act;
const Room1 = types.Room1;
const Level = types.Level;
const LevelTxt = types.LevelTxt;
const ObjectTxt = types.ObjectTxt;
const ItemTxt = types.ItemTxt;
const D2CharSelStrc = types.D2CharSelStrc;
const POINT = types.POINT;
const RECT = types.RECT;

const DWORD = u32;
const BOOL = i32;

fn funcPtr(comptime addr: usize, comptime FnT: type) FnT {
    return @ptrFromInt(addr);
}

// ============================================================================
// Comptime fastcall generator
// ============================================================================
// Zig's .Fastcall is broken on x86 (github.com/ziglang/zig/issues/10363).
// This generates correct inline asm: ECX=arg1, EDX=arg2, stack=rest (R→L),
// callee cleans stack.
//
// Usage:
//   pub const SetFont = fastcall(0x502EF0, fn (DWORD) DWORD);
//   _ = SetFont.call(.{1});
//
//   pub const DrawText = fastcall(0x502320, fn ([*:0]const u16, c_int, c_int, DWORD, BOOL) void);
//   DrawText.call(.{text, 100, 50, 4, 0});

fn argToU32(comptime T: type, val: T) u32 {
    return switch (@typeInfo(T)) {
        .pointer => @intFromPtr(val),
        .optional => |opt| switch (@typeInfo(opt.child)) {
            .pointer => if (val) |p| @intFromPtr(p) else 0,
            .@"fn" => if (val) |p| @intFromPtr(p) else 0,
            else => @bitCast(val),
        },
        .@"enum" => @intFromEnum(val),
        .bool => if (val) @as(u32, 1) else 0,
        .int => @as(u32, @bitCast(@as(i32, @intCast(val)))),
        else => @compileError("unsupported arg type for fastcall: " ++ @typeName(T)),
    };
}

fn u32ToRet(comptime T: type, raw: u32) T {
    return switch (@typeInfo(T)) {
        .pointer => @ptrFromInt(raw),
        .optional => |opt| switch (@typeInfo(opt.child)) {
            .pointer => if (raw == 0) null else @ptrFromInt(raw),
            else => @bitCast(raw),
        },
        .int => |int_info| if (int_info.bits < 32)
            @bitCast(@as(std.meta.Int(.unsigned, int_info.bits), @truncate(raw)))
        else
            @bitCast(raw),
        .bool => raw != 0,
        else => @compileError("unsupported return type for fastcall: " ++ @typeName(T)),
    };
}

/// Build the inline asm string for an N-arg fastcall.
/// Reads args from a u32 array pointed to by %[buf].
/// Sets ECX from buf[0], EDX from buf[1], pushes buf[N-1]..buf[2].
fn buildFastcallAsm(comptime n: usize) []const u8 {
    comptime {
        var s: []const u8 = "";
        // Push stack args in reverse order (right-to-left)
        var i: usize = n;
        while (i > 2) {
            i -= 1;
            s = s ++ std.fmt.comptimePrint("pushl {d}(%[buf])\n", .{i * 4});
        }
        // Load ECX and EDX from the buffer
        if (n >= 1) s = s ++ "movl (%[buf]), %ecx\n";
        if (n >= 2) s = s ++ "movl 4(%[buf]), %edx\n";
        s = s ++ "call *%[func]\n";
        return s;
    }
}

fn ArgsArray(comptime FnType: type) type {
    const info = @typeInfo(FnType).@"fn";
    const n = info.params.len;
    return [if (n > 0) n else 1]u32;
}

pub fn fastcall(comptime addr: u32, comptime FnType: type) type {
    const info = @typeInfo(FnType).@"fn";
    const params = info.params;
    const n = params.len;
    const RetType = info.return_type orelse void;
    const has_ret = RetType != void;

    // Build the tuple type for call arguments
    const Tuple = std.meta.ArgsTuple(FnType);

    return struct {
        pub inline fn call(args: Tuple) RetType {
            // Convert all args to u32 array
            var buf: ArgsArray(FnType) = undefined;
            inline for (0..n) |i| {
                buf[i] = argToU32(params[i].type.?, args[i]);
            }

            const asm_str = comptime buildFastcallAsm(n);

            if (comptime has_ret) {
                const raw = asm volatile (asm_str
                    : [ret] "={eax}" (-> u32),
                    : [buf] "r" (&buf),
                      [func] "r" (addr),
                    : .{ .ecx = true, .edx = true, .memory = true }
                );
                return u32ToRet(RetType, raw);
            } else {
                asm volatile (asm_str
                    :
                    : [buf] "r" (&buf),
                      [func] "r" (addr),
                    : .{ .eax = true, .ecx = true, .edx = true, .memory = true }
                );
            }
        }
    };
}

// ============================================================================
// Drawing (__fastcall)
// ============================================================================

pub const SetFont = fastcall(0x502EF0, fn (DWORD) DWORD);

pub const DrawGameText = fastcall(0x502320, fn ([*:0]const u16, c_int, c_int, DWORD, BOOL) void);

pub const GetTextSize = fastcall(0x502520, fn ([*:0]const u16, *DWORD, *DWORD) DWORD);

pub const GetUnitName = fastcall(0x464A60, fn (?*UnitAny) ?[*:0]u16);

// ============================================================================
// Drawing (__stdcall)
// ============================================================================

pub const DrawLine = struct {
    const Fn = *const fn (c_int, c_int, c_int, c_int, DWORD, DWORD) callconv(.winapi) void;
    const ptr: Fn = funcPtr(0x4F6380, Fn);
    pub inline fn call(x0: c_int, y0: c_int, x1: c_int, y1: c_int, color: DWORD, alpha: DWORD) void {
        ptr(x0, y0, x1, y1, color, alpha);
    }
};

pub const DrawRect = struct {
    const Fn = *const fn (*RECT, u8) callconv(.winapi) void;
    const ptr: Fn = funcPtr(0x4F62A0, Fn);
    pub inline fn call(rect: *RECT, palette_idx: u8) void {
        ptr(rect, palette_idx);
    }
};

pub const DrawSolidRectAlpha = struct {
    const Fn = *const fn (c_int, c_int, c_int, c_int, DWORD, DWORD) callconv(.winapi) void;
    const ptr: Fn = funcPtr(0x4F6340, Fn);
    pub inline fn call(x0: c_int, y0: c_int, x1: c_int, y1: c_int, color: DWORD, alpha: DWORD) void {
        ptr(x0, y0, x1, y1, color, alpha);
    }
};

pub const DrawImage = struct {
    const Fn = *const fn (?*anyopaque, c_int, c_int, c_int, DWORD, ?*anyopaque) callconv(.winapi) void;
    const ptr: Fn = funcPtr(0x4F6480, Fn);
    pub inline fn call(dc6_ctx: ?*anyopaque, x: c_int, y: c_int, gamma: c_int, mode: DWORD, palette: ?*anyopaque) void {
        ptr(dc6_ctx, x, y, gamma, mode, palette);
    }
};

// ============================================================================
// Units (__stdcall)
// ============================================================================

pub const GetUnitStat = struct {
    const Fn = *const fn (?*UnitAny, DWORD, DWORD) callconv(.winapi) DWORD;
    const ptr: Fn = funcPtr(0x625480, Fn);
    pub inline fn call(unit: ?*UnitAny, stat: DWORD, stat2: DWORD) DWORD {
        return ptr(unit, stat, stat2);
    }
};

pub const GetUnitState = struct {
    const Fn = *const fn (?*UnitAny, DWORD) callconv(.winapi) c_int;
    const ptr: Fn = funcPtr(0x639DF0, Fn);
    pub inline fn call(unit: ?*UnitAny, state_no: DWORD) c_int {
        return ptr(unit, state_no);
    }
};

pub const UnitLocation = struct {
    const Fn = *const fn (?*UnitAny, *POINT) callconv(.winapi) void;
    const ptr: Fn = funcPtr(0x620870, Fn);
    pub inline fn call(unit: ?*UnitAny, point: *POINT) void {
        ptr(unit, point);
    }
};

pub const CreateUnit = fastcall(0x555230, fn (types.UnitType, DWORD, DWORD, DWORD, ?*anyopaque, ?*Room1, DWORD, DWORD, DWORD) ?*UnitAny);

// ============================================================================
// Level / Room (__stdcall)
// ============================================================================

pub const AddRoomData = struct {
    const Fn = *const fn (?*Act, c_int, c_int, c_int, ?*Room1) callconv(.winapi) void;
    const ptr: Fn = funcPtr(0x61A070, Fn);
    pub inline fn call(act: ?*Act, level_id: c_int, x: c_int, y: c_int, room: ?*Room1) void {
        ptr(act, level_id, x, y, room);
    }
};

pub const RemoveRoomData = struct {
    const Fn = *const fn (?*Act, c_int, c_int, c_int, ?*Room1) callconv(.winapi) void;
    const ptr: Fn = funcPtr(0x61A0C0, Fn);
    pub inline fn call(act: ?*Act, level_id: c_int, x: c_int, y: c_int, room: ?*Room1) void {
        ptr(act, level_id, x, y, room);
    }
};

pub const InitLevel = struct {
    const Fn = *const fn (?*Level) callconv(.winapi) void;
    const ptr: Fn = funcPtr(0x6424A0, Fn);
    pub inline fn call(level: ?*Level) void {
        ptr(level);
    }
};

pub const GetLevelText = struct {
    const Fn = *const fn (DWORD) callconv(.winapi) ?*LevelTxt;
    const ptr: Fn = funcPtr(0x61DB70, Fn);
    pub inline fn call(level_no: DWORD) ?*LevelTxt {
        return ptr(level_no);
    }
};

pub const GetObjectText = struct {
    const Fn = *const fn (DWORD) callconv(.winapi) ?*ObjectTxt;
    const ptr: Fn = funcPtr(0x640E90, Fn);
    pub inline fn call(obj_no: DWORD) ?*ObjectTxt {
        return ptr(obj_no);
    }
};

pub const GetItemText = struct {
    const Fn = *const fn (DWORD) callconv(.winapi) ?*ItemTxt;
    const ptr: Fn = funcPtr(0x6335F0, Fn);
    pub inline fn call(item_no: DWORD) ?*ItemTxt {
        return ptr(item_no);
    }
};

pub const GetAct = struct {
    const Fn = *const fn (c_int) callconv(.winapi) DWORD;
    const ptr: Fn = funcPtr(0x6427F0, Fn);
    pub inline fn call(level_id: c_int) DWORD {
        return ptr(level_id);
    }
};

// ============================================================================
// Screen (__stdcall)
// ============================================================================

pub const GetScreenMode = struct {
    const Fn = *const fn () callconv(.winapi) DWORD;
    const ptr: Fn = funcPtr(0x4F5160, Fn);
    pub inline fn call() DWORD {
        return ptr();
    }
};

pub const GetScreenModeSize = struct {
    const Fn = *const fn (c_int, *c_int, *c_int) callconv(.winapi) void;
    const ptr: Fn = funcPtr(0x4F5570, Fn);
    pub inline fn call(mode: c_int, width: *c_int, height: *c_int) void {
        ptr(mode, width, height);
    }
};

pub const GetUiFlag = fastcall(0x4538D0, fn (DWORD) DWORD);

pub const EscMenuShowMenu = fastcall(0x47E090, fn (i32, i32) void);

pub const ImageLoadDC6Ex = fastcall(0x4788B0, fn ([*:0]const u8, DWORD) ?*anyopaque);

// ============================================================================
// Room / Collision — game engine functions for teleport validation
// ============================================================================

/// DRLGROOM_FindBetterNearbyRoom: checks if (x,y) is in pRoom or its adjacent rooms.
/// Returns the room containing (x,y), or NULL if unreachable. This is the exact function
/// the server uses to validate teleport targets.
pub const FindBetterNearbyRoom = fastcall(0x463740, fn (?*Room1, i32, i32) ?*Room1);

/// CheckCollision_BlockAll_Width: checks collision at (x,y) for a unit of given width.
/// Returns COLLIDE_NONE (0) if free, otherwise the blocking flags.
/// collision mask 0x1C09 = PLAYER_COLLISION_DEFAULT (what teleport uses).
pub const CheckCollisionWidth = fastcall(0x64D9B0, fn (?*Room1, i32, i32, u32, u16) u16);

// ============================================================================
// Game entry
// ============================================================================

pub const EnumerateLocalSaves = struct {
    const Fn = *const fn () callconv(.winapi) DWORD;
    const ptr: Fn = funcPtr(0x438F70, Fn);
    pub inline fn call() DWORD {
        return ptr();
    }
};

pub const SelectedCharBnetSingleTcpIp = fastcall(0x434A00, fn (?*D2CharSelStrc, i16, DWORD, [*:0]u8) DWORD);

pub const MainMenuForm = struct {
    const Fn = *const fn () callconv(.c) void;
    const ptr: Fn = funcPtr(0x4336C0, Fn);
    pub inline fn call() void {
        ptr();
    }
};

pub const ClearMessageLoopFlag = struct {
    const Fn = *const fn () callconv(.winapi) BOOL;
    const ptr: Fn = funcPtr(0x4F9190, Fn);
    pub inline fn call() bool {
        return ptr() != 0;
    }
};

// ============================================================================
// Net
// ============================================================================

pub const NET_D2GS_CLIENT_IncomingReturn = struct {
    const Fn = *const fn ([*]u8) callconv(.c) void;
    const ptr: Fn = funcPtr(0x45C900, Fn);
    pub inline fn call(bytes: [*]u8) void {
        ptr(bytes);
    }
};

// ============================================================================
// Dialog (__fastcall)
// ============================================================================

pub const OkDialog = fastcall(0x4331C0, fn ([*:0]const u16, [*:0]const u16, [*:0]const u16, ?*const fn () callconv(.c) void) void);

// ============================================================================
// Automap (__fastcall / __stdcall)
// ============================================================================

pub const NewAutomapCell = fastcall(0x457C30, fn () ?*types.AutomapCell);

pub const AddAutomapCell = fastcall(0x457B00, fn (?*types.AutomapCell, *?*types.AutomapCell) void);

pub const RevealAutomapRoom = struct {
    const Fn = *const fn (?*types.Room1, DWORD, ?*types.AutomapLayer) callconv(.winapi) void;
    const ptr: Fn = funcPtr(0x458F40, Fn);
    pub inline fn call(room1: ?*types.Room1, clip_flag: DWORD, layer: ?*types.AutomapLayer) void {
        ptr(room1, clip_flag, layer);
    }
};

pub const GetAutomapSize = struct {
    const Fn = *const fn () callconv(.winapi) DWORD;
    const ptr: Fn = funcPtr(0x45A710, Fn);
    pub inline fn call() DWORD {
        return ptr();
    }
};

pub const GetLayer = fastcall(0x61E470, fn (DWORD) ?*types.AutomapLayer2);

// ============================================================================
// Mouse offset (__fastcall)
// ============================================================================

pub const GetMouseXOffset = fastcall(0x45AFC0, fn () i32);
pub const GetMouseYOffset = fastcall(0x45AFB0, fn () i32);

// ============================================================================
// Collision (__stdcall / __fastcall)
// ============================================================================

pub const TestCollisionByCoordinates = struct {
    const Fn = *const fn (?*UnitAny, c_int, c_int, DWORD) callconv(.winapi) BOOL;
    const ptr: Fn = funcPtr(0x6229F0, Fn);
    pub inline fn call(unit: ?*UnitAny, x: c_int, y: c_int, flags: DWORD) bool {
        return ptr(unit, x, y, flags) != 0;
    }
};

// ============================================================================
// Net — outgoing packets
// ============================================================================

/// Send a raw packet to the game server.
/// NET_D2GS_CLIENT_Send at 0x478350: size in EDI, pBytes on stack.
pub fn sendPacket(data: []const u8) void {
    const ptr_val = @intFromPtr(data.ptr);
    const len: u32 = @intCast(data.len);
    // Non-standard calling convention: EDI = size, stack arg = data pointer.
    // Callee cleans up 4 bytes from stack (like stdcall with 1 arg).
    asm volatile (
        \\pushl %[data]
        \\call *%[func]
        :
        : [data] "r" (ptr_val),
          [func] "r" (@as(u32, 0x478350)),
          [len] "{edi}" (len),
        : .{ .eax = true, .ecx = true, .edx = true, .memory = true }
    );
}

/// NET_D2GS_CLIENT_Send_SHORT_SHORT at 0x4785d0
/// __fastcall: ECX=packet_id, EDX=x (i16), stack=y (i16)
pub const SendShortShort = fastcall(0x4785D0, fn (u32, i16, i16) void);

/// Cast right skill at world coordinates (packet 0x0C = RightSkillOnLocation).
pub fn sendRightSkillAtLocation(x: u16, y: u16) void {
    SendShortShort.call(.{ 0x0C, @as(i16, @bitCast(x)), @as(i16, @bitCast(y)) });
}

/// Run to location (packet 0x04).
pub fn sendRunToLocation(x: u16, y: u16) void {
    SendShortShort.call(.{ 0x04, @as(i16, @bitCast(x)), @as(i16, @bitCast(y)) });
}

/// NET_D2GS_CLIENT_Send_INT_INT at 0x4786a0
/// __fastcall: ECX=packet_id, EDX=arg1 (x), stack=arg2 (y)
/// Builds 9-byte packet: [u8:id, i32:arg1, i32:arg2]
pub const SendIntInt = fastcall(0x4786A0, fn (u32, i32, i32) void);

/// Cast right skill at world coordinates (packet 0x0C = right skill on location).
pub fn castRightSkillAt(x: u16, y: u16) void {
    SendShortShort.call(.{ 0x0C, @as(i16, @bitCast(x)), @as(i16, @bitCast(y)) });
}

/// Run to location (packet 0x03 = run to location).
pub fn castRunTo(x: u16, y: u16) void {
    SendShortShort.call(.{ 0x03, @as(i16, @bitCast(x)), @as(i16, @bitCast(y)) });
}

// ============================================================================
// Game state control
// ============================================================================

/// D2CLIENT_ExitGame at 0x44DD60 — gracefully leave current game.
/// Sends packet 0x69, sets exit vars, transitions to menu.
pub const ExitGame = fastcall(0x44DD60, fn (i32) void);

/// D2CLIENT_TakeWaypoint — decomposed from INPUT_WaypointMouseUp.
/// Replicates the essential steps that the game performs when the player
/// clicks a waypoint destination, without needing to jump mid-function.
///
/// Steps: send packet 0x49, close waypoint UI, update globals, update UI flags.
pub fn takeWaypoint(waypoint_id: u32, dest_area: u32) void {
    // 1. Send travel packet: 0x49 (waypointTravel), waypointUnitId, destArea
    SendIntInt.call(.{ 0x49, @as(i32, @bitCast(waypoint_id)), @as(i32, @bitCast(dest_area)) });

    // 2. Set "waypoint traveling" flag
    const wp_traveling: *volatile u8 = @ptrFromInt(0x7bf085);
    wp_traveling.* = 1;

    // 3. Close waypoint UI — sends close packet to server
    const WaypointSendClose: *const fn () callconv(.c) void = @ptrFromInt(0x0049c6c0);
    WaypointSendClose();

    // 4. Clear waypoint menu state globals
    const wp_menu_open: *volatile u8 = @ptrFromInt(0x7bf06c);
    const wp_selected_idx: *align(1) volatile i32 = @ptrFromInt(0x7bf06d);
    wp_menu_open.* = 0;
    wp_selected_idx.* = -1;

    // 5. Update UI flag: SetUIFlag(0x14=WAYPOINT, 1=CLOSE, 0)
    //    __fastcall(ECX=eUI, EDX=setType, stack=unknown)
    const SetUIFlag = fastcall(0x00455f20, fn (u32, u32, u32) void);
    SetUIFlag.call(.{ 0x14, 1, 0 });
}

// ============================================================================
// Unit Interaction (client-side)
// ============================================================================

const D2UnderMouseStrc = types.D2UnderMouseStrc;

/// PLAYER_InteractWithObject — handles objects (waypoints, chests, shrines)
/// __cdecl(unitId, pUnderMouse)
/// Checks range, walks to object if needed, then interacts.
const InteractWithObject: *const fn (i32, *D2UnderMouseStrc) callconv(.c) void = @ptrFromInt(0x461890);

/// PLAYER_InteractWithUnit — handles NPCs, other players
/// __cdecl(unitId, pUnderMouse)
/// Checks distance < 3, walks if needed, defers interact.
const InteractWithUnit: *const fn (i32, *D2UnderMouseStrc) callconv(.c) void = @ptrFromInt(0x4619e0);

/// UNITS_FindClientSideUnit — finds a unit by GUID + type in client hash tables
pub const FindClientSideUnit = fastcall(0x461FC0, fn (i32, i32) ?*UnitAny);

/// Interact with a unit using the client-side interaction system.
/// Builds a D2UnderMouseStrc and calls the appropriate handler.
pub fn interactWithUnit(player: *UnitAny, target: *UnitAny) void {
    const pos = target.getPos();
    var under_mouse = D2UnderMouseStrc{
        .flags = 0,
        .pPlayer = player,
        .pTarget = target,
        .nX = @bitCast(pos.x),
        .nY = @bitCast(pos.y),
        .nMoveActionType = 1, // left skill walk
        .nAttackActionType = 2, // left skill interact
        .pSkill = null,
    };

    if (target.dwType == 2) {
        // Objects: waypoints, chests, shrines, portals
        InteractWithObject(@bitCast(target.dwUnitId), &under_mouse);
    } else {
        // NPCs, players, monsters
        InteractWithUnit(@bitCast(target.dwUnitId), &under_mouse);
    }
}

// ============================================================================
// ClickMap / Movement
// ============================================================================

/// ClickMap: __fastcall(clickType, screenX, screenY, flags)
pub const ClickMap = fastcall(0x462D00, fn (i32, i32, i32, u8) void);

/// Viewport offset globals
pub const ViewportX: *i32 = @ptrFromInt(0x7A520C);
pub const ViewportY: *i32 = @ptrFromInt(0x7A5208);

/// Mouse position globals — must be zeroed before ClickMap (d2bs pattern)
pub const MouseX: *i32 = @ptrFromInt(0x7A6AB0);
pub const MouseY: *i32 = @ptrFromInt(0x7A6AAC);

/// Click at world coordinates by converting to screen space.
/// Isometric: screen_x = (wx - wy) * 16, screen_y = (wx + wy) * 8
/// Then subtract viewport offset. Zero mouse before ClickMap (d2bs pattern).
pub fn clickAtWorld(click_type: i32, world_x: i32, world_y: i32) void {
    var sx = (world_x - world_y) * 16;
    var sy = (world_x + world_y) * 8;
    sx -= ViewportX.*;
    sy -= ViewportY.*;
    const saved_mx = MouseX.*;
    const saved_my = MouseY.*;
    MouseX.* = 0;
    MouseY.* = 0;
    ClickMap.call(.{ click_type, sx, sy, 0x08 });
    MouseX.* = saved_mx;
    MouseY.* = saved_my;
}

// ============================================================================
// Skill switching
// ============================================================================

/// Switch skill on a hand. left=true for left, false for right.
/// Packet 0x3C: [u8:0x3C, u32:skillId|leftBit31, u32:ownerId]
pub fn sendSelectSkill(skill_id: u16, left: bool) void {
    var skill_val: u32 = skill_id;
    if (left) skill_val |= 0x80000000;
    var buf: [9]u8 = .{ 0x3C, 0, 0, 0, 0, 0xFF, 0xFF, 0xFF, 0xFF };
    const skill_bytes = @as([4]u8, @bitCast(skill_val));
    buf[1] = skill_bytes[0];
    buf[2] = skill_bytes[1];
    buf[3] = skill_bytes[2];
    buf[4] = skill_bytes[3];
    // bytes 5-8: owner ID = 0xFFFFFFFF for natural skills
    sendPacket(&buf);
}

// ============================================================================
// Quest (__fastcall)
// ============================================================================

/// GetQuestState: check a single quest bit.
/// ECX=pBitBuffer, EDX=questId (0-based), stack=stateId (bit within quest's 16-bit block)
/// Returns 1 if the bit is set, 0 otherwise.
pub const GetQuestState = fastcall(0x0065C310, fn (?*anyopaque, u32, u32) i32);

// ============================================================================
// Portal / Object creation (__fastcall)
// ============================================================================

/// OBJECT_CreateTombPortal: creates the Arcane→Canyon portal.
/// Internally calls SelectUnkownArkaneThingId to pick the right tomb portal class ID.
/// ECX=pGame, EDX=pRoom, stack: nMonStatsId (ignored), nPosX, nPosY, bUseMonStats
pub const CreateTombPortal = fastcall(0x0054F430, fn (?*anyopaque, ?*anyopaque, i32, i32, i32, i32) ?*UnitAny);

/// SERVER_SpawnPortal: creates a portal to any destination level.
/// ECX=pGame, EDX=pUnit, stack: pRoom, nX, nY, eDestLevel, ppPortal (out), nClassId, bIgnore
pub const SpawnPortal = fastcall(0x0056D130, fn (?*anyopaque, ?*UnitAny, ?*anyopaque, i32, i32, i32, ?*?*UnitAny, i32, i32) void);

/// FindSpawnableLocation: scans outward from pPoint for a walkable tile.
/// ECX=pRoom (Room1), EDX=pPoint (in/out POINT*), stack: nScanRadius, eCollisionFlags, ppRoomOut, dwTag, nMaxIter
pub const FindSpawnableLocation = fastcall(0x00545340, fn (?*anyopaque, *[2]i32, u32, u32, *?*anyopaque, u32, i32) void);

// ============================================================================
// Skills (__fastcall / __stdcall)
// ============================================================================

/// GetSkill: returns D2SkillStrc* for a skill on a unit, or null.
/// __unknown calling convention — appears to be fastcall: ECX=pUnit, EDX=eSkill
pub const GetSkill = fastcall(0x00643810, fn (?*UnitAny, i32) ?*anyopaque);

/// GetSkillLevel: returns skill level with or without +skills bonus.
/// __stdcall(pUnit, pSkill, bApplyBonus) → int
pub const GetSkillLevel = struct {
    const Fn = *const fn (?*UnitAny, ?*anyopaque, BOOL) callconv(.winapi) i32;
    const ptr: Fn = funcPtr(0x6442A0, Fn);
    pub inline fn call(unit: ?*UnitAny, skill: ?*anyopaque, apply_bonus: bool) i32 {
        return ptr(unit, skill, if (apply_bonus) 1 else 0);
    }
};

/// GetSkillLevelById: returns effective skill level (with +skills) for a unit.
/// __fastcall: ECX=pUnit, EDX=eSkill → int32_t
pub const GetSkillLevelById = fastcall(0x006447B0, fn (?*UnitAny, i32) i32);

// ============================================================================
// Txt record accessors (__fastcall)
// ============================================================================

/// TXT_MonStats_GetLine: returns pointer to D2MonStatsTxt record (0x1A8 bytes) or null.
/// ECX=nMonStatsId
pub const TxtMonStatsGetLine = fastcall(0x00451F80, fn (i32) ?[*]u8);

/// TXT_Skills_GetLine: returns pointer to D2SkillsTxt record (0x23C bytes) or null.
/// ECX=eSkill
pub const TxtSkillsGetLine = fastcall(0x0045C4B0, fn (i32) ?[*]u8);

/// TEXT_PrintGameString: prints a message in the game chat area.
/// ECX=wMessage (wchar_t*), EDX=nColor
pub const PrintGameString = fastcall(0x0049E3A0, fn ([*:0]const u16, i32) void);

/// TXT_Levels_GetRecord: returns pointer to D2LevelsTxt record or null.
/// stdcall, same as GetLevelText but raw bytes.
pub const TxtLevelsGetLine = struct {
    const Fn = *const fn (DWORD) callconv(.winapi) ?[*]u8;
    const ptr: Fn = funcPtr(0x61DB70, Fn);
    pub inline fn call(level_no: DWORD) ?[*]u8 {
        return ptr(level_no);
    }
};
