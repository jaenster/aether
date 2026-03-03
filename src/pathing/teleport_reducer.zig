// Faithful line-by-line translation of d2bs TeleportPathReducer.h
// All coordinates are absolute world coords (i32). No heap allocation.

const std = @import("std");
const act_map = @import("act_map.zig");
const astar = @import("astar.zig");
const Point = astar.Point;

// --- CollisionFlags (from Ghidra: PLAYER_COLLISION_DEFAULT = 0x1C09) ---
const PLAYER_COLLISION: u16 = 0x1C09; // BlockWalk|BlockPlayer|Object|ClosedDoor|NPCCollision

fn checkFlag(flag: u16) bool {
    return (PLAYER_COLLISION & flag) > 0;
}

// --- Euclidean distance (d2bs: sqrt(dx^2+dy^2)*10, truncated to int) ---
fn euclidean(sx: i32, sy: i32, ex: i32, ey: i32) i32 {
    const dx: f64 = @floatFromInt(ex - sx);
    const dy: f64 = @floatFromInt(ey - sy);
    return @intFromFloat(@sqrt(dx * dx + dy * dy) * 10.0);
}

// --- PathingPointList: fixed-size open-addressing hash set ---
const PPL_CAPACITY = 8192;
var ppl_keys: [PPL_CAPACITY]u64 = undefined;
var ppl_used: [PPL_CAPACITY]bool = undefined;
var ppl_count: u32 = 0;

fn pplHash(x: i32, y: i32) u64 {
    return (@as(u64, @bitCast(@as(i64, x))) *% 0x9E3779B97F4A7C15) +% @as(u64, @bitCast(@as(i64, y)));
}

fn pplContains(x: i32, y: i32) bool {
    const key = pplHash(x, y);
    var idx: usize = @truncate(key & (PPL_CAPACITY - 1));
    var i: u32 = 0;
    while (i < PPL_CAPACITY) : (i += 1) {
        if (!ppl_used[idx]) return false;
        if (ppl_keys[idx] == key) return true;
        idx = (idx + 1) & (PPL_CAPACITY - 1);
    }
    return false;
}

fn pplInsert(x: i32, y: i32) void {
    if (ppl_count >= PPL_CAPACITY - 1) return;
    const key = pplHash(x, y);
    var idx: usize = @truncate(key & (PPL_CAPACITY - 1));
    while (ppl_used[idx]) {
        if (ppl_keys[idx] == key) return;
        idx = (idx + 1) & (PPL_CAPACITY - 1);
    }
    ppl_keys[idx] = key;
    ppl_used[idx] = true;
    ppl_count += 1;
}

fn pplClear() void {
    @memset(&ppl_used, false);
    ppl_count = 0;
}

// --- Distance ring ---
const MAX_RING = 512;
var distance_list: [MAX_RING]Point = undefined;
var distance_list_len: u32 = 0;
var built_range: i32 = 0;

// --- State ---
var range: i32 = 0;
var best_pt_so_far: Point = .{ .x = 0, .y = 0 };

fn buildDistanceRing(tp_range: i32) void {
    distance_list_len = 0;
    const r: i32 = @divTrunc(tp_range, 10);
    var x: i32 = -r;
    while (x <= r) : (x += 1) {
        var y: i32 = -r;
        while (y <= r) : (y += 1) {
            const d = euclidean(x, y, 0, 0);
            if (d < tp_range and d > tp_range - 5) {
                if (distance_list_len < MAX_RING) {
                    distance_list[distance_list_len] = .{ .x = x, .y = y };
                    distance_list_len += 1;
                }
            }
            y += 0; // explicit: no extra increment, loop does it
        }
    }
}

// --- Reducer interface (exported for astar comptime) ---

