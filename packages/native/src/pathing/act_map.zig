// act_map.zig — Zig translation of d2bs ActMap.cpp / ActMap.h
// All coordinates are absolute world coords.

const d2 = struct {
    const types = @import("../d2/types.zig");
    const functions = @import("../d2/functions.zig");
};
const log = @import("../log.zig");

const Act = d2.types.Act;
const Level = d2.types.Level;
const Room1 = d2.types.Room1;
const Room2 = d2.types.Room2;
const CollMap = d2.types.CollMap;
const PresetUnit = d2.types.PresetUnit;
const RoomTile = d2.types.RoomTile;
const ActMisc = d2.types.ActMisc;
const WORD = d2.types.WORD;
const DWORD = d2.types.DWORD;

// ── Collision flags (from ActMap::CollisionFlag) ──

pub const CollisionFlag = struct {
    pub const None: u16 = 0x0000;
    pub const BlockWalk: u16 = 0x0001;
    pub const BlockLineOfSight: u16 = 0x0002;
    pub const Wall: u16 = 0x0004;
    pub const BlockPlayer: u16 = 0x0008;
    pub const AlternateTile: u16 = 0x0010;
    pub const Blank: u16 = 0x0020;
    pub const Missile: u16 = 0x0040;
    pub const Player: u16 = 0x0080;
    pub const NPCLocation: u16 = 0x0100;
    pub const Item: u16 = 0x0200;
    pub const Object: u16 = 0x0400;
    pub const ClosedDoor: u16 = 0x0800;
    pub const NPCCollision: u16 = 0x1000;
    pub const FriendlyNPC: u16 = 0x2000;
    pub const Unknown: u16 = 0x4000;
    pub const DeadBody: u16 = 0x8000;
    pub const Avoid: u16 = 0xffff;
    pub const Special: u16 = 0xf000;
};

// ── Exit types ──

pub const ExitType = enum { linkage, tile };

pub const Exit = struct {
    target: u32,
    x: u16,
    y: u16,
    exit_type: ExitType,
    tile_id: u32,
};

// ── Point helper (used internally for edge walking) ──

const Point = struct {
    x: i32,
    y: i32,
};

// ── Module-level state (class members) ──

var act: ?*Act = null;
pub var level: ?*Level = null;

pub var pos_x: u32 = 0;
pub var pos_y: u32 = 0;
pub var width: u32 = 0; // level.dwSizeY * 5
pub var height: u32 = 0; // level.dwSizeX * 5

// ── Fixed-size caches (replacing std::list) ──

var room_cache: [64]?*Room2 = .{null} ** 64;
var room_cache_len: u32 = 0;

var level_cache: [16]?*Level = .{null} ** 16;
var level_cache_len: u32 = 0;

var rooms_added: [256]?*Room2 = .{null} ** 256;
var rooms_added_len: u32 = 0;

// ── init (constructor equivalent) ──

pub fn init(a: *Act, lvl: *Level) void {
    log.print("act_map: init start");
    act = a;
    level = lvl;

    // d2bs: height = level->dwSizeX * 5;  width = level->dwSizeY * 5;
    height = lvl.dwSizeX * 5;
    width = lvl.dwSizeY * 5;
    pos_x = lvl.dwPosX * 5;
    pos_y = lvl.dwPosY * 5;

    if (lvl.pRoom2First == null) {
        d2.functions.InitLevel.call(lvl);
    }

    // d2bs recalculates posX/posY after InitLevel, checking for -1 (0xFFFFFFFF unsigned)
    pos_x = if (lvl.dwPosX == 0xFFFFFFFF) 0 else lvl.dwPosX * 5;
    pos_y = if (lvl.dwPosY == 0xFFFFFFFF) 0 else lvl.dwPosY * 5;

    log.hex("act_map: init pos_x=", pos_x);
    log.hex("act_map: init pos_y=", pos_y);
    log.hex("act_map: init width=", width);
    log.hex("act_map: init height=", height);

    // clear caches
    room_cache_len = 0;
    level_cache_len = 0;
    rooms_added_len = 0;
}

