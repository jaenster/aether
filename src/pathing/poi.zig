const std = @import("std");
const d2 = struct {
    const types = @import("../d2/types.zig");
    const functions = @import("../d2/functions.zig");
    const globals = @import("../d2/globals.zig");
};
const log = @import("../log.zig");

const Room2 = d2.types.Room2;
const Level = d2.types.Level;
const PresetUnit = d2.types.PresetUnit;

pub const Kind = enum {
    waypoint,
    quest_object,
    super_unique,
    seal,
    portal,
    fixed,
};

pub const POI = struct {
    x: u16,
    y: u16,
    kind: Kind,
    id: u32,
};

pub const MAX_POIS = 64;
var cached_pois: [MAX_POIS]POI = undefined;
var cached_count: u32 = 0;
var cached_level: u32 = 0;

pub fn getPOIs(level_no: u32) []const POI {
    if (level_no == cached_level) {
        return cached_pois[0..cached_count];
    }
    return &.{};
}

pub fn scanLevel() u32 {
    const player = d2.globals.playerUnit().* orelse return 0;
    const path = player.pPath orelse return 0;
    const room1 = path.pRoom1 orelse return 0;
    const room2 = room1.pRoom2 orelse return 0;
    const level = room2.pLevel orelse return 0;
    const level_no = level.dwLevelNo;

    if (level_no == cached_level) return cached_count;

    cached_count = 0;
    cached_level = level_no;

    var room_count: u32 = 0;
    var preset_count: u32 = 0;

    // Walk all Room2s in this level
    var r2 = level.pRoom2First;
    while (r2) |room| : (r2 = room.pRoom2Next) {
        room_count += 1;
        preset_count += scanRoomPresets(room);
    }

    log.hex("poi: rooms scanned=", room_count);
    log.hex("poi: presets seen=", preset_count);
    log.hex("poi: POIs matched=", cached_count);
    return cached_count;
}

fn scanRoomPresets(room2: *Room2) u32 {
    var count: u32 = 0;
    var preset = room2.pPreset;
    while (preset) |unit| : (preset = unit.pPresetNext) {
        const addr = @intFromPtr(unit);
        if (addr < 0x10000 or addr >= 0x7FFFFFFF) return count;
        count += 1;

        const wx: u16 = @intCast(@as(u32, unit.dwPosX) + room2.dwPosX * 5);
        const wy: u16 = @intCast(@as(u32, unit.dwPosY) + room2.dwPosY * 5);

        switch (unit.dwType) {
            1 => { // Monsters (super uniques)
                const cls = classifyMonster(unit.dwTxtFileNo) orelse continue;
                addPOI(wx, wy, cls.kind, unit.dwTxtFileNo);
            },
            2 => { // Objects
                const cls = classifyObject(unit.dwTxtFileNo) orelse continue;
                addPOI(wx, wy, cls.kind, unit.dwTxtFileNo);
            },
            else => {},
        }
    }
    return count;
}

const Classification = struct { kind: Kind };

fn classifyMonster(id: u32) ?Classification {
    return switch (id) {
        250 => .{ .kind = .super_unique }, // Summoner
        256 => .{ .kind = .super_unique }, // Izual
        743, 744, 745 => .{ .kind = .super_unique }, // Act5 super uniques
        else => null,
    };
}

fn classifyObject(id: u32) ?Classification {
    return switch (id) {
        // Waypoints
        119, 145, 156, 157, 237, 238, 288, 323, 324, 398, 402, 429, 494, 496, 511, 539 => .{ .kind = .waypoint },
        // Chaos Sanctuary Seals
        392, 393, 394, 395, 396 => .{ .kind = .seal },
        // Quest objects
        354 => .{ .kind = .quest_object }, // Hellforge
        356 => .{ .kind = .quest_object }, // Khalim Orifice
        357 => .{ .kind = .quest_object }, // Horadric Cube Chest
        // Portals
        569 => .{ .kind = .portal }, // Throne Portal
        else => null,
    };
}

fn addPOI(x: u16, y: u16, kind: Kind, id: u32) void {
    if (cached_count >= MAX_POIS) return;
    cached_pois[cached_count] = .{ .x = x, .y = y, .kind = kind, .id = id };
    cached_count += 1;
}

pub fn invalidate() void {
    cached_count = 0;
    cached_level = 0;
}

pub fn nameForPOI(p: POI) [*:0]const u16 {
    // Object-specific names
    if (p.kind == .seal) {
        return switch (p.id) {
            392 => &toU16("Seal 1"),
            393 => &toU16("Seal 2"),
            394 => &toU16("Seal 3"),
            395 => &toU16("Seal 4"),
            396 => &toU16("Seal 5"),
            else => &toU16("Seal"),
        };
    }
    if (p.kind == .super_unique) {
        return switch (p.id) {
            250 => &toU16("Summoner"),
            256 => &toU16("Izual"),
            743 => &toU16("Shenk"),
            744 => &toU16("Eldritch"),
            745 => &toU16("Eyeback"),
            else => &toU16("Boss"),
        };
    }
    if (p.kind == .quest_object) {
        return switch (p.id) {
            354 => &toU16("Hellforge"),
            356 => &toU16("Orifice"),
            357 => &toU16("Cube Chest"),
            else => &toU16("Quest"),
        };
    }
    if (p.kind == .portal) {
        return switch (p.id) {
            569 => &toU16("Throne"),
            else => &toU16("Portal"),
        };
    }
    return switch (p.kind) {
        .waypoint => &toU16("Waypoint"),
        .fixed => &toU16("Target"),
        else => &toU16("POI"),
    };
}

fn toU16(comptime s: []const u8) [s.len:0]u16 {
    var result: [s.len:0]u16 = undefined;
    for (s, 0..) |c, i| result[i] = c;
    return result;
}