pub fn getOpenNodes(cx: i32, cy: i32, ex: i32, ey: i32, buf: []Point) u32 {
    var count: u32 = 0;

    // if were in tele range take the jump
    if (euclidean(ex, ey, cx, cy) < range - 20) {
        if (count < buf.len) {
            buf[count] = .{ .x = ex, .y = ey };
            count += 1;
        }
        return count;
    }

    // find best tele spot
    if (best_pt_so_far.x == 0)
        best_pt_so_far = .{ .x = cx, .y = cy };

    var val: i32 = 1000000;
    var best: Point = .{ .x = 0, .y = 0 };

    if (euclidean(best_pt_so_far.x, best_pt_so_far.y, cx, cy) < 500) {
        var j: u32 = 0;
        while (j < distance_list_len) : (j += 1) {
            const x = distance_list[j].x + cx;
            const y = distance_list[j].y + cy;
            if (!reject(x, y)) {
                const d = euclidean(x, y, ex, ey);
                if (val > d) {
                    val = d;
                    best = .{ .x = x, .y = y };
                    if (count < buf.len) {
                        buf[count] = best;
                        count += 1;
                    }
                }
            }
        }
        if (best.x != 0 and !pplContains(best.x, best.y) and euclidean(best.x, best.y, ex, ey) < euclidean(cx, cy, ex, ey)) {
            pplInsert(best.x, best.y);
            if (count < buf.len) {
                buf[count] = best;
                count += 1;
            }
            if (euclidean(best.x, best.y, ex, ey) < euclidean(best_pt_so_far.x, best_pt_so_far.y, ex, ey))
                best_pt_so_far = best;
            return count;
        }
    }

    // expand point normally if smart tele isnt found (8-neighbor)
    var i: i32 = 1;
    while (i >= -1) : (i -= 1) {
        var jj: i32 = 1;
        while (jj >= -1) : (jj -= 1) {
            if ((i == 0 and jj == 0) or reject(cx + i, cy + jj))
                continue;
            if (count < buf.len) {
                buf[count] = .{ .x = cx + i, .y = cy + jj };
                count += 1;
            }
            pplInsert(cx + i, cy + jj);
        }
    }

    return count;
}

pub fn reject(x: i32, y: i32) bool {
    return checkFlag(act_map.spaceGetData(x, y));
}

pub fn getPenalty(x: i32, y: i32) i32 {
    _ = x;
    _ = y;
    return 0;
}

pub fn mutatePoint(px: *i32, py: *i32) void {
    // find the nearest walkable space
    // read 7x7 area of GetMapData into local array
    var area: [7][7]u16 = undefined;

    var i: i32 = -3;
    while (i <= 3) : (i += 1) {
        var j: i32 = -3;
        while (j <= 3) : (j += 1) {
            if ((i == 0 and j == 0) or (absI(i) + absI(j) == 6)) {
                // skip
            } else {
                const ui: usize = @intCast(3 + i);
                const uj: usize = @intCast(3 + j);
                area[ui][uj] = act_map.getMapData(px.* + i, py.* + j);
            }
        }
    }

    // scan inner 5x5 (-2..2)
    i = -2;
    while (i <= 2) : (i += 1) {
        var j: i32 = -2;
        while (j <= 2) {
            if ((i == 0 and j == 0) or (absI(i + j) == 1)) {
                j += 1;
                continue;
            }
            const ui: usize = @intCast(3 + i);
            const uj: usize = @intCast(3 + j);
            const combined = area[ui][uj] |
                area[ui + 1][uj] |
                area[ui - 1][uj] |
                area[ui][uj + 1] |
                area[ui][uj - 1];
            if (!checkFlag(combined)) {
                px.* += i;
                py.* += j;
                return;
            } else {
                j += 1; // extra skip (matching C++ j++)
            }
            j += 1;
        }
    }
}

pub fn reduce(path: []const Point, out: []Point) u32 {
    if (path.len == 0) return 0;

    var count: u32 = 0;

    // push first point
    if (count < out.len) {
        out[count] = path[0];
        count += 1;
    }

    var idx: usize = 0;
    const end = path.len;
    while (idx < end) {
        const prev = out[count - 1];

        // skip while Euclidean < range
        while (idx < end and euclidean(path[idx].x, path[idx].y, prev.x, prev.y) < range)
            idx += 1;

        // back up one
        if (idx > 0) idx -= 1;

        if (count < out.len) {
            out[count] = path[idx];
            count += 1;
        }

        idx += 1;
    }

    return count;
}

// --- Public API ---

pub const MAX_WAYPOINTS = 256;
pub var waypoints: [MAX_WAYPOINTS]Point = undefined;
pub var waypoint_count: u32 = 0;

pub fn findPath(sx: i32, sy: i32, ex: i32, ey: i32, tp_range: u32) u32 {
    const tp_range_i: i32 = @intCast(tp_range);
    range = tp_range_i * 10; // default _range=20, so range=200

    // build distance ring if not already built (or rebuild on range change)
    if (built_range != range) {
        buildDistanceRing(range);
        built_range = range;
    }

    // clear PathingPointList
    pplClear();

    // reset bestPtSoFar
    best_pt_so_far = .{ .x = 0, .y = 0 };

    // call astar FindPath with this module as the Reducer
    // astar internally calls reduce(), result goes directly into waypoints
    waypoint_count = astar.FindPath(@This()).findPath(sx, sy, ex, ey, &waypoints);

    return waypoint_count;
}

// --- Helpers ---

fn absI(v: i32) i32 {
    return if (v < 0) -v else v;
}
