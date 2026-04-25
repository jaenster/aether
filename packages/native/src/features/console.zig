// In-game console overlay — toggled with backtick (`), shows log output,
// scrollable history, draws as semi-transparent overlay on game screen.

const std = @import("std");
const feature = @import("../feature.zig");
const log = @import("../log.zig");
const d2 = @import("../d2/functions.zig");

extern "kernel32" fn GetTickCount() callconv(.winapi) u32;

// ============================================================================
// State
// ============================================================================

const MAX_LINES = 300;
const MAX_LINE_LEN = 128; // max chars per line (wide)
const VISIBLE_LINES = 14;

const Line = struct {
    buf: [MAX_LINE_LEN]u16 = .{0} ** MAX_LINE_LEN,
    len: u16 = 0,
    color: u32 = 0, // 0 = white/default
};

var history: [MAX_LINES]Line = [_]Line{.{}} ** MAX_LINES;
var history_count: u32 = 0; // total lines ever added (wraps around ring buffer)
var history_write: u32 = 0; // next write index in ring buffer

var visible: bool = false;
var scroll_offset: u32 = 0; // 0 = bottom (most recent), >0 = scrolled up

var cursor_tick: u32 = 0;

// ============================================================================
// Public API — add lines from anywhere in aether
// ============================================================================

/// Add a line to the console from an ASCII string.
pub fn addLine(msg: []const u8) void {
    addLineColor(msg, 0);
}

/// Add a line with a specific D2 color code.
pub fn addLineColor(msg: []const u8, color: u32) void {
    var line = Line{ .color = color };
    var i: u16 = 0;
    for (msg) |c| {
        if (i >= MAX_LINE_LEN - 1) break;
        line.buf[i] = c;
        i += 1;
    }
    line.len = i;
    pushLine(line);
}

/// Add a line from a wide string.
pub fn addLineWide(msg: [*:0]const u16, color: u32) void {
    var line = Line{ .color = color };
    var i: u16 = 0;
    while (msg[i] != 0 and i < MAX_LINE_LEN - 1) : (i += 1) {
        line.buf[i] = msg[i];
    }
    line.len = i;
    pushLine(line);
}

fn pushLine(line: Line) void {
    history[history_write] = line;
    history_write = (history_write + 1) % MAX_LINES;
    if (history_count < MAX_LINES) history_count += 1;
    // Auto-scroll to bottom on new line
    scroll_offset = 0;
}

pub fn toggle() void {
    visible = !visible;
    scroll_offset = 0;
}

pub fn isVisible() bool {
    return visible;
}

// ============================================================================
// Drawing
// ============================================================================

fn draw() void {
    if (!visible) return;

    // Get screen dimensions
    var sw: c_int = 800;
    var sh: c_int = 600;
    _ = d2.GetScreenSize.call(&sw, &sh);

    // Font 6 = small font, good for console
    const old_font = d2.SetFont.call(.{6});
    defer _ = d2.SetFont.call(.{old_font});

    // Measure char size
    var cw: u32 = 8;
    var ch: u32 = 12;
    const at_sign: [*:0]const u16 = &[_:0]u16{'@'};
    _ = d2.GetTextSize.call(.{ at_sign, &cw, &ch });
    const char_h: i32 = @max(10, @as(i32, @intCast(ch)));

    // Console height: 30% of screen
    const console_h: i32 = @divTrunc(@as(i32, sh) * 30, 100);
    const max_visible: u32 = @intCast(@max(1, @divTrunc(console_h - char_h, char_h)));

    // Background
    d2.DrawSolidRectAlpha.call(0, 0, sw, console_h, 0, 5);

    // Draw separator line at bottom of console
    d2.DrawLine.call(0, console_h, sw, console_h, 0x97, 0xFF);

    // Draw lines (bottom-up from the console bottom)
    const count = @min(history_count, max_visible);
    const total = history_count;

    if (total > 0) {
        var drawn: u32 = 0;
        while (drawn < count) : (drawn += 1) {
            // Index into ring buffer, accounting for scroll
            const offset = scroll_offset + drawn;
            if (offset >= total) break;

            // Ring buffer index: most recent is at (history_write - 1), going backwards
            const ring_idx = (history_write + MAX_LINES - 1 - offset) % MAX_LINES;
            const line = &history[ring_idx];
            if (line.len == 0) continue;

            const y = console_h - char_h - @as(i32, @intCast(drawn)) * char_h;
            if (y < 0) break;

            const wptr: [*:0]const u16 = @ptrCast(&line.buf);
            const color: u32 = if (line.color != 0) line.color else 0; // 0 = white
            d2.DrawGameText.call(.{ wptr, 6, y, color, 0 });
        }
    }

    // Draw scroll indicator if scrolled up
    if (scroll_offset > 0) {
        const indicator: [*:0]const u16 = &[_:0]u16{ '^', '^', '^', ' ', 'S', 'c', 'r', 'o', 'l', 'l', ' ', 'U', 'p', ' ', '^', '^', '^' };
        d2.DrawGameText.call(.{ indicator, @divTrunc(sw, 2) - 50, 4, 4, 0 }); // gold
    }

    // Blinking cursor at bottom
    const tick = GetTickCount();
    if (tick -% cursor_tick < 600) {
        const cx: i32 = 6;
        const cy: i32 = console_h - 2;
        d2.DrawSolidRectAlpha.call(cx, cy, cx + 8, cy + 2, 0xFF, 0xFF);
    } else if (tick -% cursor_tick > 1100) {
        cursor_tick = tick;
    }
}

// ============================================================================
// Input
// ============================================================================

const VK_OEM_3: u32 = 0xC0; // backtick / tilde key
const VK_PRIOR: u32 = 0x21; // page up
const VK_NEXT: u32 = 0x22; // page down

fn keyEvent(key: u32, down: bool, _: u32) bool {
    if (!down) return true;

    if (key == VK_OEM_3) {
        toggle();
        return false; // consume the key
    }

    if (!visible) return true;

    switch (key) {
        VK_PRIOR => { // Page Up — scroll up
            const total = history_count;
            var sw2: c_int = 800;
            var sh2: c_int = 600;
            _ = d2.GetScreenSize.call(&sw2, &sh2);
            const max_scroll = if (total > VISIBLE_LINES) total - VISIBLE_LINES else 0;
            scroll_offset = @min(scroll_offset + 5, max_scroll);
            return false;
        },
        VK_NEXT => { // Page Down — scroll down
            if (scroll_offset > 5) {
                scroll_offset -= 5;
            } else {
                scroll_offset = 0;
            }
            return false;
        },
        else => return true,
    }
}

// ============================================================================
// Feature hooks
// ============================================================================

fn init() void {
    // Wire up log callback so log.print/printStr feed into in-game console
    log.ingame_console_callback = &logCallback;
    addLine("Console ready — press ` to toggle, PgUp/PgDn to scroll");
}

fn logCallback(msg: []const u8) void {
    addLine(msg);
}

pub const hooks = feature.Hooks{
    .init = &init,
    .allPostDraw = &draw,
    .keyEvent = &keyEvent,
};
