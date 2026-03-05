const std = @import("std");
const feature = @import("../feature.zig");
const patch = @import("../hook/patch.zig");
const log = @import("../log.zig");
const settings = @import("settings.zig");
const dc6_gen = @import("../d2/dc6_gen.zig");
const d2 = struct {
    const functions = @import("../d2/functions.zig");
    const globals = @import("../d2/globals.zig");
};

// ============================================================================
// Addresses
// ============================================================================

const ADDR_DRAW_ESCMENU_CALL: usize = 0x456F46;
const ADDR_DRAW_ESCMENU: usize = 0x47E3D0;
const OPTIONS_TABLE_ADDR: usize = 0x714238;
const OPTIONS_HEADER_ADDR: usize = 0x714210;

// Game globals
const gpEscMenuItemCount: *usize = @ptrFromInt(0x7BC93C); // ptr to header
const gpEscMenuCurrentTable: *usize = @ptrFromInt(0x7BC940); // ptr to table
const gnEscMenuSelectedIndex: *i32 = @ptrFromInt(0x7BC938);

// Submenu layout
const SUB_SPACING: i32 = 28;

// Font indices
const FONT_MENU: u32 = 3; // Largest font (41px height)
const FONT_FORMAL: u32 = 4; // FontFormal10 — readable for toggles

// Text color
const TEXT_COLOR_GOLD: u32 = 0; // White/default — game applies palette from font

// Keys
const VK_UP: u32 = 0x26;
const VK_DOWN: u32 = 0x28;
const VK_RETURN: u32 = 0x0D;
const VK_ESCAPE: u32 = 0x1B;

// Win32
const DWORD = u32;
extern "kernel32" fn VirtualAlloc(addr: ?*anyopaque, size: usize, alloc_type: DWORD, protect: DWORD) callconv(.winapi) ?[*]u8;
const MEM_COMMIT: DWORD = 0x1000;
const MEM_RESERVE: DWORD = 0x2000;
const PAGE_READWRITE: DWORD = 0x04;

// ============================================================================
// EscMenuItem layout (0x550 bytes)
// ============================================================================

const ITEM_SIZE: usize = 0x550;
const HEADER_SIZE: usize = 16; // 4 × i32

fn itemFieldPtr(comptime T: type, table: usize, index: usize, offset: usize) *T {
    return @ptrFromInt(table + index * ITEM_SIZE + offset);
}

const OFF_TYPE: usize = 0x000;
const OFF_EXPANSION: usize = 0x004;
const OFF_COMPUTED_Y: usize = 0x008;
const OFF_ENABLE_CB: usize = 0x110;
const OFF_PREDRAW_CB: usize = 0x11C;
const OFF_FRAME_IDX: usize = 0x124;
const OFF_MAIN_DC6: usize = 0x53C;
const OFF_SUB_DC6: usize = 0x540; // 4 pointers

// Header fields (i32 each)
const HDR_COUNT: usize = 0;
const HDR_SPACING: usize = 4;
const HDR_ROW_H: usize = 8;
const HDR_STAR_OFF: usize = 12;

// ============================================================================
// State
// ============================================================================

const State = enum { inactive, options_page, aether_submenu };
var state: State = .inactive;
var initialized: bool = false;
var init_attempted: bool = false;

// Our custom table memory
var ext_options_header: usize = 0; // points to our 6-entry header
var ext_options_table: usize = 0; // points to our 6-entry table
var sub_header: usize = 0; // points to our 14-entry submenu header
var sub_table: usize = 0; // points to our 14-entry submenu table

// DC6 contexts
var toggle_off_dc6: ?*anyopaque = null;
var toggle_on_dc6: ?*anyopaque = null;

// Wide string for DrawGameText
const aether_label: [*:0]const u16 = std.unicode.utf8ToUtf16LeStringLiteral("AETHER");

// ============================================================================
// ASCII label extraction from settings (comptime)
// ============================================================================

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

