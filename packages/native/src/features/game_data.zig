const std = @import("std");
const feature = @import("../feature.zig");
const log = @import("../log.zig");
const d2 = struct {
    const functions = @import("../d2/functions.zig");
    const globals = @import("../d2/globals.zig");
    const types = @import("../d2/types.zig");
};

const UnitAny = d2.types.UnitAny;
const MonsterData = d2.types.MonsterData;
const ItemData = d2.types.ItemData;
const DWORD = u32;

extern "kernel32" fn GetTickCount() callconv(.winapi) DWORD;
extern "kernel32" fn CreateFileA(name: [*:0]const u8, access: DWORD, share: DWORD, sa: ?*anyopaque, disp: DWORD, flags: DWORD, template: ?*anyopaque) callconv(.winapi) *anyopaque;
extern "kernel32" fn WriteFile(h: *anyopaque, buf: [*]const u8, len: DWORD, written: ?*DWORD, overlapped: ?*anyopaque) callconv(.winapi) i32;
extern "kernel32" fn CloseHandle(h: *anyopaque) callconv(.winapi) i32;
extern "kernel32" fn SetFilePointer(h: *anyopaque, dist: i32, high: ?*i32, method: DWORD) callconv(.winapi) DWORD;

const INVALID_HANDLE: *anyopaque = @ptrFromInt(std.math.maxInt(usize));
const GENERIC_WRITE: DWORD = 0x40000000;
const FILE_SHARE_READ: DWORD = 0x00000001;
const OPEN_ALWAYS: DWORD = 4;
const FILE_ATTRIBUTE_NORMAL: DWORD = 0x80;
const FILE_END: DWORD = 2;

const SNAPSHOT_INTERVAL_MS: u32 = 500;

var last_snapshot_tick: DWORD = 0;

// ── JSON buffer writer ──────────────────────────────────────────────

const BUF_SIZE = 65536;

const JsonWriter = struct {
    buf: [BUF_SIZE]u8 = undefined,
    pos: usize = 0,
    overflow: bool = false,

    fn raw(self: *JsonWriter, s: []const u8) void {
        if (self.overflow) return;
        if (self.pos + s.len > BUF_SIZE) {
            self.overflow = true;
            return;
        }
        @memcpy(self.buf[self.pos .. self.pos + s.len], s);
        self.pos += s.len;
    }

    fn int(self: *JsonWriter, val: i32) void {
        if (self.overflow) return;
        var b: [12]u8 = undefined;
        var v: u32 = undefined;
        var i: usize = 12;
        if (val < 0) {
            self.raw("-");
            v = @intCast(-@as(i64, val));
        } else {
            v = @intCast(val);
        }
        if (v == 0) {
            self.raw("0");
            return;
        }
        while (v > 0 and i > 0) {
            i -= 1;
            b[i] = @intCast((v % 10) + '0');
            v /= 10;
        }
        self.raw(b[i..12]);
    }

    fn uint(self: *JsonWriter, val: u32) void {
        if (self.overflow) return;
        var b: [10]u8 = undefined;
        var v = val;
        var i: usize = 10;
        if (v == 0) {
            self.raw("0");
            return;
        }
        while (v > 0 and i > 0) {
            i -= 1;
            b[i] = @intCast((v % 10) + '0');
            v /= 10;
        }
        self.raw(b[i..10]);
    }

    fn key(self: *JsonWriter, k: []const u8) void {
        self.raw("\"");
        self.raw(k);
        self.raw("\":");
    }

    fn keyInt(self: *JsonWriter, k: []const u8, val: i32) void {
        self.key(k);
        self.int(val);
    }

    fn keyUint(self: *JsonWriter, k: []const u8, val: u32) void {
        self.key(k);
        self.uint(val);
    }

    fn comma(self: *JsonWriter) void {
        self.raw(",");
    }

    fn result(self: *JsonWriter) ?[]const u8 {
        if (self.overflow) return null;
        return self.buf[0..self.pos];
    }
};

// ── Stat helpers ────────────────────────────────────────────────────

fn getStat(unit: *UnitAny, stat_id: u32) i32 {
    return @bitCast(d2.functions.GetUnitStat.call(unit, stat_id, 0));
}

