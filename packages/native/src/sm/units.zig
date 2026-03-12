const std = @import("std");
const types = @import("../d2/types.zig");
const globals = @import("../d2/globals.zig");
const UnitAny = types.UnitAny;

pub const SnapshotEntry = struct {
    unit_type: u32,
    unit_id: u32,
};

var snapshot_buf: [512]SnapshotEntry = undefined;
var snapshot_len: u32 = 0;

/// Get the appropriate hash table for a unit type.
/// Missiles (3) and tiles (5) use client-side, everything else uses server-side.
fn getTable(unit_type: u32) ?*types.UnitHashTable {
    if (unit_type >= types.UNIT_TYPE_COUNT) return null;
    if (unit_type == 3 or unit_type == 5) {
        return globals.clientSideUnits().get(unit_type);
    }
    return globals.serverSideUnits().get(unit_type);
}

/// Walk the unit hash table for the given type, fill snapshot buffer.
/// Returns count of units found.
pub fn snapshotUnits(unit_type: u32) u32 {
    snapshot_len = 0;

    // Tile units (type 5) live in Room1.pUnitFirst chains, not hash tables
    if (unit_type == 5) {
        return snapshotRoomUnits(5);
    }

    const table = getTable(unit_type) orelse return 0;

    for (table.table) |entry| {
        var unit: ?*UnitAny = entry;
        while (unit) |u| {
            if (snapshot_len >= snapshot_buf.len) break;
            snapshot_buf[snapshot_len] = .{
                .unit_type = unit_type,
                .unit_id = u.dwUnitId,
            };
            snapshot_len += 1;
            unit = u.pListNext;
        }
    }

    return snapshot_len;
}

/// Walk Room1 chains in the current act, collecting units of the given type.
fn snapshotRoomUnits(unit_type: u32) u32 {
    const player = globals.playerUnit().* orelse return 0;
    const act = player.pAct orelse return 0;
    var room1: ?*types.Room1 = act.pRoom1;
    while (room1) |room| : (room1 = room.pRoomNext) {
        var unit: ?*UnitAny = room.pUnitFirst;
        while (unit) |u| {
            if (u.dwType == unit_type) {
                if (snapshot_len >= snapshot_buf.len) return snapshot_len;
                snapshot_buf[snapshot_len] = .{
                    .unit_type = unit_type,
                    .unit_id = u.dwUnitId,
                };
                snapshot_len += 1;
            }
            unit = u.pListNext;
        }
    }
    // Also check both server-side and client-side hash tables
    snapshotHashTable(globals.serverSideUnits().get(unit_type), unit_type);
    snapshotHashTable(globals.clientSideUnits().get(unit_type), unit_type);
    return snapshot_len;
}

fn snapshotHashTable(table: ?*types.UnitHashTable, unit_type: u32) void {
    const t = table orelse return;
    for (t.table) |entry| {
        var unit: ?*UnitAny = entry;
        while (unit) |u| {
            // Skip duplicates (already found in room chains)
            var dup = false;
            for (snapshot_buf[0..snapshot_len]) |existing| {
                if (existing.unit_id == u.dwUnitId) {
                    dup = true;
                    break;
                }
            }
            if (!dup) {
                if (snapshot_len >= snapshot_buf.len) return;
                snapshot_buf[snapshot_len] = .{
                    .unit_type = unit_type,
                    .unit_id = u.dwUnitId,
                };
                snapshot_len += 1;
            }
            unit = u.pListNext;
        }
    }
}

/// Read a unit from the snapshot buffer by index.
pub fn getSnapshotUnit(idx: u32) ?SnapshotEntry {
    if (idx >= snapshot_len) return null;
    return snapshot_buf[idx];
}

/// Find a unit by type+id in the hash table (or Room1 chains for tiles).
pub fn findUnit(unit_type: u32, unit_id: u32) ?*UnitAny {
    // Tile units live in Room1.pUnitFirst chains
    if (unit_type == 5) {
        return findRoomUnit(5, unit_id);
    }

    const table = getTable(unit_type) orelse return null;

    const hash_idx = unit_id & 0x7F;
    var unit: ?*UnitAny = table.table[hash_idx];
    while (unit) |u| {
        if (u.dwUnitId == unit_id) return u;
        unit = u.pListNext;
    }
    return null;
}

/// Find a unit by type+id walking Room1 chains + hash tables.
fn findRoomUnit(unit_type: u32, unit_id: u32) ?*UnitAny {
    const player = globals.playerUnit().* orelse return null;
    const act = player.pAct orelse return null;
    // Check Room1 chains first
    var room1: ?*types.Room1 = act.pRoom1;
    while (room1) |room| : (room1 = room.pRoomNext) {
        var unit: ?*UnitAny = room.pUnitFirst;
        while (unit) |u| {
            if (u.dwType == unit_type and u.dwUnitId == unit_id) return u;
            unit = u.pListNext;
        }
    }
    // Fallback: check both hash tables
    if (findInHashTable(globals.serverSideUnits().get(unit_type), unit_id)) |u| return u;
    if (findInHashTable(globals.clientSideUnits().get(unit_type), unit_id)) |u| return u;
    return null;
}

fn findInHashTable(table: ?*types.UnitHashTable, unit_id: u32) ?*UnitAny {
    const t = table orelse return null;
    const hash_idx = unit_id & 0x7F;
    var unit: ?*UnitAny = t.table[hash_idx];
    while (unit) |u| {
        if (u.dwUnitId == unit_id) return u;
        unit = u.pListNext;
    }
    return null;
}
