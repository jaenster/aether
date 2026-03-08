const std = @import("std");
const feature = @import("../feature.zig");
const log = @import("../log.zig");

const LPVOID = ?*anyopaque;
const DWORD = u32;

extern "kernel32" fn CreateFiber(stack_size: DWORD, start: *const fn (LPVOID) callconv(.winapi) void, param: LPVOID) callconv(.winapi) LPVOID;
extern "kernel32" fn SwitchToFiber(fiber: LPVOID) callconv(.winapi) void;
extern "kernel32" fn DeleteFiber(fiber: LPVOID) callconv(.winapi) void;

const async_ = @import("../async.zig");

var fiber: LPVOID = null;
var done: bool = false;

fn yield() void {
    SwitchToFiber(async_.getMainFiber());
}

fn waitFrames(n: u32) void {
    for (0..n) |_| yield();
}

// ============================================================================
// Game addresses
// ============================================================================

const OogCurrentCharSelectionMode: *u32 = @ptrFromInt(0x007795ec);
const D2CharSelStrcFirst: *?*const D2CharSelStrc = @ptrFromInt(0x00779dbc);
const TotalCurrentChars: *u32 = @ptrFromInt(0x00779dc4);

// MAINMENU_CloseAndLaunchCharSelect (0x0042fdd0) — __stdcall, 0 args
const closeAndLaunchCharSelect: *const fn () callconv(.winapi) void = @ptrFromInt(0x0042fdd0);

// UIMENU_MainMenu (0x004336c0) — __stdcall, 0 args
// Dismisses the splash/title screen and shows the main menu with buttons
const showMainMenu: *const fn () callconv(.winapi) void = @ptrFromInt(0x004336c0);

// SelectedCharBnetSingleTcpIp (0x00434a00) — __fastcall
// ECX=D2CharSelStrc*, EDX=nCharacterFlags, stack: ePlayerClassID, pRealm
const d2 = struct {
    const functions = @import("../d2/functions.zig");
};
const SelectedCharBnetSingleTcpIp = d2.functions.fastcall(0x00434a00, fn (*const D2CharSelStrc, u16, u32, [*:0]const u8) u32);

const D2CharSelStrc = extern struct {
    szCharname: [256]u8,
    szCommandStringTable: [512]u8,
    abEquipSlot1: [16]u8,
    abEquipSlot2: [16]u8,
    ePlayerClassID: u8,
    _pad801: u8,
    nLevel: u16,
    nCharacterFlags: u16,
    _pad806: [14]u8,
    nEntryType: u32,
    pCharSelCompStrc: ?*anyopaque,
    _pad828: [4]u8,
    ftLastWriteTimeLow: u32,
    ftLastWriteTimeHigh: u32,
    _pad840: [4]u8,
    pNext: ?*const D2CharSelStrc,
};

comptime {
    if (@offsetOf(D2CharSelStrc, "pNext") != 844) @compileError("pNext must be at 844");
    if (@offsetOf(D2CharSelStrc, "ePlayerClassID") != 800) @compileError("ePlayerClassID must be at 800");
    if (@offsetOf(D2CharSelStrc, "nCharacterFlags") != 804) @compileError("nCharacterFlags must be at 804");
}

// ============================================================================
// Fiber
// ============================================================================

fn fiberEntry(_: LPVOID) callconv(.winapi) void {
    autoEnterSequence();
    done = true;
    SwitchToFiber(async_.getMainFiber());
}

fn autoEnterSequence() void {
    log.print("auto_enter: starting SP game entry");

    // Dismiss the splash/title screen → show main menu
    waitFrames(10);
    log.print("auto_enter: dismissing splash screen");
    showMainMenu();
    waitFrames(10);

    // Set SP mode
    OogCurrentCharSelectionMode.* = 0;

    // Open char select screen (destroys main menu forms, enumerates saves)
    log.print("auto_enter: opening char select");
    closeAndLaunchCharSelect();

    // Wait for character list to populate
    var wait: u32 = 0;
    while (TotalCurrentChars.* == 0 and wait < 300) : (wait += 1) {
        yield();
    }

    if (TotalCurrentChars.* == 0) {
        log.print("auto_enter: no characters found");
        return;
    }

    log.hex("auto_enter: chars loaded: ", TotalCurrentChars.*);

    // Find target character
    const target = "EpicSorc";
    var cur = D2CharSelStrcFirst.* orelse {
        log.print("auto_enter: char list null");
        return;
    };
    while (true) {
        const name = std.mem.sliceTo(&cur.szCharname, 0);
        if (std.mem.eql(u8, name, target)) break;
        cur = cur.pNext orelse {
            log.print("auto_enter: EpicSorc not found");
            return;
        };
    }

    log.print("auto_enter: found EpicSorc, entering game");

    // Call SelectedCharBnetSingleTcpIp directly — bypasses difficulty dialog
    // For SP it sets nScreenToShow=1, gnSelectedCharGameState=1,
    // nGAMETYPE=SINGLEPLAYER, arena flags, and clears message loop.
    _ = SelectedCharBnetSingleTcpIp.call(.{
        cur,
        cur.nCharacterFlags,
        @as(u32, cur.ePlayerClassID),
        @as([*:0]const u8, ""),
    });

    log.print("auto_enter: game entry triggered");
}

// ============================================================================
// Feature hooks
// ============================================================================

fn init() void {
    log.print("auto_enter: initialized");
}

fn oogLoop() void {
    if (fiber == null and !done) {
        fiber = CreateFiber(64 * 1024, &fiberEntry, null);
        if (fiber == null) {
            log.print("auto_enter: CreateFiber failed");
            done = true;
            return;
        }
    }

    if (done) {
        if (fiber) |f| {
            DeleteFiber(f);
            fiber = null;
        }
        return;
    }

    SwitchToFiber(fiber.?);

    if (done) {
        if (fiber) |f| {
            DeleteFiber(f);
            fiber = null;
        }
    }
}

pub const hooks = feature.Hooks{
    .init = &init,
    .oogLoop = &oogLoop,
};
