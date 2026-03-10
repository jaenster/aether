const patch = @import("patch.zig");
const feature = @import("../feature.zig");
const globals = @import("../d2/globals.zig");
const d2 = struct {
    const functions = @import("../d2/functions.zig");
};

// =============================================================================
// Addresses — game hook points for draw/loop callbacks
// =============================================================================

// Logic hooks (GameLoop.cpp)
const ADDR_GAME_LOOP: usize = 0x00451C2A; // sleep section in game loop, CALL+2NOP
const ADDR_OOG_LOOP: usize = 0x004FA663; // sleep section in OOG loop, CALL+18NOP

// Drawing hooks (Drawing.cpp)
const ADDR_UNIT_PRE_DRAW: usize = 0x00476CE1; // CALL to draw units (0x473C00)
const ADDR_DRAW_UNITS: usize = 0x00473C00;

const ADDR_UNIT_POST_DRAW: usize = 0x00476D31; // JMP — after unit draw

const ADDR_AUTOMAP_DRAW: usize = 0x00456FA5; // CALL to DrawAutomap (0x45AD60)
const ADDR_DRAW_AUTOMAP: usize = 0x0045AD60;

const ADDR_GAME_PRE_DRAW: usize = 0x0044CAE8; // CALL to GetTypeOfBorder (0x45AE90)
const ADDR_GET_TYPE_BORDER: usize = 0x0045AE90;

const ADDR_GAME_POST_DRAW: usize = 0x0044CB14; // CALL — replaced, no original needed

const ADDR_OOG_DRAW: usize = 0x004F9A5D; // CALL to DrawCursorOOG (0x4F97E0)
const ADDR_DRAW_CURSOR_OOG: usize = 0x004F97E0;

const ADDR_DRAW_CURSOR_CONGRATS: usize = 0x0044EBEA; // congratulations screen
const ADDR_DRAW_CURSOR_DISC: usize = 0x0045FE1F; // disconnect screen
const ADDR_DRAW_CURSOR_UNK: usize = 0x004601D6; // unknown screen
const ADDR_DRAW_CURSOR: usize = 0x004684C0;

// =============================================================================
// Hook functions
// =============================================================================

// --- Logic ---

fn hookGameLoop() callconv(.c) void {
    feature.in_game = globals.playerUnit().* != null;
    feature.dispatchGameLoop();
}

fn hookOogLoop() callconv(.c) void {
    feature.dispatchOogLoop();
}

// --- Drawing: units ---

fn hookUnitPreDraw() callconv(.c) void {
    feature.in_game = true;
    feature.dispatchGameUnitPreDraw();
    const drawUnits: *const fn () callconv(.c) void = @ptrFromInt(ADDR_DRAW_UNITS);
    drawUnits();
}

fn hookUnitPostDraw() callconv(.winapi) void {
    feature.dispatchGameUnitPostDraw();
}

// --- Drawing: automap ---

fn hookAutomapDraw() callconv(.c) void {
    feature.dispatchGameAutomapPreDraw();
    const drawAutomap: *const fn () callconv(.c) void = @ptrFromInt(ADDR_DRAW_AUTOMAP);
    drawAutomap();
    feature.dispatchGameAutomapPostDraw();
}

// --- Drawing: game frame ---

fn hookGamePreDraw() callconv(.winapi) u32 {
    feature.dispatchPreDraw();
    const getTypeBorder: *const fn () callconv(.winapi) u32 = @ptrFromInt(ADDR_GET_TYPE_BORDER);
    return getTypeBorder();
}

fn hookGamePostDraw() callconv(.c) void {
    const old = d2.functions.SetFont.call(.{1});
    feature.dispatchGamePostDraw();
    feature.dispatchAllPostDraw();
    _ = d2.functions.SetFont.call(.{old});
}

// --- Drawing: OOG ---

fn hookOogDraw() callconv(.c) void {
    feature.in_game = false;
    const old = d2.functions.SetFont.call(.{1});
    feature.dispatchOogPostDraw();
    feature.dispatchAllPostDraw();
    _ = d2.functions.SetFont.call(.{old});
    const drawCursorOog: *const fn () callconv(.c) void = @ptrFromInt(ADDR_DRAW_CURSOR_OOG);
    drawCursorOog();
}

// --- Drawing: cursor (congrats/disc/unknown screens) ---

fn hookDrawCursor() callconv(.c) void {
    const old = d2.functions.SetFont.call(.{1});
    feature.dispatchAllPostDraw();
    _ = d2.functions.SetFont.call(.{old});
    const drawCursor: *const fn () callconv(.c) void = @ptrFromInt(ADDR_DRAW_CURSOR);
    drawCursor();
}

// =============================================================================
// Install / Uninstall
// =============================================================================

pub fn install() void {
    // Logic hooks
    _ = patch.writeCall(ADDR_GAME_LOOP, @intFromPtr(&hookGameLoop));
    _ = patch.writeNops(ADDR_GAME_LOOP + 5, 2);

    _ = patch.writeCall(ADDR_OOG_LOOP, @intFromPtr(&hookOogLoop));
    _ = patch.writeNops(ADDR_OOG_LOOP + 5, 18);

    _ = patch.writeCall(ADDR_UNIT_PRE_DRAW, @intFromPtr(&hookUnitPreDraw));
    _ = patch.writeJump(ADDR_UNIT_POST_DRAW, @intFromPtr(&hookUnitPostDraw));
    _ = patch.writeCall(ADDR_AUTOMAP_DRAW, @intFromPtr(&hookAutomapDraw));
    _ = patch.writeCall(ADDR_GAME_PRE_DRAW, @intFromPtr(&hookGamePreDraw));
    _ = patch.writeCall(ADDR_GAME_POST_DRAW, @intFromPtr(&hookGamePostDraw));
    _ = patch.writeCall(ADDR_OOG_DRAW, @intFromPtr(&hookOogDraw));

    _ = patch.writeCall(ADDR_DRAW_CURSOR_CONGRATS, @intFromPtr(&hookDrawCursor));
    _ = patch.writeCall(ADDR_DRAW_CURSOR_DISC, @intFromPtr(&hookDrawCursor));
    _ = patch.writeCall(ADDR_DRAW_CURSOR_UNK, @intFromPtr(&hookDrawCursor));
}

pub fn uninstall() void {
    patch.revertRange(ADDR_GAME_LOOP, 7);
    patch.revertRange(ADDR_OOG_LOOP, 23);
    patch.revertRange(ADDR_UNIT_PRE_DRAW, 5);
    patch.revertRange(ADDR_UNIT_POST_DRAW, 5);
    patch.revertRange(ADDR_AUTOMAP_DRAW, 5);
    patch.revertRange(ADDR_GAME_PRE_DRAW, 5);
    patch.revertRange(ADDR_GAME_POST_DRAW, 5);
    patch.revertRange(ADDR_OOG_DRAW, 5);
    patch.revertRange(ADDR_DRAW_CURSOR_CONGRATS, 5);
    patch.revertRange(ADDR_DRAW_CURSOR_DISC, 5);
    patch.revertRange(ADDR_DRAW_CURSOR_UNK, 5);
}