// ============================================================================
// Transparent DC6 generator
// ============================================================================

/// Build a 1-frame transparent CellFile of given dimensions.
/// Native draw will process it (computing Y, star cursor) but render nothing visible.
fn buildTransparentDC6(width: u32, height: u32) ?*anyopaque {
    const dc6 = @import("../d2/dc6.zig");

    // Build frame: all transparent pixels (zeroed buffer)
    const pixel_count = width * height;
    const pixels = VirtualAlloc(null, pixel_count, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE) orelse return null;

    return dc6_gen.buildCellFile(&[_]dc6.FrameInput{
        .{ .pixels = pixels[0..pixel_count], .width = width, .height = height },
    });
}

// ============================================================================
// Lazy initialization
// ============================================================================

fn initTables() void {
    if (initialized or init_attempted) return;
    init_attempted = true;

    log.print("esc_menu: initializing");

    // Force-load the fonts we need
    _ = d2.functions.SetFont.call(.{FONT_MENU});
    _ = d2.functions.SetFont.call(.{FONT_FORMAL});

    // Generate On/Off DC6s (shared by all toggles)
    toggle_off_dc6 = dc6_gen.generateTextDC6(FONT_FORMAL, "Off", "toggle_off");
    toggle_on_dc6 = dc6_gen.generateTextDC6(FONT_FORMAL, "On", "toggle_on");

    if (toggle_off_dc6 == null or toggle_on_dc6 == null) {
        log.print("esc_menu: failed to generate On/Off DC6s");
        return;
    }

    // --- Extended Options table (6 entries) ---
    ext_options_header = @intFromPtr(VirtualAlloc(null, HEADER_SIZE, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE) orelse return);
    ext_options_table = @intFromPtr(VirtualAlloc(null, 6 * ITEM_SIZE, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE) orelse return);

    // Copy native header, set count to 6
    const native_hdr: [*]const u8 = @ptrFromInt(OPTIONS_HEADER_ADDR);
    const ext_hdr: [*]u8 = @ptrFromInt(ext_options_header);
    @memcpy(ext_hdr[0..HEADER_SIZE], native_hdr[0..HEADER_SIZE]);
    const count_ptr: *i32 = @ptrFromInt(ext_options_header + HDR_COUNT);
    count_ptr.* = 6;

    // Copy 5 native entries
    const native_tbl: [*]const u8 = @ptrFromInt(OPTIONS_TABLE_ADDR);
    const ext_tbl: [*]u8 = @ptrFromInt(ext_options_table);
    @memcpy(ext_tbl[0 .. 5 * ITEM_SIZE], native_tbl[0 .. 5 * ITEM_SIZE]);

    // Entry 5: transparent DC6 placeholder — we draw text via DrawGameText instead
    const placeholder = buildTransparentDC6(256, 36);
    itemFieldPtr(i32, ext_options_table, 5, OFF_TYPE).* = 0;
    itemFieldPtr(i32, ext_options_table, 5, OFF_EXPANSION).* = 0;
    itemFieldPtr(?*anyopaque, ext_options_table, 5, OFF_MAIN_DC6).* = placeholder;

    // --- Submenu table (14 entries: 13 toggles + Previous Menu) ---
    sub_header = @intFromPtr(VirtualAlloc(null, HEADER_SIZE, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE) orelse return);
    sub_table = @intFromPtr(VirtualAlloc(null, 14 * ITEM_SIZE, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE) orelse return);

    // Submenu header
    const sub_hdr_count: *i32 = @ptrFromInt(sub_header + HDR_COUNT);
    const sub_hdr_spacing: *i32 = @ptrFromInt(sub_header + HDR_SPACING);
    const sub_hdr_rowh: *i32 = @ptrFromInt(sub_header + HDR_ROW_H);
    const sub_hdr_star: *i32 = @ptrFromInt(sub_header + HDR_STAR_OFF);
    sub_hdr_count.* = 14;
    sub_hdr_spacing.* = SUB_SPACING;
    sub_hdr_rowh.* = SUB_SPACING;
    sub_hdr_star.* = SUB_SPACING + 2;

    // 13 toggle entries
    inline for (0..settings.entries.len) |i| {
        const label_ascii = comptime wideToAscii(settings.entries[i].label);
        const label_name = comptime labelFileName(i);
        const label_dc6 = dc6_gen.generateTextDC6(FONT_FORMAL, label_ascii, label_name);

        itemFieldPtr(i32, sub_table, i, OFF_TYPE).* = 1; // dual-sided
        itemFieldPtr(i32, sub_table, i, OFF_EXPANSION).* = 0;
        itemFieldPtr(?*anyopaque, sub_table, i, OFF_MAIN_DC6).* = label_dc6;
        itemFieldPtr(?*anyopaque, sub_table, i, OFF_SUB_DC6).* = toggle_off_dc6; // [0] = Off
        itemFieldPtr(?*anyopaque, sub_table, i, OFF_SUB_DC6 + 4).* = toggle_on_dc6; // [1] = On
        itemFieldPtr(i32, sub_table, i, OFF_FRAME_IDX).* = if (settings.entries[i].setting.*) 1 else 0;
    }

    // Entry 13: "Previous Menu" (type 0, centered)
    const prev_dc6 = dc6_gen.generateTextDC6(FONT_FORMAL, "Previous Menu", "previous_menu");
    itemFieldPtr(i32, sub_table, 13, OFF_TYPE).* = 0;
    itemFieldPtr(i32, sub_table, 13, OFF_EXPANSION).* = 0;
    itemFieldPtr(?*anyopaque, sub_table, 13, OFF_MAIN_DC6).* = prev_dc6;

    initialized = true;
    log.print("esc_menu: tables initialized");
}