// ── cleanup (RemoveRoomData all added rooms, clear caches) ──

pub fn cleanup() void {
    // Don't call RemoveRoomData here — room pointers may be stale
    // after a level change. The game cleans up rooms on level unload.
    rooms_added_len = 0;
    level_cache_len = 0;
    room_cache_len = 0;
    act = null;
    level = null;
}

// ── getTileLevelNo ──

fn getTileLevelNo(room: *Room2, tile_no: u32) u32 {
    var tile_it = room.pRoomTiles;
    while (tile_it) |t| : (tile_it = t.pNext) {
        if (t.nNum) |n| {
            if (n.* == tile_no) {
                if (t.pRoom2) |r2| {
                    if (r2.pLevel) |lvl| return lvl.dwLevelNo;
                }
            }
        }
    }
    return 0;
}

// ── addRoomData / removeRoomData wrappers ──

fn addRoomData(room: *Room2) void {
    const lvl = room.pLevel orelse return;
    const a = act orelse return;
    d2.functions.AddRoomData.call(a, @intCast(lvl.dwLevelNo), @intCast(room.dwPosX), @intCast(room.dwPosY), null);
}

fn removeRoomData(room: *Room2) void {
    const r1 = room.pRoom1 orelse return;
    const lvl = room.pLevel orelse return;
    const a = act orelse return;
    d2.functions.RemoveRoomData.call(a, @intCast(lvl.dwLevelNo), @intCast(room.dwPosX), @intCast(room.dwPosY), r1);
}

// ── isPointInRoom ──

fn isPointInRoom(room: *const Room2, px: u32, py: u32) bool {
    const rx = room.dwPosX * 5;
    const ry = room.dwPosY * 5;
    return (px >= rx and py >= ry and px < rx + room.dwSizeX * 5 and py < ry + room.dwSizeY * 5);
}

// ── isPointInLevel ──

fn isPointInLevel(lvl: *const Level, px: u32, py: u32) bool {
    const lx = lvl.dwPosX * 5;
    const ly = lvl.dwPosY * 5;
    return (px >= lx and py >= ly and px < lx + lvl.dwSizeX * 5 and py < ly + lvl.dwSizeY * 5);
}

// ── getCollFromRoom ──

fn getCollFromRoom(room: *Room2, px: u32, py: u32) u16 {
    if (room.pRoom1 == null) {
        addRoomData(room);
        if (rooms_added_len < rooms_added.len) {
            rooms_added[rooms_added_len] = room;
            rooms_added_len += 1;
        }
    }
    const room1 = room.pRoom1 orelse return CollisionFlag.Avoid;
    const coll = room1.pColl orelse return CollisionFlag.Avoid;
    const map_start = coll.pMapStart orelse return CollisionFlag.Avoid;

    if (py < coll.dwPosGameY or px < coll.dwPosGameX) return CollisionFlag.Avoid;
    const dy = py - coll.dwPosGameY;
    const dx = px - coll.dwPosGameX;
    if (dy >= coll.dwSizeGameY or dx >= coll.dwSizeGameX) return CollisionFlag.Avoid;
    const offset = dy * coll.dwSizeGameX + dx;
    return map_start[offset];
}

// ── getMapData ──
// d2bs pattern: roomCache check -> level check (this->level, then levelCache, then act walk) -> room walk

