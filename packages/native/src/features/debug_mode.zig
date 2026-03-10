const std = @import("std");
const feature = @import("../feature.zig");
const patch = @import("../hook/patch.zig");
const log = @import("../log.zig");
const settings = @import("settings.zig");
const d2 = struct {
    const functions = @import("../d2/functions.zig");
    const globals = @import("../d2/globals.zig");
    const types = @import("../d2/types.zig");
    const automap = @import("../d2/automap.zig");
};

var patched: bool = false;

// Single function that draws all world geometry + units (floor, walls, shadows, entities)
// RET-patching this keeps UI, automap, and cursor intact.
const DrawWorldNonUI: usize = 0x00476bc0;

var saved_byte: u8 = 0;
var saved: bool = false;

fn patchDraw() void {
    if (!saved) {
        saved_byte = @as(*const u8, @ptrFromInt(DrawWorldNonUI)).*;
        saved = true;
    }
    _ = patch.writeBytes(DrawWorldNonUI, &[_]u8{0xC3});
}

fn unpatchDraw() void {
    if (!saved) return;
    _ = patch.writeBytes(DrawWorldNonUI, &[_]u8{saved_byte});
}

fn wantPatch() bool {
    return settings.debug_mode or settings.no_game_drawing;
}

fn keyEvent(key: u32, down: bool, _: u32) bool {
    if (key == 0x79 and down) { // VK_F10
        settings.debug_mode = !settings.debug_mode;
        return false;
    }
    return true;
}

fn gameLoop() void {
    if (wantPatch() and !patched) {
        patchDraw();
        patched = true;
    } else if (!wantPatch() and patched) {
        unpatchDraw();
        patched = false;
    }
}

fn drawCollRoom(room1: *d2.types.Room1) void {
    if (!settings.debug_mode) return;

    const coll = room1.pColl orelse return;
    const map_start = coll.pMapStart orelse return;

    const size_x = coll.dwSizeGameX;
    const size_y = coll.dwSizeGameY;
    if (size_x == 0 or size_y == 0 or size_x > 1024 or size_y > 1024) return;

    const base_x = @as(f64, @floatFromInt(coll.dwPosGameX));
    const base_y = @as(f64, @floatFromInt(coll.dwPosGameY));

    const screen_w = d2.globals.screenWidth().*;
    const screen_h = d2.globals.screenHeight().*;

    var x: u32 = 0;
    while (x < size_x) : (x += 1) {
        var y: u32 = 0;
        while (y < size_y) : (y += 1) {
            const idx = y * size_x + x;
            const flags = map_start[idx];

            const color: u32 = if (flags & 0x4 != 0)
                0x62 // wall
            else if (flags & 0xC09 != 0)
                0x4B // block + no-walk
            else if (flags & 0x180 != 0)
                0x8E // special
            else if (flags & 0x10 != 0)
                0x4 // missile-block
            else
                0x18; // walkable

            const wx = base_x + @as(f64, @floatFromInt(x)) + 0.5;
            const wy = base_y + @as(f64, @floatFromInt(y)) + 0.5;
            drawWorldX(wx, wy, color, 0.5, screen_w, screen_h);
        }
    }
}

fn drawWorldX(x: f64, y: f64, color: u32, size: f64, screen_w: c_int, screen_h: c_int) void {
    const a1 = d2.automap.toScreen(x - size, y);
    const b1 = d2.automap.toScreen(x + size, y);
    const a2 = d2.automap.toScreen(x, y - size);
    const b2 = d2.automap.toScreen(x, y + size);

    if (b1.x < 0 or a1.x >= screen_w or b2.y < 0 or a2.y >= screen_h) return;

    d2.functions.DrawLine.call(a1.x, a1.y, b1.x, b1.y, color, 0xFF);
    d2.functions.DrawLine.call(a2.x, a2.y, b2.x, b2.y, color, 0xFF);
}

fn gamePostDraw() void {
    if (!settings.debug_mode) return;

    const player = d2.globals.playerUnit().* orelse return;
    const path = player.dynamicPath() orelse return;
    const room1 = path.pRoom1 orelse return;

    drawCollRoom(room1);

    const near_count = room1.dwRoomsNear;
    if (near_count == 0 or near_count > 64) return;
    const rooms_near = room1.pRoomsNear orelse return;

    var i: u32 = 0;
    while (i < near_count) : (i += 1) {
        if (rooms_near[i]) |near_room| {
            drawCollRoom(near_room);
        }
    }
}

fn deinit() void {
    if (patched) {
        unpatchDraw();
        patched = false;
    }
}

pub const hooks = feature.Hooks{
    .keyEvent = &keyEvent,
    .gameLoop = &gameLoop,
    .gameAutomapPostDraw = &gamePostDraw,
    .deinit = &deinit,
};