fn labelFileName(comptime i: usize) []const u8 {
    return comptime blk: {
        const d0: u8 = '0' + (i / 10);
        const d1: u8 = '0' + (i % 10);
        break :blk &[_]u8{ 't', 'o', 'g', 'g', 'l', 'e', '_', d0, d1 };
    };
}

// ============================================================================
// Draw hook — replaces CALL to DRAW_EscMenu at 0x456F46
// ============================================================================

fn hookDrawEscMenu() callconv(.winapi) void {
    const original: *const fn () callconv(.winapi) void = @ptrFromInt(ADDR_DRAW_ESCMENU);

    const current_table = gpEscMenuCurrentTable.*;
    const is_options = (current_table == OPTIONS_TABLE_ADDR);

    // Lazy init on first Options detection (try only once)
    if (!initialized and !init_attempted and is_options) {
        initTables();
    }

    if (!initialized) {
        original();
        return;
    }

    switch (state) {
        .aether_submenu => {
            // Update toggle frame indices to reflect current settings
            inline for (0..settings.entries.len) |i| {
                itemFieldPtr(i32, sub_table, i, OFF_FRAME_IDX).* = if (settings.entries[i].setting.*) 1 else 0;
            }

            // Swap to submenu table, draw, restore
            const saved_header = gpEscMenuItemCount.*;
            const saved_table = gpEscMenuCurrentTable.*;
            gpEscMenuItemCount.* = sub_header;
            gpEscMenuCurrentTable.* = sub_table;

            original();

            gpEscMenuItemCount.* = saved_header;
            gpEscMenuCurrentTable.* = saved_table;
        },
        else => {
            if (is_options) {
                state = .options_page;

                // Swap to extended 6-entry table, draw, restore
                const saved_header = gpEscMenuItemCount.*;
                const saved_table = gpEscMenuCurrentTable.*;
                gpEscMenuItemCount.* = ext_options_header;
                gpEscMenuCurrentTable.* = ext_options_table;

                original();

                gpEscMenuItemCount.* = saved_header;
                gpEscMenuCurrentTable.* = saved_table;

                // Draw "AETHER" text over the transparent placeholder using game's font renderer
                drawAetherLabel();
            } else {
                state = .inactive;
                original();
            }
        },
    }
}

