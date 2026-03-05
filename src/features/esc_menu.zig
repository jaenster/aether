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

// Font indices
const FONT_MENU: u32 = 3; // Largest font (41px height)
const FONT_SMALL: u32 = 1; // Small readable font for submenu rows

// Text color
const TEXT_COLOR_GOLD: u32 = 0; // White/default — game applies palette from font

// Submenu layout
const TOTAL_ROWS: i32 = @as(i32, @intCast(settings.entries.len)) + 1; // 13 toggles + Previous Menu
const ROW_SPACING: i32 = 22;

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
const OFF_MAIN_DC6: usize = 0x53C;

// Header fields (i32 each)
const HDR_COUNT: usize = 0;
const HDR_ROW_H: usize = 8;

// ============================================================================
// State
// ============================================================================

const State = enum { inactive, options_page, aether_submenu };
var state: State = .inactive;
var initialized: bool = false;
var init_attempted: bool = false;

// Our custom table memory (options page only)
var ext_options_header: usize = 0; // points to our 6-entry header
var ext_options_table: usize = 0; // points to our 6-entry table

// Submenu state — we manage selection ourselves
var sub_selected: i32 = 0;
var mouse_x: i32 = 0;
var mouse_y: i32 = 0;

// Frame counter: draw hook increments, input handlers compare to detect
// when the ESC menu is no longer being drawn.
var draw_frame: u32 = 0;
var last_input_frame: u32 = 0;

// Wide string constants
const aether_label: [*:0]const u16 = std.unicode.utf8ToUtf16LeStringLiteral("AETHER");
const prev_menu_label: [*:0]const u16 = std.unicode.utf8ToUtf16LeStringLiteral("Previous Menu");
const on_text: [*:0]const u16 = toW("\xffc2On");
const off_text: [*:0]const u16 = toW("\xffc1Off");

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
// Transparent DC6 generator
// ============================================================================

fn buildTransparentDC6(width: u32, height: u32) ?*anyopaque {
    const dc6 = @import("../d2/dc6.zig");
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
    _ = d2.functions.SetFont.call(.{FONT_SMALL});

    // --- Extended Options table (6 entries) ---
    ext_options_header = @intFromPtr(VirtualAlloc(null, HEADER_SIZE, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE) orelse return);
    ext_options_table = @intFromPtr(VirtualAlloc(null, 6 * ITEM_SIZE, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE) orelse return);

    // Copy native header, set count to 6
    const native_hdr: [*]const u8 = @ptrFromInt(OPTIONS_HEADER_ADDR);
    const ext_hdr: [*]u8 = @ptrFromInt(ext_options_header);
    @memcpy(ext_hdr[0..HEADER_SIZE], native_hdr[0..HEADER_SIZE]);
    const count_ptr: *i32 = @ptrFromInt(ext_options_header + HDR_COUNT);
    count_ptr.* = 6;

    // Entry 0: AETHER (transparent DC6 placeholder — we draw text via DrawGameText)
    const placeholder = buildTransparentDC6(256, 36);
    itemFieldPtr(i32, ext_options_table, 0, OFF_TYPE).* = 0;
    itemFieldPtr(i32, ext_options_table, 0, OFF_EXPANSION).* = 0;
    itemFieldPtr(?*anyopaque, ext_options_table, 0, OFF_MAIN_DC6).* = placeholder;

    // Entries 1-5: copy 5 native entries
    const native_tbl: [*]const u8 = @ptrFromInt(OPTIONS_TABLE_ADDR);
    const ext_tbl: [*]u8 = @ptrFromInt(ext_options_table);
    @memcpy(ext_tbl[ITEM_SIZE .. 6 * ITEM_SIZE], native_tbl[0 .. 5 * ITEM_SIZE]);

    initialized = true;
    log.print("esc_menu: tables initialized");
}

// ============================================================================
// Draw hook — replaces CALL to DRAW_EscMenu at 0x456F46
// ============================================================================

