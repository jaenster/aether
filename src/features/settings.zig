const std = @import("std");
const feature = @import("../feature.zig");
const log = @import("../log.zig");
const d2 = struct {
    const functions = @import("../d2/functions.zig");
    const globals = @import("../d2/globals.zig");
    const types = @import("../d2/types.zig");
};

const RECT = d2.types.RECT;

// ============================================================================
// Public settings — other features read these
// ============================================================================
pub var reveal_map: bool = true;
pub var show_monsters: bool = true;
pub var show_items: bool = true;
pub var show_missiles: bool = true;
pub var disable_weather: bool = true;
pub var omnivision: bool = true;
pub var debug_mode: bool = false;
pub var no_game_drawing: bool = false;
pub var disable_roofs: bool = false;
pub var no_pickup: bool = false;
pub var auto_teleport: bool = true;

// ============================================================================
// Dialog state
// ============================================================================
var visible: bool = false;

const Entry = struct {
    label: [*:0]const u16,
    setting: *bool,
};

// D2 uses wide strings with color codes: \xff\x63\x32 = ÿc2 = green, ÿc1 = red
const entries = [_]Entry{
    .{ .label = toW("Reveal Map"), .setting = &reveal_map },
    .{ .label = toW("Show Monsters"), .setting = &show_monsters },
    .{ .label = toW("Show Items"), .setting = &show_items },
    .{ .label = toW("Show Missiles"), .setting = &show_missiles },
    .{ .label = toW("Disable Weather"), .setting = &disable_weather },
    .{ .label = toW("Omnivision"), .setting = &omnivision },
    .{ .label = toW("Debug Mode"), .setting = &debug_mode },
    .{ .label = toW("No Game Drawing"), .setting = &no_game_drawing },
    .{ .label = toW("Disable Rooftops"), .setting = &disable_roofs },
    .{ .label = toW("No Pickup"), .setting = &no_pickup },
    .{ .label = toW("Auto Teleport"), .setting = &auto_teleport },
};

const on_text = toW("\xffc2On");
const off_text = toW("\xffc1Off");
const title_text = toW("Aether Settings");

// Layout constants
const row_height: i32 = 15;
const dialog_width: i32 = 220;
const title_height: i32 = 25;
const inset: i32 = 8;
const dialog_height: i32 = title_height + row_height * @as(i32, entries.len) + row_height;

// ============================================================================
// Comptime wide string helper
// ============================================================================
fn toW(comptime s: []const u8) *const [s.len:0]u16 {
    comptime {
        var buf: [s.len:0]u16 = undefined;
        for (s, 0..) |c, i| {
            buf[i] = c;
        }
        const final = buf;
        return &final;
    }
}

// ============================================================================
// Drawing
// ============================================================================
fn allPostDraw() void {
    if (!visible) return;

    const sw = d2.globals.screenWidth().*;
    const sh = d2.globals.screenHeight().*;
    const ox = @divTrunc(sw - dialog_width, 2);
    const oy = @divTrunc(sh - dialog_height, 2);

    // Background
    d2.functions.DrawSolidRectAlpha.call(ox, oy, ox + dialog_width, oy + dialog_height, 0, 0xD0);

    // Border
    var border = RECT{
        .left = ox,
        .top = oy,
        .right = ox + dialog_width,
        .bottom = oy + dialog_height,
    };
    d2.functions.DrawRect.call(&border, 0xD);

    // Title
    _ = d2.functions.SetFont.call(.{5});
    var tw: u32 = 0;
    var tf: u32 = 5;
    _ = d2.functions.GetTextSize.call(.{ title_text, &tw, &tf });
    d2.functions.DrawGameText.call(.{
        title_text,
        ox + @divTrunc(dialog_width - @as(i32, @intCast(tw)), 2),
        oy + title_height - 4,
        0,
        0,
    });

    // Rows
    _ = d2.functions.SetFont.call(.{0});
    for (entries, 0..) |entry, i| {
        const ry = oy + title_height + @as(i32, @intCast(i)) * row_height;

        // Hover highlight
        const mx = mouse_x - ox;
        const my = mouse_y - oy;
        const row_top = title_height + @as(i32, @intCast(i)) * row_height;
        if (mx >= 0 and mx < dialog_width and my >= row_top and my < row_top + row_height) {
            d2.functions.DrawSolidRectAlpha.call(ox + 1, ry, ox + dialog_width - 1, ry + row_height, 0x0D, 0x40);
        }

        // Label
        d2.functions.DrawGameText.call(.{ entry.label, ox + inset, ry + row_height - 3, 4, 0 });

        // Value
        const val_text = if (entry.setting.*) on_text else off_text;
        var vw: u32 = 0;
        var vf: u32 = 0;
        _ = d2.functions.GetTextSize.call(.{ val_text, &vw, &vf });
        d2.functions.DrawGameText.call(.{ val_text, ox + dialog_width - inset - @as(i32, @intCast(vw)), ry + row_height - 3, 0, 0 });
    }
}