fn getStatUnsigned(unit: *UnitAny, stat_id: u32) u32 {
    return d2.functions.GetUnitStat.call(unit, stat_id, 0);
}

fn getDifficulty() u32 {
    const ptr: *const u8 = @ptrFromInt(0x7A060C); // CLIENT_nDifficulty
    return ptr.*;
}

fn getStatShifted(unit: *UnitAny, stat_id: u32) i32 {
    return getStat(unit, stat_id) >> 8;
}

fn getState(unit: *UnitAny, state_no: u32) bool {
    return d2.functions.GetUnitState.call(unit, state_no) != 0;
}

fn distance(x1: i32, y1: i32, x2: i32, y2: i32) i32 {
    const dx = x1 - x2;
    const dy = y1 - y2;
    // Approximate distance (Chebyshev is fine for D2 tile grid)
    const adx = if (dx < 0) -dx else dx;
    const ady = if (dy < 0) -dy else dy;
    return if (adx > ady) adx else ady;
}

// ── MonStats txt reader ─────────────────────────────────────────────

fn readMonStatShort(txt: [*]u8, offset: usize) i16 {
    return @as(*align(1) const i16, @ptrCast(txt + offset)).*;
}

const MonTxtInfo = struct {
    level: i16,
    velocity: i16,
    ai: i16,
    res_fire: i16,
    res_cold: i16,
    res_light: i16,
    res_poison: i16,
    a1_min_d: i16,
    a1_max_d: i16,
};

fn getMonTxtInfo(class_id: u32, difficulty: u32) ?MonTxtInfo {
    const txt = d2.functions.TxtMonStatsGetLine.call(.{@as(i32, @bitCast(class_id))}) orelse return null;
    // Difficulty offsets: 0=normal, 1=nightmare, 2=hell (each +2 bytes)
    const diff: usize = if (difficulty > 2) 0 else difficulty;
    return MonTxtInfo{
        .level = readMonStatShort(txt, 0x0AA + diff * 2),
        .velocity = readMonStatShort(txt, 0x032),
        .ai = readMonStatShort(txt, 0x01E),
        .res_fire = readMonStatShort(txt, 0x150 + diff * 2),
        .res_cold = readMonStatShort(txt, 0x15C + diff * 2),
        .res_light = readMonStatShort(txt, 0x156 + diff * 2),
        .res_poison = readMonStatShort(txt, 0x162 + diff * 2),
        .a1_min_d = readMonStatShort(txt, 0x0DA + diff * 2),
        .a1_max_d = readMonStatShort(txt, 0x0E0 + diff * 2),
    };
}

// ── Level info ──────────────────────────────────────────────────────

fn getPlayerLevel(player: *UnitAny) ?*d2.types.Level {
    const room1 = player.getRoom1() orelse return null;
    const room2 = room1.pRoom2 orelse return null;
    return room2.pLevel;
}

// ── Snapshot writer ─────────────────────────────────────────────────

