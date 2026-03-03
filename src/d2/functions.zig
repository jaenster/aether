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
const WINAPI = @import("std").os.windows.WINAPI;

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

pub fn argToU32(comptime T: type, val: T) u32 {
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

pub fn u32ToRet(comptime T: type, raw: u32) T {
    return switch (@typeInfo(T)) {
        .pointer => @ptrFromInt(raw),
        .optional => |opt| switch (@typeInfo(opt.child)) {
            .pointer => if (raw == 0) null else @ptrFromInt(raw),
            else => @bitCast(raw),
        },
        .int => @bitCast(raw),
        .bool => raw != 0,
        else => @compileError("unsupported return type for fastcall: " ++ @typeName(T)),
    };
}

/// Build the inline asm string for an N-arg fastcall.
/// Reads args from a u32 array pointed to by %[buf].
/// Sets ECX from buf[0], EDX from buf[1], pushes buf[N-1]..buf[2].
pub fn buildFastcallAsm(comptime n: usize) []const u8 {
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
                    : "ecx", "edx", "memory"
                );
                return u32ToRet(RetType, raw);
            } else {
                asm volatile (asm_str
                    :
                    : [buf] "r" (&buf),
                      [func] "r" (addr),
                    : "eax", "ecx", "edx", "memory"
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
    const Fn = *const fn (c_int, c_int, c_int, c_int, DWORD, DWORD) callconv(WINAPI) void;
    const ptr: Fn = funcPtr(0x4F6380, Fn);
    pub inline fn call(x0: c_int, y0: c_int, x1: c_int, y1: c_int, color: DWORD, alpha: DWORD) void {
        ptr(x0, y0, x1, y1, color, alpha);
    }
};

pub const DrawRect = struct {
    const Fn = *const fn (*RECT, u8) callconv(WINAPI) void;
    const ptr: Fn = funcPtr(0x4F62A0, Fn);
    pub inline fn call(rect: *RECT, palette_idx: u8) void {
        ptr(rect, palette_idx);
    }
};

pub const DrawSolidRectAlpha = struct {
    const Fn = *const fn (c_int, c_int, c_int, c_int, DWORD, DWORD) callconv(WINAPI) void;
    const ptr: Fn = funcPtr(0x4F6340, Fn);
    pub inline fn call(x0: c_int, y0: c_int, x1: c_int, y1: c_int, color: DWORD, alpha: DWORD) void {
        ptr(x0, y0, x1, y1, color, alpha);
    }
};

pub const DrawImage = struct {
    const Fn = *const fn (?*anyopaque, c_int, c_int, c_int, DWORD, ?*anyopaque) callconv(WINAPI) void;
    const ptr: Fn = funcPtr(0x4F6480, Fn);
    pub inline fn call(dc6_ctx: ?*anyopaque, x: c_int, y: c_int, gamma: c_int, mode: DWORD, palette: ?*anyopaque) void {
        ptr(dc6_ctx, x, y, gamma, mode, palette);
    }
};

// ============================================================================
// Units (__stdcall)
// ============================================================================

pub const GetUnitStat = struct {
    const Fn = *const fn (?*UnitAny, DWORD, DWORD) callconv(WINAPI) DWORD;
    const ptr: Fn = funcPtr(0x625480, Fn);
    pub inline fn call(unit: ?*UnitAny, stat: DWORD, stat2: DWORD) DWORD {
        return ptr(unit, stat, stat2);
    }
};

pub const GetUnitState = struct {
    const Fn = *const fn (?*UnitAny, DWORD) callconv(WINAPI) c_int;
    const ptr: Fn = funcPtr(0x639DF0, Fn);
    pub inline fn call(unit: ?*UnitAny, state_no: DWORD) c_int {
        return ptr(unit, state_no);
    }
};

pub const UnitLocation = struct {
    const Fn = *const fn (?*UnitAny, *POINT) callconv(WINAPI) void;
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
    const Fn = *const fn (?*Act, c_int, c_int, c_int, ?*Room1) callconv(WINAPI) void;
    const ptr: Fn = funcPtr(0x61A070, Fn);
    pub inline fn call(act: ?*Act, level_id: c_int, x: c_int, y: c_int, room: ?*Room1) void {
        ptr(act, level_id, x, y, room);
    }
};

pub const RemoveRoomData = struct {
    const Fn = *const fn (?*Act, c_int, c_int, c_int, ?*Room1) callconv(WINAPI) void;
    const ptr: Fn = funcPtr(0x61A0C0, Fn);
    pub inline fn call(act: ?*Act, level_id: c_int, x: c_int, y: c_int, room: ?*Room1) void {
        ptr(act, level_id, x, y, room);
    }
};

pub const InitLevel = struct {
    const Fn = *const fn (?*Level) callconv(WINAPI) void;
    const ptr: Fn = funcPtr(0x6424A0, Fn);
    pub inline fn call(level: ?*Level) void {
        ptr(level);
    }
};

pub const GetLevelText = struct {
    const Fn = *const fn (DWORD) callconv(WINAPI) ?*LevelTxt;
    const ptr: Fn = funcPtr(0x61DB70, Fn);
    pub inline fn call(level_no: DWORD) ?*LevelTxt {
        return ptr(level_no);
    }
};

pub const GetObjectText = struct {
    const Fn = *const fn (DWORD) callconv(WINAPI) ?*ObjectTxt;
    const ptr: Fn = funcPtr(0x640E90, Fn);
    pub inline fn call(obj_no: DWORD) ?*ObjectTxt {
        return ptr(obj_no);
    }
};

pub const GetItemText = struct {
    const Fn = *const fn (DWORD) callconv(WINAPI) ?*ItemTxt;
    const ptr: Fn = funcPtr(0x6335F0, Fn);
    pub inline fn call(item_no: DWORD) ?*ItemTxt {
        return ptr(item_no);
    }
};

pub const GetAct = struct {
    const Fn = *const fn (c_int) callconv(WINAPI) DWORD;
    const ptr: Fn = funcPtr(0x6427F0, Fn);
    pub inline fn call(level_id: c_int) DWORD {
        return ptr(level_id);
    }
};

// ============================================================================
// Screen (__stdcall)
// ============================================================================

pub const GetScreenMode = struct {
    const Fn = *const fn () callconv(WINAPI) DWORD;
    const ptr: Fn = funcPtr(0x4F5160, Fn);
    pub inline fn call() DWORD {
        return ptr();
    }
};

pub const GetScreenModeSize = struct {
    const Fn = *const fn (c_int, *c_int, *c_int) callconv(WINAPI) void;
    const ptr: Fn = funcPtr(0x4F5570, Fn);
    pub inline fn call(mode: c_int, width: *c_int, height: *c_int) void {
        ptr(mode, width, height);
    }
};

pub const GetUiFlag = fastcall(0x4538D0, fn (DWORD) DWORD);

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
    const Fn = *const fn () callconv(WINAPI) DWORD;
    const ptr: Fn = funcPtr(0x438F70, Fn);
    pub inline fn call() DWORD {
        return ptr();
    }
};