// ============================================================================
// Input
// ============================================================================
var mouse_x: i32 = 0;
var mouse_y: i32 = 0;

fn keyEvent(key: u32, down: bool, _: u32) bool {
    if (key == 0x7B and down) { // VK_F12
        visible = !visible;
        return false;
    }
    if (key == 0x1B and down and visible) { // VK_ESCAPE
        visible = false;
        return false;
    }
    // Block all keys while dialog is visible
    if (visible) return false;
    return true;
}

fn mouseEvent(x: i32, y: i32, button: u8, down: bool) bool {
    mouse_x = x;
    mouse_y = y;

    if (!visible) return true;

    const sw = d2.globals.screenWidth().*;
    const sh = d2.globals.screenHeight().*;
    const ox = @divTrunc(sw - dialog_width, 2);
    const oy = @divTrunc(sh - dialog_height, 2);

    const lx = x - ox;
    const ly = y - oy;

    // Check if click is inside dialog
    if (lx < 0 or lx >= dialog_width or ly < 0 or ly >= dialog_height) {
        return false; // Still consume — don't click through
    }

    // Left click release on a row = toggle
    if (button == 0 and !down) {
        const row_y = ly - title_height;
        if (row_y >= 0) {
            const row_idx = @as(usize, @intCast(@divTrunc(row_y, row_height)));
            if (row_idx < entries.len) {
                entries[row_idx].setting.* = !entries[row_idx].setting.*;
                saveSettings();
            }
        }
    }

    return false; // Consume all mouse events while dialog is open
}

// ============================================================================
// Settings file persistence
// ============================================================================
extern "kernel32" fn GetModuleFileNameA(?*anyopaque, [*]u8, u32) callconv(.winapi) u32;

var settings_path: [512]u8 = undefined;
var settings_path_len: usize = 0;

fn initSettingsPath() void {
    const len = GetModuleFileNameA(null, &settings_path, settings_path.len);
    // Replace .exe with aether.ini
    var i: usize = len;
    while (i > 0) {
        i -= 1;
        if (settings_path[i] == '\\' or settings_path[i] == '/') {
            i += 1;
            break;
        }
    }
    const suffix = "aether.ini";
    for (suffix, 0..) |c, j| {
        settings_path[i + j] = c;
    }
    settings_path_len = i + suffix.len;
    settings_path[settings_path_len] = 0;
}

fn init() void {
    initSettingsPath();
    loadSettings();
    log.print("settings: initialized");
}

fn loadSettings() void {
    const path_ptr: [*:0]const u8 = @ptrCast(&settings_path);
    const file = std.fs.openFileAbsoluteZ(path_ptr, .{}) catch return;
    defer file.close();

    var buf: [4096]u8 = undefined;
    const n = file.readAll(&buf) catch return;
    var content = buf[0..n];

    while (content.len > 0) {
        // Find line end
        var line_end: usize = 0;
        while (line_end < content.len and content[line_end] != '\n') : (line_end += 1) {}
        const line = content[0..line_end];
        content = if (line_end < content.len) content[line_end + 1 ..] else content[content.len..];

        // Parse "key: value"
        if (std.mem.indexOf(u8, line, ": ")) |sep| {
            const key = line[0..sep];
            const val_str = std.mem.trimRight(u8, line[sep + 2 ..], "\r\n ");
            const val = std.fmt.parseInt(u32, val_str, 10) catch continue;
            applySettingByName(key, val != 0);
        }
    }
}

fn saveSettings() void {
    const path_ptr: [*:0]const u8 = @ptrCast(&settings_path);
    const file = std.fs.createFileAbsoluteZ(path_ptr, .{}) catch return;
    defer file.close();

    inline for (entries) |entry| {
        const name = comptime wideToAscii(entry.label);
        var buf: [128]u8 = undefined;
        const line = std.fmt.bufPrint(&buf, "{s}: {d}\n", .{ name, @as(u32, if (entry.setting.*) 1 else 0) }) catch "";
        file.writeAll(line) catch {};
    }
}

fn applySettingByName(key: []const u8, val: bool) void {
    inline for (entries) |entry| {
        const name = comptime wideToAscii(entry.label);
        if (std.mem.eql(u8, key, name)) {
            entry.setting.* = val;
            return;
        }
    }
}

fn wideToAscii(comptime w: [*:0]const u16) []const u8 {
    comptime {
        var len: usize = 0;
        while (w[len] != 0) : (len += 1) {}
        var buf: [len]u8 = undefined;
        for (0..len) |i| {
            buf[i] = @truncate(w[i]);
        }
        const result = buf;
        return &result;
    }
}

pub const hooks = feature.Hooks{
    .init = &init,
    .keyEvent = &keyEvent,
    .mouseEvent = &mouseEvent,
    .allPostDraw = &allPostDraw,
};
