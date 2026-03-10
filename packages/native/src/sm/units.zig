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
/// Missiles (3) use client-side, everything else uses server-side.
fn getTable(unit_type: u32) ?*types.UnitHashTable {
    if (unit_type >= types.UNIT_TYPE_COUNT) return null;
    if (unit_type == 3) {
        return globals.clientSideUnits().get(unit_type);
    }
    return globals.serverSideUnits().get(unit_type);
}

/// Walk the unit hash table for the given type, fill snapshot buffer.
/// Returns count of units found.
pub fn snapshotUnits(unit_type: u32) u32 {
    snapshot_len = 0;

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

/// Read a unit from the snapshot buffer by index.
pub fn getSnapshotUnit(idx: u32) ?SnapshotEntry {
    if (idx >= snapshot_len) return null;
    return snapshot_buf[idx];
}

/// Find a unit by type+id in the hash table.
pub fn findUnit(unit_type: u32, unit_id: u32) ?*UnitAny {
    const table = getTable(unit_type) orelse return null;

    const hash_idx = unit_id & 0x7F;
    var unit: ?*UnitAny = table.table[hash_idx];
    while (unit) |u| {
        if (u.dwUnitId == unit_id) return u;
        unit = u.pListNext;
    }
    return null;
}
