const d2 = @import("d2/functions.zig");
const automap = @import("d2/automap.zig");

pub const DrawType = enum(u8) { line, rect, text };
pub const DrawTarget = enum(u8) { screen, automap };

pub const DrawEntry = struct {
    dtype: DrawType,
    target: DrawTarget,
    visible: bool = true,
    color: u32 = 0,
    alpha: u32 = 0xFF,
    x: i32 = 0,
    y: i32 = 0,
    x2: i32 = 0, // line: end x, rect: width, text: font
    y2: i32 = 0, // line: end y, rect: height
    // For text: stored inline (max 63 chars + null)
    text_buf: [64]u16 = .{0} ** 64,
    text_len: u8 = 0,
    active: bool = false,
};

const MAX_ENTRIES = 256;
var entries: [MAX_ENTRIES]DrawEntry = blk: {
    var arr: [MAX_ENTRIES]DrawEntry = undefined;
    for (&arr) |*e| e.* = .{ .dtype = .line, .target = .screen, .active = false };
    break :blk arr;
};

/// Allocate a draw entry. Returns slot index or -1 if full.
pub fn alloc() i32 {
    for (&entries, 0..) |*e, i| {
        if (!e.active) {
            e.* = .{ .dtype = .line, .target = .screen, .active = true };
            return @intCast(i);
        }
    }
    return -1;
}

/// Free a draw entry by slot index.
pub fn free(slot: u32) void {
    if (slot >= MAX_ENTRIES) return;
    entries[slot].active = false;
}

/// Get a mutable pointer to entry at slot.
pub fn get(slot: u32) ?*DrawEntry {
    if (slot >= MAX_ENTRIES) return null;
    if (!entries[slot].active) return null;
    return &entries[slot];
}

/// Render all screen-targeted entries. Called from hookGamePostDraw.
pub fn renderScreen() void {
    for (&entries) |*e| {
        if (!e.active or !e.visible or e.target != .screen) continue;
        switch (e.dtype) {
            .line => d2.DrawLine.call(e.x, e.y, e.x2, e.y2, e.color, e.alpha),
            .rect => d2.DrawSolidRectAlpha.call(e.x, e.y, e.x + e.x2, e.y + e.y2, e.color, e.alpha),
            .text => {
                if (e.text_len > 0) {
                    _ = d2.SetFont.call(.{@as(u32, @bitCast(e.x2))});
                    const wptr: [*:0]const u16 = @ptrCast(&e.text_buf);
                    d2.DrawGameText.call(.{ wptr, e.x, e.y, e.color, 0 });
                }
            },
        }
    }
}

/// Render all automap-targeted entries. Called from hookAutomapDraw.
pub fn renderAutomap() void {
    for (&entries) |*e| {
        if (!e.active or !e.visible or e.target != .automap) continue;
        switch (e.dtype) {
            .line => {
                const p0 = automap.toAutomap(@floatFromInt(e.x), @floatFromInt(e.y));
                const p1 = automap.toAutomap(@floatFromInt(e.x2), @floatFromInt(e.y2));
                d2.DrawLine.call(p0.x, p0.y, p1.x, p1.y, e.color, e.alpha);
            },
            .rect => {
                // Rect on automap = 4 lines
                const x = e.x;
                const y = e.y;
                const w = e.x2;
                const h = e.y2;
                const tl = automap.toAutomap(@floatFromInt(x), @floatFromInt(y));
                const tr = automap.toAutomap(@floatFromInt(x + w), @floatFromInt(y));
                const br = automap.toAutomap(@floatFromInt(x + w), @floatFromInt(y + h));
                const bl = automap.toAutomap(@floatFromInt(x), @floatFromInt(y + h));
                d2.DrawLine.call(tl.x, tl.y, tr.x, tr.y, e.color, e.alpha);
                d2.DrawLine.call(tr.x, tr.y, br.x, br.y, e.color, e.alpha);
                d2.DrawLine.call(br.x, br.y, bl.x, bl.y, e.color, e.alpha);
                d2.DrawLine.call(bl.x, bl.y, tl.x, tl.y, e.color, e.alpha);
            },
            .text => {
                if (e.text_len > 0) {
                    const p = automap.toAutomap(@floatFromInt(e.x), @floatFromInt(e.y));
                    _ = d2.SetFont.call(.{@as(u32, @bitCast(e.x2))});
                    const wptr: [*:0]const u16 = @ptrCast(&e.text_buf);
                    d2.DrawGameText.call(.{ wptr, p.x, p.y, e.color, 0 });
                }
            },
        }
    }
}