/// Draw "AETHER" at entry 5's computed Y position using DrawGameText.
fn drawAetherLabel() void {
    const computed_y = itemFieldPtr(i32, ext_options_table, 5, OFF_COMPUTED_Y).*;
    if (computed_y == 0) return;

    const screen_cx = @divTrunc(d2.globals.screenWidth().*, 2);
    const prev_font = d2.functions.SetFont.call(.{FONT_MENU});
    d2.functions.DrawGameText.call(.{ aether_label, screen_cx, computed_y, TEXT_COLOR_GOLD, 1 });
    _ = d2.functions.SetFont.call(.{prev_font});
}

// ============================================================================
// Input: keyboard
// ============================================================================

fn keyEvent(key: u32, down: bool, _: u32) bool {
    if (!down or !initialized) return true;

    return switch (state) {
        .options_page => handleOptionsKey(key),
        .aether_submenu => handleSubmenuKey(key),
        .inactive => true,
    };
}

fn handleOptionsKey(key: u32) bool {
    const idx = gnEscMenuSelectedIndex.*;

    if (key == VK_RETURN and idx == 5) {
        // Enter on our "AETHER" entry → open submenu
        state = .aether_submenu;
        gnEscMenuSelectedIndex.* = 0;
        return false;
    }

    return true;
}

fn handleSubmenuKey(key: u32) bool {
    const idx = gnEscMenuSelectedIndex.*;

    switch (key) {
        VK_RETURN => {
            if (idx >= 0 and idx < @as(i32, @intCast(settings.entries.len))) {
                // Toggle setting
                const ui: usize = @intCast(idx);
                settings.entries[ui].setting.* = !settings.entries[ui].setting.*;
                settings.saveSettings();
            } else if (idx == 13) {
                // "Previous Menu" → back to options
                state = .options_page;
                gnEscMenuSelectedIndex.* = 5; // highlight Aether
            }
            return false;
        },
        VK_ESCAPE => {
            // Back to options page
            state = .options_page;
            gnEscMenuSelectedIndex.* = 5;
            return false;
        },
        else => return true, // let native handle Up/Down/etc
    }
}

// ============================================================================
// Input: mouse
// ============================================================================

fn mouseEvent(x: i32, y: i32, button: u8, down: bool) bool {
    _ = x;
    _ = y;

    if (!initialized) return true;

    switch (state) {
        .options_page => {
            if (button == 0 and !down and gnEscMenuSelectedIndex.* == 5) {
                // Click release on Aether entry
                state = .aether_submenu;
                gnEscMenuSelectedIndex.* = 0;
                return false;
            }
            return true;
        },
        .aether_submenu => {
            if (button == 0 and !down) {
                const idx = gnEscMenuSelectedIndex.*;
                if (idx >= 0 and idx < @as(i32, @intCast(settings.entries.len))) {
                    const ui: usize = @intCast(idx);
                    settings.entries[ui].setting.* = !settings.entries[ui].setting.*;
                    settings.saveSettings();
                    return false;
                } else if (idx == 13) {
                    state = .options_page;
                    gnEscMenuSelectedIndex.* = 5;
                    return false;
                }
            }
            // In submenu, consume all mouse events to prevent native from acting
            return false;
        },
        .inactive => return true,
    }
}

// ============================================================================
// Init / Deinit
// ============================================================================

fn init() void {
    _ = patch.writeCall(ADDR_DRAW_ESCMENU_CALL, @intFromPtr(&hookDrawEscMenu));
    log.print("esc_menu: draw hook installed");
}

fn deinit() void {
    patch.revertRange(ADDR_DRAW_ESCMENU_CALL, 5);
}

pub const hooks = feature.Hooks{
    .init = &init,
    .deinit = &deinit,
    .keyEvent = &keyEvent,
    .mouseEvent = &mouseEvent,
};
