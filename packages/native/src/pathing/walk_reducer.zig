const std = @import("std");
const act_map = @import("act_map.zig");
const astar = @import("astar.zig");
const Point = astar.Point;

// Collision flags (from Ghidra + d2bs SpaceIsWalkable)
const BlockWalk: u16 = 0x0001;
const BlockPlayer: u16 = 0x0008;
const Object: u16 = 0x0400;
const ClosedDoor: u16 = 0x0800;
const NPCCollision: u16 = 0x1000;
const WALK_COLLISION: u16 = BlockWalk | BlockPlayer | Object | NPCCollision; // matches SpaceIsWalkable

// range = _range * 10, default _range = 20
const range: i32 = 200;

pub const MAX_WAYPOINTS: u32 = 256;
pub var waypoints: [MAX_WAYPOINTS]Point = undefined;
pub var waypoint_count: u32 = 0;

fn checkFlag(flag: u16) bool {
    return (WALK_COLLISION & flag) > 0;
}

fn slope(start: Point, end: Point) i32 {
    const dx: f64 = @floatFromInt(end.x - start.x);
    const dy: f64 = @floatFromInt(end.y - start.y);
    if (dx == 0) return std.math.maxInt(i32);
    return @intFromFloat(dy / dx);
}

fn euclidean(start: Point, end: Point) i32 {
    const dx: f64 = @floatFromInt(end.x - start.x);
    const dy: f64 = @floatFromInt(end.y - start.y);
    return @intFromFloat(@sqrt(dx * dx + dy * dy) * 10);
}

pub fn getOpenNodes(cx: i32, cy: i32, _: i32, _: i32, buf: []Point) u32 {
    // Cardinals first, then diagonals
    if (buf.len < 8) return 0;
    buf[0] = .{ .x = cx + 1, .y = cy };
    buf[1] = .{ .x = cx - 1, .y = cy };
    buf[2] = .{ .x = cx, .y = cy + 1 };
    buf[3] = .{ .x = cx, .y = cy - 1 };
    buf[4] = .{ .x = cx + 1, .y = cy + 1 };
    buf[5] = .{ .x = cx - 1, .y = cy - 1 };
    buf[6] = .{ .x = cx + 1, .y = cy - 1 };
    buf[7] = .{ .x = cx - 1, .y = cy + 1 };
    return 8;
}

pub fn reject(x: i32, y: i32) bool {
    return checkFlag(act_map.spaceGetData(x, y));
}

pub fn getPenalty(x: i32, y: i32) i32 {
    if (checkFlag(act_map.spaceGetDataWide(x, y))) {
        return 50;
    }

    const data = act_map.spaceGetData(x, y);

    if ((data & Object) == Object) {
        return 60;
    }

    if ((data & ClosedDoor) == ClosedDoor) {
        return 80;
    }

    return 0;
}

pub fn mutatePoint(x: *i32, y: *i32) void {
    // find the nearest walkable space
    var area: [7][7]u16 = undefined;

    var i: i32 = -3;
    while (i <= 3) : (i += 1) {
        var j: i32 = -3;
        while (j <= 3) : (j += 1) {
            if ((i == 0 and j == 0) or (absInt(i) + absInt(j)) == 6)
                continue;
            const ui: usize = @intCast(3 + i);
            const uj: usize = @intCast(3 + j);
            area[ui][uj] = act_map.getMapData(x.* + i, y.* + j);
        }
    }

    i = -2;
    while (i <= 2) : (i += 1) {
        var j: i32 = -2;
        while (j <= 2) {
            if ((i == 0 and j == 0) or absInt(i + j) == 1) {
                j += 1;
                continue;
            }

            const ui: usize = @intCast(3 + i);
            const uj: usize = @intCast(3 + j);
            const combined = area[ui][uj] |
                area[@intCast(3 + i + 1)][uj] |
                area[@intCast(3 + i - 1)][uj] |
                area[ui][@intCast(3 + j + 1)] |
                area[ui][@intCast(3 + j - 1)];

            if (!checkFlag(combined)) {
                x.* += i;
                y.* += j;
                return;
            } else {
                j += 1; // extra j++ on failure
            }

            j += 1;
        }
    }
}

pub fn reduce(path: []const Point, out: []Point) u32 {
    if (path.len < 2) {
        const count: u32 = @intCast(path.len);
        for (path, 0..) |p, idx| {
            out[idx] = p;
        }
        return count;
    }

    var out_count: u32 = 0;

    var init = true;
    var s: i32 = 0;
    var first = path[0];
    var last: Point = undefined;

    // for each point in in (except last)
    for (path[0 .. path.len - 1]) |pt| {
        const next = pt;
        const slope_next = slope(first, next);
        if (init or slope_next != s) {
            init = false;
            out[out_count] = first;
            out_count += 1;
            last = first;
            s = slope_next;
        } else if (euclidean(last, next) >= range) {
            out[out_count] = first;
            out_count += 1;
            last = first;
        }
        first = next;
    }

    // push in.back()
    out[out_count] = path[path.len - 1];
    out_count += 1;

    return out_count;
}

pub fn findPath(sx: i32, sy: i32, ex: i32, ey: i32) u32 {
    waypoint_count = astar.FindPath(@This()).findPath(sx, sy, ex, ey, &waypoints);
    return waypoint_count;
}

fn absInt(v: i32) i32 {
    return if (v < 0) -v else v;
}
