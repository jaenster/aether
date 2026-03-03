const std = @import("std");
const feature = @import("../feature.zig");
const d2 = struct {
    const functions = @import("../d2/functions.zig");
    const globals = @import("../d2/globals.zig");
    const types = @import("../d2/types.zig");
};

fn w(comptime s: []const u8) [*:0]const u16 {
    return comptime std.unicode.utf8ToUtf16LeStringLiteral(s);
}

fn fmtInt(val: u32, buf: []u16) usize {
    if (val == 0) {
        buf[0] = '0';
        return 1;
    }
    var v = val;
    var tmp: [10]u16 = undefined;
    var len: usize = 0;
    while (v > 0) : (len += 1) {
        tmp[len] = '0' + @as(u16, @intCast(v % 10));
        v /= 10;
    }
    for (0..len) |i| buf[i] = tmp[len - 1 - i];
    return len;
}

fn drawStat(comptime label: []const u8, cur: u32, max: u32, y: c_int) void {
    var buf: [64]u16 = undefined;
    var pos: usize = 0;

    for (comptime std.unicode.utf8ToUtf16LeStringLiteral(label)) |c| {
        buf[pos] = c;
        pos += 1;
    }

    pos += fmtInt(cur, buf[pos..]);
    buf[pos] = '/';
    pos += 1;
    pos += fmtInt(max, buf[pos..]);
    buf[pos] = 0;

    d2.functions.DrawGameText.call(.{ @as([*:0]const u16, @ptrCast(&buf)), 16, y, 0, 0 });
}

fn gamePostDraw() void {
    const player = d2.globals.playerUnit().* orelse return;

    const hp = d2.functions.GetUnitStat.call(player, 6, 0) >> 8;
    const maxhp = d2.functions.GetUnitStat.call(player, 7, 0) >> 8;
    const mp = d2.functions.GetUnitStat.call(player, 8, 0) >> 8;
    const maxmp = d2.functions.GetUnitStat.call(player, 9, 0) >> 8;
    const level = d2.functions.GetUnitStat.call(player, 12, 0);

    _ = d2.functions.SetFont.call(.{1});

    // Level
    {
        var buf: [32]u16 = undefined;
        var pos: usize = 0;
        for (comptime std.unicode.utf8ToUtf16LeStringLiteral("Lv ")) |c| {
            buf[pos] = c;
            pos += 1;
        }
        pos += fmtInt(level, buf[pos..]);
        buf[pos] = 0;
        d2.functions.DrawGameText.call(.{ @as([*:0]const u16, @ptrCast(&buf)), 16, 32, 4, 0 });
    }

    drawStat("HP ", hp, maxhp, 48);
    drawStat("MP ", mp, maxmp, 64);
}

fn oogPostDraw() void {
    d2.functions.DrawGameText.call(.{ w("Aether"), 16, 590, 4, 0 });
}

pub const hooks = feature.Hooks{
    .gamePostDraw = &gamePostDraw,
    .oogPostDraw = &oogPostDraw,
};
