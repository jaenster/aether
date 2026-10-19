//! AetherEmbed.dll: embed.zig behind a C ABI for hosts that are not Zig.
//! No DllMain of its own beyond the CRT's, no patch on load.

const embed = @import("embed.zig");

pub const LogFn = *const fn (line: [*]const u8, len: u32) callconv(.c) void;
pub const ShotFn = *const fn (path: [*:0]const u8) callconv(.c) void;

var c_log: ?LogFn = null;
var c_shot: ?ShotFn = null;

fn logThunk(line: []const u8) void {
    if (c_log) |f| f(line.ptr, @intCast(line.len));
}

fn shotThunk(path: [*:0]const u8) void {
    if (c_shot) |f| f(path);
}

export fn aether_init(mozjs: *anyopaque, log: LogFn, shot: ?ShotFn, heap_limit_mb: i32) callconv(.c) c_int {
    c_log = log;
    c_shot = shot;
    return @intFromBool(embed.init(.{
        .mozjs = mozjs,
        .log = &logThunk,
        .screenshot = if (shot != null) &shotThunk else null,
        .heap_limit_mb = heap_limit_mb,
    }));
}

export fn aether_tick(in_game: c_int) callconv(.c) void {
    embed.tick(in_game != 0);
}

export fn aether_packet_in(bytes: [*]const u8, size: u32) callconv(.c) c_int {
    return @intFromBool(embed.packetIn(bytes, size));
}

export fn aether_packet_out(bytes: [*]const u8, size: u32) callconv(.c) c_int {
    return @intFromBool(embed.packetOut(bytes, size));
}

export fn aether_draw_game() callconv(.c) void {
    embed.drawGame();
}

export fn aether_draw_automap() callconv(.c) void {
    embed.drawAutomap();
}

export fn aether_draw_oog() callconv(.c) void {
    embed.drawOog();
}

export fn aether_shutdown() callconv(.c) void {
    embed.shutdown();
}
