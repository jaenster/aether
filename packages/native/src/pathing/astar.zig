const std = @import("std");
const act_map = @import("act_map.zig");
const log = @import("../log.zig");

pub const Point = struct { x: i32, y: i32 };

pub const MAX_NEIGHBORS: u32 = 128;
pub const MAX_PATH: u32 = 4096;

const MAX_NODES: u32 = 262144;
const MAX_OPEN: u32 = 262144;
const CLOSED_CAPACITY: u32 = 262144;

// --- Heuristics (faithful to d2bs AStarPath.h) ---

pub fn manhattan(sx: i32, sy: i32, ex: i32, ey: i32) i32 {
    return 10 * (absInt(sx - ex) + absInt(sy - ey));
}

pub fn diagonalShortcut(sx: i32, sy: i32, ex: i32, ey: i32) i32 {
    const xdist = absInt(sx - ex);
    const ydist = absInt(sy - ey);
    return if (xdist > ydist)
        14 * ydist + 10 * (xdist - ydist)
    else
        14 * xdist + 10 * (ydist - xdist);
}

pub fn chebyshev(sx: i32, sy: i32, ex: i32, ey: i32) i32 {
    const xdist = absInt(sx - ex);
    const ydist = absInt(sy - ey);
    return if (xdist > ydist) xdist else ydist;
}

pub fn euclidean(sx: i32, sy: i32, ex: i32, ey: i32) i32 {
    const dx: f64 = @floatFromInt(ex - sx);
    const dy: f64 = @floatFromInt(ey - sy);
    return @intFromFloat(@sqrt(dx * dx + dy * dy) * 10.0);
}

fn absInt(v: i32) i32 {
    return if (v < 0) -v else v;
}

// --- Node ---

const Node = struct {
    parent: u32, // index into node_pool, NULL_NODE = no parent
    x: i32,
    y: i32,
    g: i32,
    h: i32,

    fn f(self: *const Node) i32 {
        return self.g + self.h;
    }
};

const NULL_NODE: u32 = 0xFFFFFFFF;

// --- Closed set: open-addressing hash table with linear probing ---

const ClosedSet = struct {
    keys: [CLOSED_CAPACITY]u64,
    gens: [CLOSED_CAPACITY]u32,
    generation: u32,

    fn init(self: *ClosedSet) void {
        // Generation counter avoids clearing 262K entries each call.
        // On first use (gen=0→1) we must zero the gens array once.
        if (self.generation == 0) @memset(&self.gens, 0);
        self.generation +%= 1;
        if (self.generation == 0) {
            // Wrapped — force full clear (extremely rare)
            @memset(&self.gens, 0);
            self.generation = 1;
        }
    }

    fn hash(x: i32, y: i32) u64 {
        return (@as(u64, @bitCast(@as(i64, x))) << 32) | @as(u64, @as(u32, @bitCast(y)));
    }

    fn contains(self: *const ClosedSet, x: i32, y: i32) bool {
        const key = hash(x, y);
        var idx = @as(u32, @truncate(key % CLOSED_CAPACITY));
        while (self.gens[idx] == self.generation) {
            if (self.keys[idx] == key) return true;
            idx = (idx + 1) % CLOSED_CAPACITY;
        }
        return false;
    }

    fn insert(self: *ClosedSet, x: i32, y: i32) void {
        const key = hash(x, y);
        var idx = @as(u32, @truncate(key % CLOSED_CAPACITY));
        while (self.gens[idx] == self.generation) {
            if (self.keys[idx] == key) return;
            idx = (idx + 1) % CLOSED_CAPACITY;
        }
        self.keys[idx] = key;
        self.gens[idx] = self.generation;
    }
};

// --- Binary min-heap ordered by f = g + h ---

const MinHeap = struct {
    items: [MAX_OPEN]u32,
    size: u32,
    nodes: *const [MAX_NODES]Node,

    fn init(self: *MinHeap, nodes: *const [MAX_NODES]Node) void {
        self.size = 0;
        self.nodes = nodes;
    }

    fn fVal(self: *const MinHeap, heap_idx: u32) i32 {
        return self.nodes[self.items[heap_idx]].f();
    }

    fn push(self: *MinHeap, node_idx: u32) void {
        if (self.size >= MAX_OPEN) return;
        self.items[self.size] = node_idx;
        var i = self.size;
        self.size += 1;
        while (i > 0) {
            const parent = (i - 1) / 2;
            if (self.fVal(i) < self.fVal(parent)) {
                const tmp = self.items[i];
                self.items[i] = self.items[parent];
                self.items[parent] = tmp;
                i = parent;
            } else break;
        }
    }

    fn pop(self: *MinHeap) u32 {
        const top = self.items[0];
        self.size -= 1;
        self.items[0] = self.items[self.size];
        var i: u32 = 0;
        while (true) {
            var smallest = i;
            const left = 2 * i + 1;
            const right = 2 * i + 2;
            if (left < self.size and self.fVal(left) < self.fVal(smallest))
                smallest = left;
            if (right < self.size and self.fVal(right) < self.fVal(smallest))
                smallest = right;
            if (smallest != i) {
                const tmp = self.items[i];
                self.items[i] = self.items[smallest];
                self.items[smallest] = tmp;
                i = smallest;
            } else break;
        }
        return top;
    }

    fn empty(self: *const MinHeap) bool {
        return self.size == 0;
    }
};