pub fn getMapData(px_i: i32, py_i: i32) u16 {
    if (px_i < 0 or py_i < 0) return CollisionFlag.Avoid;
    const px: u32 = @intCast(px_i);
    const py: u32 = @intCast(py_i);
    // check rooms we already read
    {
        var i: u32 = 0;
        while (i < room_cache_len) : (i += 1) {
            if (room_cache[i]) |room| {
                if (isPointInRoom(room, px, py)) {
                    return getCollFromRoom(room, px, py);
                }
            }
        }
    }

    // find which level this point belongs to
    var curr_level: ?*Level = null;

    if (level) |lvl| {
        if (isPointInLevel(lvl, px, py)) {
            curr_level = lvl;
        }
    }

    if (curr_level == null) {
        var j: u32 = 0;
        while (j < level_cache_len) : (j += 1) {
            if (level_cache[j]) |lvl| {
                if (isPointInLevel(lvl, px, py)) {
                    curr_level = lvl;
                    break;
                }
            }
        }
    }

    const a = act orelse {
        log.print("ActMap Level Not Loaded (no act)");
        return CollisionFlag.Avoid;
    };
    if (a.pMisc == null or a.pRoom1 == null) {
        log.print("ActMap Level Not Loaded");
        return CollisionFlag.Avoid;
    }

    if (curr_level == null) {
        const misc = a.pMisc orelse return CollisionFlag.Avoid;
        var lvl_it = misc.pLevelFirst;
        while (lvl_it) |lvl| : (lvl_it = lvl.pNextLevel) {
            if (isPointInLevel(lvl, px, py)) {
                if (lvl.pRoom2First == null) {
                    d2.functions.InitLevel.call(lvl);
                }
                // push_front into level_cache
                if (level_cache_len < level_cache.len) {
                    var k: u32 = level_cache_len;
                    while (k > 0) : (k -= 1) {
                        level_cache[k] = level_cache[k - 1];
                    }
                    level_cache[0] = lvl;
                    level_cache_len += 1;
                }
                curr_level = lvl;
                break;
            }
        }
    }

    const found_level = curr_level orelse return CollisionFlag.Avoid;

    // walk rooms in found level
    var room_it = found_level.pRoom2First;
    while (room_it) |room| : (room_it = room.pRoom2Next) {
        if (isPointInRoom(room, px, py)) {
            // push_front into room_cache
            if (room_cache_len < room_cache.len) {
                var k: u32 = room_cache_len;
                while (k > 0) : (k -= 1) {
                    room_cache[k] = room_cache[k - 1];
                }
                room_cache[0] = room;
                room_cache_len += 1;
            }
            return getCollFromRoom(room, px, py);
        }
    }

    return CollisionFlag.Avoid;
}

// ── checkFlag ──

fn checkFlag(flag: u16, val: u16) bool {
    return (val & flag) == flag;
}

// ── spaceGetData: 5-point cross (center | N | S | E | W) ──

pub fn spaceGetData(px: i32, py: i32) u16 {
    return getMapData(px, py) |
        getMapData(px - 1, py) |
        getMapData(px + 1, py) |
        getMapData(px, py - 1) |
        getMapData(px, py + 1);
}

// ── spaceGetDataWide: +/- 2 cross ──

pub fn spaceGetDataWide(px: i32, py: i32) u16 {
    return getMapData(px, py) |
        getMapData(px - 2, py) |
        getMapData(px + 2, py) |
        getMapData(px, py - 2) |
        getMapData(px, py + 2);
}

// ── spaceHasFlag ──

fn spaceHasFlag(flag: u16, px: i32, py: i32) bool {
    const val = spaceGetData(px, py);
    return checkFlag(flag, val);
}

// ── isBlocked (SpaceIsWalkable negated) ──

pub fn isBlocked(px: i32, py: i32) bool {
    const val = spaceGetData(px, py);
    return checkFlag(CollisionFlag.Avoid, val) or
        checkFlag(CollisionFlag.BlockWalk, val) or
        checkFlag(CollisionFlag.BlockPlayer, val) or
        checkFlag(CollisionFlag.NPCCollision, val) or
        checkFlag(CollisionFlag.Object, val);
}

// ── spaceIsWalkableForExit ──

pub fn spaceIsWalkableForExit(px: i32, py: i32) bool {
    return !(spaceHasFlag(CollisionFlag.Avoid, px, py) or
        spaceHasFlag(CollisionFlag.BlockWalk, px, py) or
        spaceHasFlag(CollisionFlag.BlockPlayer, px, py));
}

// ── isValidPoint ──

pub fn isValidPoint(px: i32, py: i32) bool {
    if (px < 0 or py < 0) return false;
    const upx: u32 = @intCast(px);
    const upy: u32 = @intCast(py);
    if (upx < pos_x or upy < pos_y) return false;
    const rx = upx - pos_x;
    const ry = upy - pos_y;
    return (rx < height and ry < width);
}

