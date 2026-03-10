const std = @import("std");
const log = @import("log.zig");

const win = std.os.windows;
const HANDLE = *anyopaque;
const DWORD = u32;
const BOOL = win.BOOL;
const INVALID_HANDLE: HANDLE = @ptrFromInt(std.math.maxInt(usize));

extern "kernel32" fn CreateFileA(
    name: [*:0]const u8,
    access: DWORD,
    share: DWORD,
    sa: ?*anyopaque,
    disp: DWORD,
    flags: DWORD,
    template: ?HANDLE,
) callconv(.winapi) HANDLE;
extern "kernel32" fn WriteFile(h: HANDLE, buf: [*]const u8, len: DWORD, written: ?*DWORD, overlapped: ?*anyopaque) callconv(.winapi) BOOL;
extern "kernel32" fn CloseHandle(h: HANDLE) callconv(.winapi) BOOL;
extern "kernel32" fn CreateDirectoryA(path: [*:0]const u8, sa: ?*anyopaque) callconv(.winapi) BOOL;

const GENERIC_WRITE: DWORD = 0x40000000;
const FILE_SHARE_READ: DWORD = 0x00000001;
const CREATE_ALWAYS: DWORD = 2;
const FILE_ATTRIBUTE_NORMAL: DWORD = 0x80;

// Buffer for building JSON output — 512KB should be plenty for one game's spawn data
const BUF_SIZE = 4 * 1024 * 1024;
var buf: [BUF_SIZE]u8 = undefined;
var pos: usize = 0;

pub fn reset() void {
    pos = 0;
}

fn emit(data: []const u8) void {
    if (pos + data.len > BUF_SIZE) return;
    @memcpy(buf[pos..][0..data.len], data);
    pos += data.len;
}

fn emitChar(c: u8) void {
    if (pos < BUF_SIZE) {
        buf[pos] = c;
        pos += 1;
    }
}

fn emitInt(val: i32) void {
    if (val < 0) {
        emitChar('-');
        emitUint(@intCast(-val));
    } else {
        emitUint(@intCast(val));
    }
}

fn emitUint(val: u32) void {
    var tmp: [10]u8 = undefined;
    var v = val;
    var i: usize = 10;
    if (v == 0) {
        emitChar('0');
        return;
    }
    while (v > 0) {
        i -= 1;
        tmp[i] = @intCast((v % 10) + '0');
        v /= 10;
    }
    emit(tmp[i..10]);
}

fn emitStr(s: []const u8) void {
    emitChar('"');
    emit(s);
    emitChar('"');
}

// ============================================================================
// Public API — structured JSON building
// ============================================================================

pub fn beginGame(seed: u32, difficulty: u8, expansion: bool) void {
    reset();
    first_level = true;
    first_pool_entry = true;
    first_room = true;
    first_rect = true;
    first_spawn = true;
    emit("{\"seed\":");
    emitUint(seed);
    emit(",\"difficulty\":");
    emitUint(difficulty);
    emit(",\"expansion\":");
    if (expansion) emit("true") else emit("false");
    emit(",\"levels\":{");
}

var first_level: bool = true;

pub fn beginLevel(level_id: u32, density: i32, boss_min: u8, boss_max: u8, dungeon_level: i32) void {
    if (!first_level) emitChar(',');
    first_level = false;
    emitChar('"');
    emitUint(level_id);
    emit("\":{\"density\":");
    emitInt(density);
    emit(",\"bossMin\":");
    emitUint(boss_min);
    emit(",\"bossMax\":");
    emitUint(boss_max);
    emit(",\"monsterLevel\":");
    emitInt(dungeon_level);
    emit(",\"monsterPool\":[");
}

var first_pool_entry: bool = true;

pub fn addPoolEntry(class_id: u16, rarity: u16) void {
    if (!first_pool_entry) emitChar(',');
    first_pool_entry = false;
    emit("{\"classId\":");
    emitUint(class_id);
    emit(",\"rarity\":");
    emitUint(rarity);
    emitChar('}');
}

pub fn endPoolBeginRooms() void {
    emit("],\"rooms\":[");
    first_pool_entry = true; // reset for next level
}

var first_room: bool = true;

pub fn beginRoom() void {
    if (!first_room) emitChar(',');
    first_room = false;
    emit("{\"rects\":[");
}

var first_rect: bool = true;

pub fn addRect(left: i32, top: i32, right: i32, bottom: i32) void {
    if (!first_rect) emitChar(',');
    first_rect = false;
    emit("{\"l\":");
    emitInt(left);
    emit(",\"t\":");
    emitInt(top);
    emit(",\"r\":");
    emitInt(right);
    emit(",\"b\":");
    emitInt(bottom);
    emitChar('}');
}

pub fn endRectsBeginSpawns() void {
    emit("],\"spawns\":[");
    first_rect = true; // reset for next room
}

var first_spawn: bool = true;

/// spawn_type: 0=unique, 1=champion, 2=normal, 3=superunique, 4=minion
pub fn addSpawn(class_id: u16, spawn_type: u8, count: u8, mods: []const u8) void {
    if (!first_spawn) emitChar(',');
    first_spawn = false;
    emit("{\"classId\":");
    emitUint(class_id);
    emit(",\"type\":");
    switch (spawn_type) {
        0 => emitStr("unique"),
        1 => emitStr("champion"),
        3 => emitStr("superunique"),
        4 => emitStr("minion"),
        5 => emitStr("preset"),
        else => emitStr("normal"),
    }
    emit(",\"count\":");
    emitUint(count);
    if (mods.len > 0) {
        emit(",\"mods\":[");
        for (mods, 0..) |m, i| {
            if (i > 0) emitChar(',');
            emitUint(m);
        }
        emitChar(']');
    }
    emitChar('}');
}

pub fn endRoom() void {
    emit("]}");
    first_spawn = true; // reset for next room
}

pub fn endLevel() void {
    emit("]}");
    first_room = true; // reset for next level
}

pub fn endGame() void {
    emit("}}");
}

pub fn flush(seed: u32) void {
    // Ensure spawn_log directory exists
    _ = CreateDirectoryA("spawn_log", null);

    // Build filename: spawn_log/seed_NNNNN.json
    var name_buf: [64]u8 = undefined;
    var ni: usize = 0;
    for ("spawn_log\\seed_") |c| {
        name_buf[ni] = c;
        ni += 1;
    }
    // Write seed number
    var tmp: [10]u8 = undefined;
    var v = seed;
    var ti: usize = 10;
    if (v == 0) {
        name_buf[ni] = '0';
        ni += 1;
    } else {
        while (v > 0) {
            ti -= 1;
            tmp[ti] = @intCast((v % 10) + '0');
            v /= 10;
        }
        @memcpy(name_buf[ni..][0 .. 10 - ti], tmp[ti..10]);
        ni += 10 - ti;
    }
    for (".json") |c| {
        name_buf[ni] = c;
        ni += 1;
    }
    name_buf[ni] = 0;

    const h = CreateFileA(
        @ptrCast(name_buf[0..ni :0]),
        GENERIC_WRITE,
        FILE_SHARE_READ,
        null,
        CREATE_ALWAYS,
        FILE_ATTRIBUTE_NORMAL,
        null,
    );
    if (h == INVALID_HANDLE) {
        log.print("spawn_logger: failed to create file");
        return;
    }
    defer _ = CloseHandle(h);

    var written: DWORD = 0;
    _ = WriteFile(h, &buf, @intCast(pos), &written, null);

    log.print("spawn_logger: wrote seed file");
}