fn writeSnapshot() void {
    const player = d2.globals.playerUnit().* orelse return;
    const pos = player.getPos();
    if (pos.x == 0 and pos.y == 0) return;

    var jw = JsonWriter{};

    jw.raw("{");

    // Timestamp
    jw.keyUint("t", GetTickCount());

    // Level info
    var level_no: u32 = 0;
    const act_no: u32 = player.dwAct;
    const diff: u32 = getDifficulty();
    if (getPlayerLevel(player)) |level| {
        level_no = level.dwLevelNo;
    }
    jw.comma();
    jw.keyUint("lvl", level_no);
    jw.comma();
    jw.keyUint("act", act_no);
    jw.comma();
    jw.keyUint("diff", diff);

    // Player position
    jw.comma();
    jw.keyInt("px", pos.x);
    jw.comma();
    jw.keyInt("py", pos.y);

    // Player mode
    jw.comma();
    jw.keyUint("pmode", player.dwMode);

    // Vital stats (shifted by 8 for HP/mana/stamina)
    jw.comma();
    jw.keyInt("hp", getStatShifted(player, 6));
    jw.comma();
    jw.keyInt("mhp", getStatShifted(player, 7));
    jw.comma();
    jw.keyInt("mp", getStatShifted(player, 8));
    jw.comma();
    jw.keyInt("mmp", getStatShifted(player, 9));
    jw.comma();
    jw.keyInt("stam", getStatShifted(player, 10));
    jw.comma();
    jw.keyInt("mstam", getStatShifted(player, 11));

    // Core attributes
    jw.comma();
    jw.keyInt("str", getStat(player, 0));
    jw.comma();
    jw.keyInt("ene", getStat(player, 1));
    jw.comma();
    jw.keyInt("dex", getStat(player, 2));
    jw.comma();
    jw.keyInt("vit", getStat(player, 3));

    // Level & experience (XP is u32 — level 99 needs 3,520,485,254 which overflows i32)
    jw.comma();
    jw.keyInt("plvl", getStat(player, 12));
    jw.comma();
    jw.keyUint("xp", getStatUnsigned(player, 13));

    // Resistances
    jw.comma();
    jw.keyInt("fr", getStat(player, 39));
    jw.comma();
    jw.keyInt("cr", getStat(player, 41));
    jw.comma();
    jw.keyInt("lr", getStat(player, 43));
    jw.comma();
    jw.keyInt("pr", getStat(player, 45));

    // Damage reduction
    jw.comma();
    jw.keyInt("dr", getStat(player, 36));
    jw.comma();
    jw.keyInt("mdr", getStat(player, 37));

    // Find rates
    jw.comma();
    jw.keyInt("mf", getStat(player, 80));
    jw.comma();
    jw.keyInt("gf", getStat(player, 79));

    // Cast/recovery speeds
    jw.comma();
    jw.keyInt("fcr", getStat(player, 105));
    jw.comma();
    jw.keyInt("fhr", getStat(player, 99));
    jw.comma();
    jw.keyInt("fbr", getStat(player, 102));
    jw.comma();
    jw.keyInt("ias", getStat(player, 93));

    // Velocity
    jw.comma();
    jw.keyInt("vel", getStat(player, 96));

    // Gold
    jw.comma();
    jw.keyInt("gold", getStat(player, 14));
    jw.comma();
    jw.keyInt("gbank", getStat(player, 15));

    // Player class
    jw.comma();
    jw.keyUint("cls", player.dwTxtFileNo);

    // Player states (important combat states)
    {
        jw.comma();
        jw.raw("\"states\":[");
        var first = true;
        // Check key states: 1=frozen, 2=poison, 9=ampDmg, 28=lowerResist, 51=decrepify,
        // 55=battleOrders, 60=shout, 101=cycloneArmor, 144=boneArmor, 149=fade
        const check_states = [_]u32{ 1, 2, 9, 28, 51, 55, 60, 101, 144, 149 };
        for (check_states) |s| {
            if (getState(player, s)) {
                if (!first) jw.comma();
                jw.uint(s);
                first = false;
            }
        }
        jw.raw("]");
    }

    // Current skills
    if (player.pInfo) |info| {
        if (info.pLeftSkill) |skill| {
            if (skill.pSkillInfo) |si| {
                jw.comma();
                jw.keyUint("lskill", si.wSkillId);
            }
        }
        if (info.pRightSkill) |skill| {
            if (skill.pSkillInfo) |si| {
                jw.comma();
                jw.keyUint("rskill", si.wSkillId);
            }
        }
    }

    // ── Monsters ────────────────────────────────────────────────────
    {
        jw.comma();
        jw.raw("\"ms\":[");
        const tables = d2.globals.serverSideUnits();
        var first = true;
        var mon_count: u32 = 0;

        for (tables.byType[1].table) |first_unit| {
            var unit_opt: ?*UnitAny = first_unit;
            while (unit_opt) |unit| {
                defer unit_opt = unit.pListNext;
                if (mon_count >= 200) break; // cap to prevent buffer overflow

                const mhp = getStatShifted(unit, 6);
                if (mhp == 0) continue; // dead

                const mpos = unit.getPos();
                if (mpos.x == 0 and mpos.y == 0) continue;

                const dist = distance(pos.x, pos.y, mpos.x, mpos.y);

                if (!first) jw.comma();
                first = false;
                mon_count += 1;

                jw.raw("{");
                jw.keyUint("id", unit.dwUnitId);
                jw.comma();
                jw.keyUint("cls", unit.dwTxtFileNo);
                jw.comma();
                jw.keyInt("x", mpos.x);
                jw.comma();
                jw.keyInt("y", mpos.y);
                jw.comma();
                jw.keyInt("hp", mhp);
                jw.comma();
                jw.keyInt("mhp", getStatShifted(unit, 7));
                jw.comma();
                jw.keyUint("m", unit.dwMode);
                jw.comma();
                jw.keyInt("d", dist);

                // Monster type flags and enchants
                const mdata_ptr = unit.pUnitData;
                if (mdata_ptr) |ptr| {
                    const mdata: *MonsterData = @ptrCast(@alignCast(ptr));
                    jw.comma();
                    jw.keyUint("tf", mdata.type_flags);

                    // Enchants as array
                    jw.comma();
                    jw.raw("\"enc\":[");
                    var enc_first = true;
                    for (mdata.enchants) |e| {
                        if (e == 0) break;
                        if (!enc_first) jw.comma();
                        jw.uint(e);
                        enc_first = false;
                    }
                    jw.raw("]");

                    // Unique number for superuniques
                    if (mdata.type_flags & 0x02 != 0) {
                        jw.comma();
                        jw.keyUint("suid", mdata.wUniqueNo);
                    }
                }

                // Monster resistances from txt (for the current difficulty)
                if (getMonTxtInfo(unit.dwTxtFileNo, diff)) |ti| {
                    jw.comma();
                    jw.keyInt("mlvl", ti.level);
                    jw.comma();
                    jw.keyInt("mvel", ti.velocity);
                    jw.comma();
                    jw.keyInt("rfr", ti.res_fire);
                    jw.comma();
                    jw.keyInt("rcr", ti.res_cold);
                    jw.comma();
                    jw.keyInt("rlr", ti.res_light);
                    jw.comma();
                    jw.keyInt("rpr", ti.res_poison);
                }

                // Threat score: HP * type_multiplier / max(dist, 1)
                var threat: i32 = mhp;
                if (mdata_ptr) |ptr| {
                    const mdata: *MonsterData = @ptrCast(@alignCast(ptr));
                    if (mdata.type_flags & 0x02 != 0) {
                        threat *= 5; // unique/superunique
                    } else if (mdata.type_flags & 0x04 != 0) {
                        threat *= 3; // champion
                    }
                }
                const safe_dist = if (dist < 1) @as(i32, 1) else dist;
                threat = @divTrunc(threat, safe_dist);
                jw.comma();
                jw.keyInt("thr", threat);

                jw.raw("}");
            }
        }
        jw.raw("]");
    }

    // ── Ground items ────────────────────────────────────────────────
    {
        jw.comma();
        jw.raw("\"items\":[");
        const tables = d2.globals.serverSideUnits();
        var first = true;
        var item_count: u32 = 0;

        for (tables.byType[4].table) |first_unit| {
            var unit_opt: ?*UnitAny = first_unit;
            while (unit_opt) |unit| {
                defer unit_opt = unit.pListNext;
                if (item_count >= 100) break;

                // Only ground items (mode 3=dropped, 5=dropping)
                if (unit.dwMode != 3 and unit.dwMode != 5) continue;

                const idata_ptr = unit.pUnitData orelse continue;
                const idata: *ItemData = @ptrCast(@alignCast(idata_ptr));

                const ipos = unit.getPos();

                if (!first) jw.comma();
                first = false;
                item_count += 1;

                jw.raw("{");
                jw.keyUint("id", unit.dwUnitId);
                jw.comma();
                jw.keyUint("cls", unit.dwTxtFileNo);
                jw.comma();
                jw.keyInt("x", ipos.x);
                jw.comma();
                jw.keyInt("y", ipos.y);
                jw.comma();
                jw.keyUint("q", idata.dwQuality);
                jw.comma();
                jw.keyUint("ilvl", idata.dwItemLevel);
                jw.comma();
                jw.keyUint("iflags", idata.dwItemFlags);
                jw.comma();
                jw.keyInt("d", distance(pos.x, pos.y, ipos.x, ipos.y));

                // Sockets
                const sockets = d2.functions.GetUnitStat.call(unit, 194, 0);
                if (sockets > 0) {
                    jw.comma();
                    jw.keyUint("soc", sockets);
                }

                jw.raw("}");
            }
        }
        jw.raw("]");
    }

    // ── Missiles ────────────────────────────────────────────────────
    {
        jw.comma();
        jw.raw("\"missiles\":[");
        const tables = d2.globals.serverSideUnits();
        var first = true;
        var mis_count: u32 = 0;

        for (tables.byType[3].table) |first_unit| {
            var unit_opt: ?*UnitAny = first_unit;
            while (unit_opt) |unit| {
                defer unit_opt = unit.pListNext;
                if (mis_count >= 50) break;

                const mpos = unit.getPos();

                if (!first) jw.comma();
                first = false;
                mis_count += 1;

                jw.raw("{");
                jw.keyUint("cls", unit.dwTxtFileNo);
                jw.comma();
                jw.keyInt("x", mpos.x);
                jw.comma();
                jw.keyInt("y", mpos.y);
                jw.comma();
                jw.keyUint("own", unit.dwOwnerType);
                jw.comma();
                jw.keyInt("d", distance(pos.x, pos.y, mpos.x, mpos.y));
                jw.raw("}");
            }
        }
        jw.raw("]");
    }

    // ── Nearby players ──────────────────────────────────────────────
    {
        jw.comma();
        jw.raw("\"players\":[");
        const tables = d2.globals.serverSideUnits();
        var first = true;

        for (tables.byType[0].table) |first_unit| {
            var unit_opt: ?*UnitAny = first_unit;
            while (unit_opt) |unit| {
                defer unit_opt = unit.pListNext;
                if (unit.dwUnitId == player.dwUnitId) continue; // skip self

                const ppos = unit.getPos();

                if (!first) jw.comma();
                first = false;

                jw.raw("{");
                jw.keyUint("id", unit.dwUnitId);
                jw.comma();
                jw.keyUint("cls", unit.dwTxtFileNo);
                jw.comma();
                jw.keyInt("x", ppos.x);
                jw.comma();
                jw.keyInt("y", ppos.y);
                jw.comma();
                jw.keyInt("hp", getStatShifted(unit, 6));
                jw.comma();
                jw.keyUint("m", unit.dwMode);
                jw.comma();
                jw.keyInt("d", distance(pos.x, pos.y, ppos.x, ppos.y));
                jw.raw("}");
            }
        }
        jw.raw("]");
    }

    jw.raw("}\n");

    // Write to file
    const data = jw.result() orelse {
        log.print("game_data: snapshot buffer overflow");
        return;
    };
    writeToFile(data);
}

const diff_filenames = [3][*:0]const u8{
    "game_data_normal.jsonl",
    "game_data_nightmare.jsonl",
    "game_data_hell.jsonl",
};

fn writeToFile(data: []const u8) void {
    const diff = getDifficulty();
    const filename = if (diff < 3) diff_filenames[diff] else diff_filenames[0];
    const h = CreateFileA(
        filename,
        GENERIC_WRITE,
        FILE_SHARE_READ,
        null,
        OPEN_ALWAYS,
        FILE_ATTRIBUTE_NORMAL,
        null,
    );
    if (h == INVALID_HANDLE) return;
    defer _ = CloseHandle(h);
    _ = SetFilePointer(h, 0, null, FILE_END);
    var written: DWORD = 0;
    _ = WriteFile(h, data.ptr, @intCast(data.len), &written, null);
}

// ── Feature hooks ───────────────────────────────────────────────────

fn gameLoop() void {
    const now = GetTickCount();
    if (now -% last_snapshot_tick >= SNAPSHOT_INTERVAL_MS) {
        last_snapshot_tick = now;
        writeSnapshot();
    }
}

pub const hooks = feature.Hooks{
    .gameLoop = &gameLoop,
};