// --- Static buffers (moved out of findPath to avoid ~2.1MB stack allocation) ---

var node_pool: [MAX_NODES]Node = undefined;
var node_count: u32 = 0;
var closed: ClosedSet = undefined;
var open: MinHeap = undefined;
var raw_path: [MAX_PATH]Point = undefined;
var neighbor_buf: [MAX_NEIGHBORS]Point = undefined;

// --- A* pathfinder, generic over Reducer (d2bs AStarPath template) ---
//
// Reducer must provide:
//   fn getOpenNodes(cx: i32, cy: i32, ex: i32, ey: i32, buf: *[MAX_NEIGHBORS]Point) u32
//   fn reject(x: i32, y: i32) bool
//   fn getPenalty(x: i32, y: i32) i32
//   fn mutatePoint(x: *i32, y: *i32) void
//   fn reduce(path: []const Point, out: []Point) u32

pub fn FindPath(comptime Reducer: type) type {
    return struct {
        pub fn findPath(sx: i32, sy: i32, ex: i32, ey: i32, out: []Point) u32 {
            var start_x = sx;
            var start_y = sy;
            var end_x = ex;
            var end_y = ey;

            // Mutate start/end if rejected (d2bs GetPath lines 177-180)
            if (Reducer.reject(start_x, start_y))
                Reducer.mutatePoint(&start_x, &start_y);
            if (Reducer.reject(end_x, end_y))
                Reducer.mutatePoint(&end_x, &end_y);

            // Reset static state
            node_count = 0;
            closed.init();
            open.init(&node_pool);

            // Allocate start node (d2bs lines 94-104)
            const start_idx = allocNode(&node_pool, &node_count, .{
                .parent = NULL_NODE,
                .x = start_x,
                .y = start_y,
                .g = 0,
                .h = diagonalShortcut(start_x, start_y, end_x, end_y),
            }) orelse return 0;
            open.push(start_idx);

            // Main loop (d2bs FindPath lines 106-152)
            while (!open.empty()) {
                const current_idx = open.pop();
                const current = node_pool[current_idx];

                // Closed-on-pop: skip if already visited (d2bs lines 110-111)
                if (closed.contains(current.x, current.y))
                    continue;

                // Goal check (d2bs lines 113-116)
                if (current.x == end_x and current.y == end_y) {
                    // ReverseList then Reduce (d2bs lines 187-190)
                    const raw_len = reverseList(&node_pool, current_idx, &raw_path);
                    return Reducer.reduce(raw_path[0..raw_len], out);
                }

                // Insert current into closed (d2bs line 129)
                closed.insert(current.x, current.y);

                // Get neighbors (d2bs line 134: reducer->GetOpenNodes)
                const nc = Reducer.getOpenNodes(
                    current.x,
                    current.y,
                    end_x,
                    end_y,
                    &neighbor_buf,
                );

                // Process each neighbor (d2bs lines 135-151)
                for (neighbor_buf[0..nc]) |pt| {
                    // If not end and rejected, add to closed and skip (d2bs lines 139-142)
                    if ((pt.x != end_x or pt.y != end_y) and Reducer.reject(pt.x, pt.y)) {
                        closed.insert(pt.x, pt.y);
                        continue;
                    }

                    // Allocate new node (d2bs lines 143-150)
                    const penalty = Reducer.getPenalty(pt.x, pt.y);
                    const new_g = current.g + diagonalShortcut(current.x, current.y, pt.x, pt.y) + penalty;
                    const new_h = diagonalShortcut(pt.x, pt.y, end_x, end_y);

                    const next_idx = allocNode(&node_pool, &node_count, .{
                        .parent = current_idx,
                        .x = pt.x,
                        .y = pt.y,
                        .g = new_g,
                        .h = new_h,
                    }) orelse return 0;
                    open.push(next_idx);
                }
            }

            // No path found (d2bs line 192)
            return 0;
        }
    };
}

// --- Internal helpers ---

fn allocNode(pool: *[MAX_NODES]Node, count: *u32, node: Node) ?u32 {
    if (count.* >= MAX_NODES) return null;
    const idx = count.*;
    pool[idx] = node;
    count.* += 1;
    return idx;
}

/// Walk parent chain and store points in order (d2bs ReverseList lines 82-88).
/// d2bs inserts at front during forward walk; we walk backward and fill from end.
fn reverseList(pool: *const [MAX_NODES]Node, end_idx: u32, out: *[MAX_PATH]Point) u32 {
    var len: u32 = 0;
    var idx = end_idx;
    while (idx != NULL_NODE) : (idx = pool[idx].parent) {
        len += 1;
        if (len >= MAX_PATH) break;
    }

    var pos: u32 = len;
    idx = end_idx;
    while (idx != NULL_NODE and pos > 0) : (idx = pool[idx].parent) {
        pos -= 1;
        out[pos] = .{ .x = pool[idx].x, .y = pool[idx].y };
    }

    return len;
}
