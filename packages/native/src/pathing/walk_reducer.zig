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

// Max distance (in tiles) between consecutive walk waypoints.
const MAX_WALK_DIST: i32 = 5;

pub const MAX_WAYPOINTS: u32 = 512;
pub var waypoints: [MAX_WAYPOINTS]Point = undefined;
pub var waypoint_count: u32 = 0;

fn checkFlag(flag: u16) bool {
    return (WALK_COLLISION & flag) > 0;
}

fn euclideanDist(ax: i32, ay: i32, bx: i32, by: i32) f64 {
    const dx: f64 = @floatFromInt(bx - ax);
    const dy: f64 = @floatFromInt(by - ay);
    return @sqrt(dx * dx + dy * dy);
}

/// Bresenham line-of-sight check: walk every tile from (x0,y0) to (x1,y1).
/// Returns true if ALL tiles along the line are walkable (no collision).
fn lineIsWalkable(x0: i32, y0: i32, x1: i32, y1: i32) bool {
    var x = x0;
    var y = y0;
    const dx = absInt(x1 - x0);
    const dy = -absInt(y1 - y0);
    const sx: i32 = if (x0 < x1) 1 else -1;
    const sy: i32 = if (y0 < y1) 1 else -1;
    var err = dx + dy;

    while (true) {
        // Check this tile (5-point cross, same as reject)
        if (checkFlag(act_map.spaceGetData(x, y))) return false;

        if (x == x1 and y == y1) break;

        const e2 = 2 * err;
        if (e2 >= dy) {
            err += dy;
            x += sx;
        }
        if (e2 <= dx) {
            err += dx;
            y += sy;
        }
    }
    return true;
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

/// Line-of-sight path reduction for walking.
///
/// Greedily skips ahead along the A* path as long as:
///   1. Every tile on the Bresenham line from the last emitted waypoint
///      to the candidate point is walkable.
///   2. The distance doesn't exceed MAX_WALK_DIST tiles.
///
/// When either condition fails, emit the last valid point as a waypoint
/// and start a new segment from there.
pub fn reduce(path: []const Point, out: []Point) u32 {
    if (path.len == 0) return 0;
    if (path.len == 1) {
        out[0] = path[0];
        return 1;
    }

    var out_count: u32 = 0;

    // Always emit the start point
    out[out_count] = path[0];
    out_count += 1;

    var anchor: usize = 0; // index of last emitted waypoint in path

    while (anchor < path.len - 1) {
        const ax = path[anchor].x;
        const ay = path[anchor].y;

        // Scan forward: find the furthest point we can walk to in a straight line
        var best: usize = anchor + 1;
        var probe: usize = anchor + 1;
        while (probe < path.len) : (probe += 1) {
            const px = path[probe].x;
            const py = path[probe].y;

            // Too far? Stop scanning.
            if (euclideanDist(ax, ay, px, py) > MAX_WALK_DIST) break;

            // Line of sight clear?
            if (lineIsWalkable(ax, ay, px, py)) {
                best = probe;
            } else {
                // LOS blocked — can't go further
                break;
            }
        }

        // Emit the best reachable point
        if (out_count < out.len) {
            out[out_count] = path[best];
            out_count += 1;
        }
        anchor = best;
    }

    // Ensure the final destination is always the last waypoint
    if (out_count > 0) {
        const last_out = out[out_count - 1];
        const last_path = path[path.len - 1];
        if (last_out.x != last_path.x or last_out.y != last_path.y) {
            if (out_count < out.len) {
                out[out_count] = last_path;
                out_count += 1;
            }
        }
    }

    return out_count;
}

pub fn findPath(sx: i32, sy: i32, ex: i32, ey: i32) u32 {
    waypoint_count = astar.FindPath(@This()).findPath(sx, sy, ex, ey, &waypoints);
    return waypoint_count;
}

fn absInt(v: i32) i32 {
    return if (v < 0) -v else v;
}