pub const SelectedCharBnetSingleTcpIp = fastcall(0x434A00, fn (?*D2CharSelStrc, i16, DWORD, [*:0]u8) DWORD);

pub const MainMenuForm = struct {
    const Fn = *const fn () callconv(.C) void;
    const ptr: Fn = funcPtr(0x4336C0, Fn);
    pub inline fn call() void {
        ptr();
    }
};

pub const ClearMessageLoopFlag = struct {
    const Fn = *const fn () callconv(WINAPI) BOOL;
    const ptr: Fn = funcPtr(0x4F9190, Fn);
    pub inline fn call() bool {
        return ptr() != 0;
    }
};

// ============================================================================
// Net
// ============================================================================

pub const NET_D2GS_CLIENT_IncomingReturn = struct {
    const Fn = *const fn ([*]u8) callconv(.C) void;
    const ptr: Fn = funcPtr(0x45C900, Fn);
    pub inline fn call(bytes: [*]u8) void {
        ptr(bytes);
    }
};

// ============================================================================
// Dialog (__fastcall)
// ============================================================================

pub const OkDialog = fastcall(0x4331C0, fn ([*:0]const u16, [*:0]const u16, [*:0]const u16, ?*const fn () callconv(.C) void) void);

// ============================================================================
// Automap (__fastcall / __stdcall)
// ============================================================================

pub const NewAutomapCell = fastcall(0x457C30, fn () ?*types.AutomapCell);

pub const AddAutomapCell = fastcall(0x457B00, fn (?*types.AutomapCell, *?*types.AutomapCell) void);

pub const RevealAutomapRoom = struct {
    const Fn = *const fn (?*types.Room1, DWORD, ?*types.AutomapLayer) callconv(WINAPI) void;
    const ptr: Fn = funcPtr(0x458F40, Fn);
    pub inline fn call(room1: ?*types.Room1, clip_flag: DWORD, layer: ?*types.AutomapLayer) void {
        ptr(room1, clip_flag, layer);
    }
};

pub const GetAutomapSize = struct {
    const Fn = *const fn () callconv(WINAPI) DWORD;
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
    const Fn = *const fn (?*UnitAny, c_int, c_int, DWORD) callconv(WINAPI) BOOL;
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
        : "eax", "ecx", "edx", "memory"
    );
}

/// NET_D2GS_CLIENT_Send_SHORT_SHORT at 0x4785d0
/// __fastcall: ECX=packet_id, EDX=x (i16), stack=y (i16)
pub const SendShortShort = fastcall(0x4785D0, fn (u32, i16, i16) void);

/// Cast right skill at world coordinates (packet 0x16).
pub fn sendRightSkillAtLocation(x: u16, y: u16) void {
    SendShortShort.call(.{ 0x16, @as(i16, @bitCast(x)), @as(i16, @bitCast(y)) });
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
// ClickMap / Movement
// ============================================================================

/// ClickMap: __fastcall(clickType, screenX, screenY, flags)
pub const ClickMap = fastcall(0x462D00, fn (i32, i32, i32, u8) void);

/// DRLG_WorldToScreenShift5 — transforms world coords to absolute screen coords in-place.
/// Isometric: x = worldX - worldY, y = (worldX + worldY) / 2
pub const MapToAbsScreen = fastcall(0x643510, fn (*i32, *i32) void);

/// Viewport offset globals (MouseXOffset / MouseYOffset)
pub const ViewportX: *i32 = @ptrFromInt(0x7A520C);
pub const ViewportY: *i32 = @ptrFromInt(0x7A5208);

/// Click at world coordinates by converting to screen space.
pub fn clickAtWorld(click_type: i32, world_x: i32, world_y: i32) void {
    var sx = world_x;
    var sy = world_y;
    MapToAbsScreen.call(.{ &sx, &sy });
    sx -= ViewportX.*;
    sy -= ViewportY.*;
    ClickMap.call(.{ click_type, sx, sy, 0 });
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