fn hookDrawEscMenu() callconv(.winapi) void {
    const original: *const fn () callconv(.winapi) void = @ptrFromInt(ADDR_DRAW_ESCMENU);

    draw_frame +%= 1;

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
            // Don't call original — we own the screen in submenu state
            drawSubmenu();
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

fn drawAetherLabel() void {
    const computed_y = itemFieldPtr(i32, ext_options_table, 0, OFF_COMPUTED_Y).*;
    if (computed_y == 0) return;

    const row_h: i32 = @as(*const i32, @ptrFromInt(ext_options_header + HDR_ROW_H)).*;
    const draw_y = computed_y + row_h;

    const prev_font = d2.functions.SetFont.call(.{FONT_MENU});
    var tw: u32 = 0;
    var th: u32 = 0;
    _ = d2.functions.GetTextSize.call(.{ aether_label, &tw, &th });
    const x = @divTrunc(d2.globals.screenWidth().* - @as(c_int, @intCast(tw)), 2);
    d2.functions.DrawGameText.call(.{ aether_label, x, draw_y, TEXT_COLOR_GOLD, 0 });
    _ = d2.functions.SetFont.call(.{prev_font});
}

// ============================================================================
// Submenu drawing (pure text, Configure Controls style)
// ============================================================================

fn submenuLayout() struct { start_y: i32, label_x: i32, value_x: i32 } {
    const sw = d2.globals.screenWidth().*;
    const sh = d2.globals.screenHeight().*;
    const total_h = TOTAL_ROWS * ROW_SPACING + 60; // 60px for title gap
    const start_y = @divTrunc(sh - total_h, 2) + 60;
    return .{
        .start_y = start_y,
        .label_x = @divTrunc(sw, 4),
        .value_x = sw - @divTrunc(sw, 4),
    };
}

fn drawSubmenu() void {
    const sw = d2.globals.screenWidth().*;
    const sh = d2.globals.screenHeight().*;
    const layout = submenuLayout();

    // Dark background
    d2.functions.DrawSolidRectAlpha.call(0, 0, sw, sh, 0, 0xD0);

    // Title: "AETHER" centered at top
    const prev_font = d2.functions.SetFont.call(.{FONT_MENU});
    var tw: u32 = 0;
    var th: u32 = 0;
    _ = d2.functions.GetTextSize.call(.{ aether_label, &tw, &th });
    const title_x = @divTrunc(sw - @as(c_int, @intCast(tw)), 2);
    const title_y = layout.start_y - 40;
    d2.functions.DrawGameText.call(.{ aether_label, title_x, title_y, TEXT_COLOR_GOLD, 0 });

    // Switch to small font for rows
    _ = d2.functions.SetFont.call(.{FONT_SMALL});

    // Draw 13 setting rows
    for (0..settings.entries.len) |i| {
        const row_y = layout.start_y + @as(i32, @intCast(i)) * ROW_SPACING;
        const ii: i32 = @intCast(i);

        // Highlight selected row
        if (ii == sub_selected) {
            d2.functions.DrawSolidRectAlpha.call(
                layout.label_x - 10,
                row_y - ROW_SPACING + 4,
                layout.value_x + 10,
                row_y + 4,
                0x0D,
                0x60,
            );
        }

        // Label (left-aligned)
        d2.functions.DrawGameText.call(.{ settings.entries[i].label, layout.label_x, row_y, TEXT_COLOR_GOLD, 0 });

        // On/Off value (right-aligned)
        const val_text: [*:0]const u16 = if (settings.entries[i].setting.*) on_text else off_text;
        var vw: u32 = 0;
        var vh: u32 = 0;
        _ = d2.functions.GetTextSize.call(.{ val_text, &vw, &vh });
        d2.functions.DrawGameText.call(.{ val_text, layout.value_x - @as(c_int, @intCast(vw)), row_y, TEXT_COLOR_GOLD, 0 });
    }

    // "Previous Menu" centered at bottom
    const prev_y = layout.start_y + @as(i32, @intCast(settings.entries.len)) * ROW_SPACING + ROW_SPACING;

    // Highlight if selected
    if (sub_selected == TOTAL_ROWS - 1) {
        var pmw: u32 = 0;
        var pmh: u32 = 0;
        _ = d2.functions.GetTextSize.call(.{ prev_menu_label, &pmw, &pmh });
        const pm_x = @divTrunc(sw - @as(c_int, @intCast(pmw)), 2);
        d2.functions.DrawSolidRectAlpha.call(
            pm_x - 10,
            prev_y - ROW_SPACING + 4,
            pm_x + @as(c_int, @intCast(pmw)) + 10,
            prev_y + 4,
            0x0D,
            0x60,
        );
    }

    {
        var pmw: u32 = 0;
        var pmh: u32 = 0;
        _ = d2.functions.GetTextSize.call(.{ prev_menu_label, &pmw, &pmh });
        const pm_x = @divTrunc(sw - @as(c_int, @intCast(pmw)), 2);
        d2.functions.DrawGameText.call(.{ prev_menu_label, pm_x, prev_y, TEXT_COLOR_GOLD, 0 });
    }

    // Restore font
    _ = d2.functions.SetFont.call(.{prev_font});
}

// ============================================================================
// Input: keyboard
// ============================================================================

fn checkMenuAlive() void {
    // If draw hook hasn't fired since last input check, menu closed
    if (draw_frame == last_input_frame and state != .inactive) {
        state = .inactive;
    }
    last_input_frame = draw_frame;
}

fn keyEvent(key: u32, down: bool, _: u32) bool {
    if (!down or !initialized) return true;
    checkMenuAlive();

    return switch (state) {
        .options_page => handleOptionsKey(key),
        .aether_submenu => handleSubmenuKey(key),
        .inactive => true,
    };
}

fn handleOptionsKey(key: u32) bool {
    const idx = gnEscMenuSelectedIndex.*;

    if (key == VK_RETURN and idx == 0) {
        state = .aether_submenu;
        sub_selected = 0;
        return false;
    }

    // Native only knows 5 entries (0-4), so handle wrapping for our 6-entry table.
    // AETHER is at 0, native items at 1-5. Native would wrap at count=5.
    if (key == VK_DOWN) {
        if (idx == 4) {
            gnEscMenuSelectedIndex.* = 5;
            return false;
        } else if (idx == 5) {
            gnEscMenuSelectedIndex.* = 0;
            return false;
        }
    } else if (key == VK_UP) {
        if (idx == 0) {
            gnEscMenuSelectedIndex.* = 5;
            return false;
        } else if (idx == 5) {
            gnEscMenuSelectedIndex.* = 4;
            return false;
        }
    }

    return true;
}

fn handleSubmenuKey(key: u32) bool {
    switch (key) {
        VK_UP => {
            sub_selected -= 1;
            if (sub_selected < 0) sub_selected = TOTAL_ROWS - 1;
            return false;
        },
        VK_DOWN => {
            sub_selected += 1;
            if (sub_selected >= TOTAL_ROWS) sub_selected = 0;
            return false;
        },
        VK_RETURN => {
            if (sub_selected >= 0 and sub_selected < @as(i32, @intCast(settings.entries.len))) {
                const ui: usize = @intCast(sub_selected);
                settings.entries[ui].setting.* = !settings.entries[ui].setting.*;
                settings.saveSettings();
            } else if (sub_selected == TOTAL_ROWS - 1) {
                state = .options_page;
                gnEscMenuSelectedIndex.* = 0;
            }
            return false;
        },
        VK_ESCAPE => {
            state = .options_page;
            gnEscMenuSelectedIndex.* = 0;
            return false;
        },
        else => return false, // consume all keys in submenu
    }
}

// ============================================================================
// Input: mouse
// ============================================================================

fn mouseEvent(x: i32, y: i32, button: u8, down: bool) bool {
    mouse_x = x;
    mouse_y = y;

    if (!initialized) return true;
    checkMenuAlive();

    switch (state) {
        .options_page => {
            if (button == 0 and !down and gnEscMenuSelectedIndex.* == 0) {
                state = .aether_submenu;
                sub_selected = 0;
                return false;
            }
            return true;
        },
        .aether_submenu => {
            // Compute which row the mouse is over
            const layout = submenuLayout();
            const row = hitTestRow(y, layout.start_y);

            // Mouse hover updates selection
            if (row >= 0 and row < TOTAL_ROWS) {
                sub_selected = row;
            }

            if (button == 0 and !down) {
                if (row >= 0 and row < @as(i32, @intCast(settings.entries.len))) {
                    const ui: usize = @intCast(row);
                    settings.entries[ui].setting.* = !settings.entries[ui].setting.*;
                    settings.saveSettings();
                } else if (row == TOTAL_ROWS - 1) {
                    state = .options_page;
                    gnEscMenuSelectedIndex.* = 0;
                }
            }
            return false; // consume all mouse events in submenu
        },
        .inactive => return true,
    }
}

fn hitTestRow(y: i32, start_y: i32) i32 {
    // Setting rows (0..12)
    for (0..settings.entries.len) |i| {
        const row_y = start_y + @as(i32, @intCast(i)) * ROW_SPACING;
        const row_top = row_y - ROW_SPACING + 4;
        const row_bot = row_y + 4;
        if (y >= row_top and y < row_bot) return @intCast(i);
    }

    // Previous Menu row
    const prev_y = start_y + @as(i32, @intCast(settings.entries.len)) * ROW_SPACING + ROW_SPACING;
    const prev_top = prev_y - ROW_SPACING + 4;
    const prev_bot = prev_y + 4;
    if (y >= prev_top and y < prev_bot) return TOTAL_ROWS - 1;

    return -1;
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
