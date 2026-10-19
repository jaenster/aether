//! Aether as a library inside another host's DLL.
//!
//! The host owns the process: DllMain, every hook site, the crash handler and
//! the log. It loads mozjs.dll itself, calls `init` once, then the callouts
//! below from its own sites on the game thread. On this path Aether writes no
//! byte of Game.exe, allocates no console and writes no log file: nothing here
//! reaches hook/, feature.zig or features/ (`zig build test` checks that).
//!
//! The injector (aether.zig, dbghelp_proxy.zig) is the other way to run the
//! same engine and stays as it is.

const std = @import("std");
const log = @import("log.zig");
const mode = @import("mode.zig");
const script_host = @import("script_host.zig");
const packets = @import("net/packets.zig");
const bindings = @import("sm/bindings.zig");
const draw_list = @import("draw_list.zig");
const d2 = @import("d2/functions.zig");

pub const bridge = @import("sm/bridge.zig");

pub const Host = struct {
    /// The loaded mozjs.dll. Its 31 bridge exports are resolved from it.
    mozjs: *anyopaque,
    /// Every Aether log line, without a line ending.
    log: *const fn ([]const u8) void,
    /// Write the current frame to a .bmp at this path. Without one, a script's
    /// screenshot request is dropped.
    screenshot: ?*const fn ([*:0]const u8) void = null,
    /// JS heap limit.
    heap_limit_mb: i32 = 96,
};

var host: ?Host = null;

/// Set up the engine's host. Returns false (and logs why) when mozjs.dll lacks
/// a bridge export; every callout is then a no-op. The engine itself starts on
/// the first tick.
pub fn init(h: Host) bool {
    log.sink = h.log;
    var missing: ?[:0]const u8 = null;
    if (!bridge.resolve(h.mozjs, &missing)) {
        log.printStr("aether: mozjs.dll lacks the bridge export ", missing orelse "?");
        return false;
    }
    script_host.heap_limit_mb = h.heap_limit_mb;
    host = h;
    log.print("aether: embedded, bridge resolved");
    return true;
}

/// Once per frame on the game thread, in and out of game.
pub fn tick(in_game: bool) void {
    if (host == null) return;
    mode.in_game = in_game;
    if (in_game) script_host.gameTick() else script_host.oogTick();
}

/// A server-to-client packet with its real size, before the game handles it.
/// Returns false when a script blocked it.
pub fn packetIn(bytes: [*]const u8, size: u32) bool {
    if (host == null) return true;
    return packets.received(bytes, size);
}

/// A client-to-server packet before it is sent. Returns false when a script blocked it.
pub fn packetOut(bytes: [*]const u8, size: u32) bool {
    if (host == null) return true;
    return packets.sending(bytes, size);
}

fn screenshot() void {
    const name = bindings.takeScreenshotRequest() orelse return;
    if (host.?.screenshot) |shot| shot(name);
}

/// After the game's world and interface are drawn, under the cursor.
pub fn drawGame() void {
    if (host == null) return;
    const old = d2.SetFont.call(.{1});
    script_host.gamePostDraw();
    script_host.allPostDraw();
    draw_list.renderScreen();
    _ = d2.SetFont.call(.{old});
    screenshot();
}

/// After the automap is drawn.
pub fn drawAutomap() void {
    if (host == null) return;
    script_host.gameAutomapPostDraw();
    draw_list.renderAutomap();
}

/// After an out-of-game screen is drawn, before its cursor.
pub fn drawOog() void {
    if (host == null) return;
    const old = d2.SetFont.call(.{1});
    script_host.oogPostDraw();
    script_host.allPostDraw();
    _ = d2.SetFont.call(.{old});
    screenshot();
}

/// Tear the engine down. The host calls it once, before mozjs.dll is unloaded.
pub fn shutdown() void {
    if (host == null) return;
    script_host.deinit();
    host = null;
    log.sink = null;
}