// ── edgeIsWalkable ──
// Checks 4 points straddling the area-crossing edge:
//   distanceLocal = -1 (k=-1,0 -> local side)
//   distanceAdjacent = 2 (k=1,2 -> adjacent side)

fn edgeIsWalkable(edge_x: i32, edge_y: i32, offset_x: i32, offset_y: i32) bool {
    const distance_local: i32 = -1;
    const distance_adjacent: i32 = 2;
    var k: i32 = distance_local;
    while (k <= distance_adjacent) : (k += 1) {
        if (k <= 0) {
            const factor = distance_local - k;
            const cx = edge_x + offset_x * factor;
            const cy = edge_y + offset_y * factor;
            if (!spaceIsWalkableForExit(cx, cy)) break;
        } else {
            const cx = edge_x + offset_x * k;
            const cy = edge_y + offset_y * k;
            if (!spaceIsWalkableForExit(cx, cy)) break;
        }
    }
    return k > distance_adjacent;
}

// ── getEdgeCenterPoint ──

fn getEdgeCenterPoint(cur_x: i32, cur_y: i32, edge_dx: i32, edge_dy: i32) Point {
    var left_x: i32 = cur_x;
    var left_y: i32 = cur_y;
    var right_x: i32 = cur_x;
    var right_y: i32 = cur_y;

    // walk backwards
    {
        var sx: i32 = cur_x;
        var sy: i32 = cur_y;
        var i: i32 = -1;
        while (isValidPoint(sx, sy)) : (i -= 1) {
            if (spaceIsWalkableForExit(sx, sy)) {
                left_x = sx;
                left_y = sy;
            }
            sx = cur_x + edge_dx * i;
            sy = cur_y + edge_dy * i;
        }
    }

    // walk forwards
    {
        var sx: i32 = cur_x;
        var sy: i32 = cur_y;
        var i: i32 = 1;
        while (isValidPoint(sx, sy)) : (i += 1) {
            if (spaceIsWalkableForExit(sx, sy)) {
                right_x = sx;
                right_y = sy;
            }
            sx = cur_x + edge_dx * i;
            sy = cur_y + edge_dy * i;
        }
    }

    return .{
        .x = @divTrunc(left_x + right_x, 2),
        .y = @divTrunc(left_y + right_y, 2),
    };
}

// ── exit helpers ──

fn exitExistsAtPos(buf: []const Exit, count: u32, px: u16, py: u16) bool {
    var i: u32 = 0;
    while (i < count) : (i += 1) {
        if (buf[i].x == px and buf[i].y == py) return true;
    }
    return false;
}

fn exitExistsForLevel(buf: []const Exit, count: u32, level_no: u32) bool {
    var i: u32 = 0;
    while (i < count) : (i += 1) {
        if (buf[i].target == level_no) return true;
    }
    return false;
}

// ── findRoomTileExits ──

fn findRoomTileExits(room: *Room2, buf: []Exit, count: *u32) void {
    var preset_it = room.pPreset;
    while (preset_it) |preset| : (preset_it = preset.pPresetNext) {
        if (preset.dwType == 5) { // UNIT_TILE
            const level_id = getTileLevelNo(room, preset.dwTxtFileNo);
            if (level_id != 0) {
                const loc_x: u16 = @intCast(room.dwPosX * 5 + preset.dwPosX);
                const loc_y: u16 = @intCast(room.dwPosY * 5 + preset.dwPosY);

                if (!exitExistsAtPos(buf, count.*, loc_x, loc_y)) {
                    if (count.* < buf.len) {
                        buf[count.*] = .{
                            .target = level_id,
                            .x = loc_x,
                            .y = loc_y,
                            .exit_type = .tile,
                            .tile_id = preset.dwTxtFileNo,
                        };
                        count.* += 1;
                    }
                }
            }
        }
    }
}

// ── ExitCandidate for linkage multimap emulation ──

