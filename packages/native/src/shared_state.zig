/// Shared Int32Array between JS and Zig — zero-copy reads/writes both sides.
/// Layout: fixed slots accessible by index from JS and by name from Zig.
///
/// JS: const state = getSharedState(); state[SharedState.PLAYER_X] = ...
/// Zig: shared_state.data[Slot.player_x] = ...

pub const Slot = enum(u32) {
    // Player state (written by Zig each tick, read by JS)
    player_x = 0,
    player_y = 1,
    player_hp = 2,
    player_max_hp = 3,
    player_mp = 4,
    player_max_mp = 5,
    player_area = 6,
    player_mode = 7,

    // Flags (read/write both sides)
    screenshot_pending = 8,
    automap_enabled = 9,
    debug_draw_rooms = 10,
    debug_draw_path = 11,
    paused = 12,

    // Frame counters (written by Zig)
    frame_count = 13,
    tick_count = 14,

    // Scratch space for JS↔Zig communication (15-31)
    scratch_0 = 15,
    scratch_1 = 16,
    scratch_2 = 17,
    scratch_3 = 18,
    scratch_4 = 19,
    scratch_5 = 20,
    scratch_6 = 21,
    scratch_7 = 22,
    scratch_8 = 23,
    scratch_9 = 24,
    scratch_10 = 25,
    scratch_11 = 26,
    scratch_12 = 27,
    scratch_13 = 28,
    scratch_14 = 29,
    scratch_15 = 30,
    _len = 31,
};

const SLOT_COUNT = @intFromEnum(Slot._len) + 1;

/// The actual data — Zig reads/writes directly, JS sees as Int32Array
pub var data: [SLOT_COUNT]i32 = .{0} ** SLOT_COUNT;

pub fn get(slot: Slot) i32 {
    return data[@intFromEnum(slot)];
}

pub fn set(slot: Slot, val: i32) void {
    data[@intFromEnum(slot)] = val;
}

pub fn ptr() [*]i32 {
    return &data;
}

pub fn len() u32 {
    return SLOT_COUNT;
}