const ExitCandidate = struct {
    level_no: u32,
    center_x: i32,
    center_y: i32,
    mid_x: i32,
    mid_y: i32,
    size: i32,
};

fn candidateDistance(c: ExitCandidate) f64 {
    const dx: f64 = @floatFromInt(c.center_x - c.mid_x);
    const dy: f64 = @floatFromInt(c.center_y - c.mid_y);
    return @sqrt(dx * dx + dy * dy);
}

// ── findRoomLinkageExits ──

fn findRoomLinkageExits(buf: []Exit, count: *u32) void {
    const lvl = level orelse return;
    const my_level_no = lvl.dwLevelNo;

    var candidates: [256]ExitCandidate = undefined;
    var candidate_count: u32 = 0;

    var room_it = lvl.pRoom2First;
    while (room_it) |room| : (room_it = room.pRoom2Next) {
        const rooms_near = room.pRoom2Near orelse continue;
        var i: u32 = 0;
        while (i < room.dwRoomsNear) : (i += 1) {
            const near_room = @as([*]?*Room2, @ptrCast(rooms_near))[i] orelse continue;
            const near_level = near_room.pLevel orelse continue;
            if (near_level.dwLevelNo == my_level_no) continue;

            // does this link already exist as a tile exit?
            if (exitExistsForLevel(buf, count.*, near_level.dwLevelNo)) continue;

            // AABB: A,B = local room corners, X,Y = adjacent room corners
            const ax: i32 = @intCast(room.dwPosX * 5);
            const ay: i32 = @intCast(room.dwPosY * 5);
            const bx: i32 = @intCast(room.dwPosX * 5 + room.dwSizeX * 5);
            const by: i32 = @intCast(room.dwPosY * 5 + room.dwSizeY * 5);

            const xx: i32 = @intCast(near_room.dwPosX * 5);
            const xy: i32 = @intCast(near_room.dwPosY * 5);
            const yx: i32 = @intCast(near_room.dwPosX * 5 + near_room.dwSizeX * 5);
            const yy: i32 = @intCast(near_room.dwPosY * 5 + near_room.dwSizeY * 5);

            const overlapping_x = @min(bx, yx) - @max(ax, xx);
            const overlapping_y = @min(by, yy) - @max(ay, xy);

            if (overlapping_x < 0 or overlapping_y < 0) continue;
            if (overlapping_x > 0 and overlapping_y > 0) continue;
            if (overlapping_x < 3 and overlapping_y < 3) continue;

            var start_x: i32 = 0;
            var start_y: i32 = 0;
            var start_left = false;
            var start_right = false;
            var start_top = false;
            var start_bottom = false;

            if (overlapping_x > 0) {
                if (ay < xy) {
                    start_x = @max(ax, xx);
                    start_y = by - 1;
                    start_bottom = true;
                } else {
                    start_x = @max(ax, xx);
                    start_y = ay;
                    start_top = true;
                }
            } else if (overlapping_y > 0) {
                if (ax < xx) {
                    start_x = bx - 1;
                    start_y = @max(ay, xy);
                    start_right = true;
                } else {
                    start_x = ax;
                    start_y = @max(ay, xy);
                    start_left = true;
                }
            }

            var edge_dx: i32 = undefined;
            var edge_dy: i32 = undefined;
            var ortho_dx: i32 = undefined;
            var ortho_dy: i32 = undefined;
            var edge_size: i32 = undefined;

            if (start_left or start_right) {
                edge_size = overlapping_y;
                edge_dx = 0;
                edge_dy = 1;
                ortho_dx = if (start_left) @as(i32, -1) else @as(i32, 1);
                ortho_dy = 0;
            } else {
                edge_size = overlapping_x;
                edge_dx = 1;
                edge_dy = 0;
                ortho_dx = 0;
                ortho_dy = if (start_top) @as(i32, -1) else @as(i32, 1);
            }

            var last_walkable_x: i32 = 0;
            var last_walkable_y: i32 = 0;
            var spaces: i32 = 0;
            var j: i32 = 0;
            while (j < edge_size) : (j += 1) {
                const cur_x = start_x + j * edge_dx;
                const cur_y = start_y + j * edge_dy;

                const walkable = edgeIsWalkable(cur_x, cur_y, ortho_dx, ortho_dy);

                if (walkable) {
                    last_walkable_x = cur_x;
                    last_walkable_y = cur_y;
                    spaces += 1;
                }

                if (!walkable or j + 1 == edge_size) {
                    if (spaces > 0 and candidate_count < candidates.len) {
                        const center = getEdgeCenterPoint(cur_x, cur_y, edge_dx, edge_dy);
                        candidates[candidate_count] = .{
                            .level_no = near_level.dwLevelNo,
                            .center_x = center.x,
                            .center_y = center.y,
                            .mid_x = last_walkable_x - edge_dx * @divTrunc(spaces, 2),
                            .mid_y = last_walkable_y - edge_dy * @divTrunc(spaces, 2),
                            .size = spaces,
                        };
                        candidate_count += 1;
                    }
                    spaces = 0;
                }
            }
        }
    }

    if (candidate_count == 0) return;

    // sort candidates by level_no (insertion sort)
    {
        var si: u32 = 1;
        while (si < candidate_count) : (si += 1) {
            const key = candidates[si];
            var sj: u32 = si;
            while (sj > 0 and candidates[sj - 1].level_no > key.level_no) : (sj -= 1) {
                candidates[sj] = candidates[sj - 1];
            }
            candidates[sj] = key;
        }
    }

    // iterate groups by level_no, pick best (min distance center->midpoint)
    var idx: u32 = 0;
    while (idx < candidate_count) {
        const cur_level_no = candidates[idx].level_no;
        var best_idx: u32 = idx;
        var best_dist: f64 = candidateDistance(candidates[idx]);

        var next = idx + 1;
        while (next < candidate_count and candidates[next].level_no == cur_level_no) : (next += 1) {
            const d = candidateDistance(candidates[next]);
            if (d < best_dist) {
                best_dist = d;
                best_idx = next;
            }
        }

        if (count.* < buf.len) {
            const c = candidates[best_idx];
            // Push 5 tiles into the target area (away from border)
            const offset_x = c.center_x - c.mid_x;
            const offset_y = c.center_y - c.mid_y;
            const norm: i32 = @intCast(@max(@abs(offset_x), @abs(offset_y)));
            const push: i32 = 5;
            const into_x: i32 = if (norm > 0) c.mid_x + @divTrunc(offset_x * push, norm) else c.mid_x;
            const into_y: i32 = if (norm > 0) c.mid_y + @divTrunc(offset_y * push, norm) else c.mid_y;
            buf[count.*] = .{
                .target = c.level_no,
                .x = @intCast(into_x),
                .y = @intCast(into_y),
                .exit_type = .linkage,
                .tile_id = 0,
            };
            count.* += 1;
        }

        idx = next;
    }
}

// ── getExits ──

pub fn getExits(buf: []Exit) u32 {
    log.print("act_map: getExits start");
    const lvl = level orelse return 0;
    const my_level_no = lvl.dwLevelNo;

    var local_added: [256]?*Room2 = .{null} ** 256;
    var local_added_len: u32 = 0;
    var exit_count: u32 = 0;

    var room_it = lvl.pRoom2First;
    while (room_it) |room| : (room_it = room.pRoom2Next) {
        if (room.pRoom1 == null) {
            addRoomData(room);
            if (local_added_len < local_added.len) {
                local_added[local_added_len] = room;
                local_added_len += 1;
            }
        }

        const room_level = room.pLevel orelse continue;
        if (room_level.dwLevelNo != my_level_no) continue;

        findRoomTileExits(room, buf, &exit_count);
    }

    log.hex("act_map: tile exits=", exit_count);
    findRoomLinkageExits(buf, &exit_count);
    log.hex("act_map: total exits=", exit_count);

    // remove locally added rooms
    {
        var ri: u32 = 0;
        while (ri < local_added_len) : (ri += 1) {
            if (local_added[ri]) |room| {
                removeRoomData(room);
            }
        }
    }

    return exit_count;
}
