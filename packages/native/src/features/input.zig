const std = @import("std");
const feature = @import("../feature.zig");
const patch = @import("../hook/patch.zig");
const log = @import("../log.zig");
const d2 = struct {
    const functions = @import("../d2/functions.zig");
};

const HWND = ?*anyopaque;
const WPARAM = usize;
const LPARAM = isize;
const LRESULT = isize;
const UINT = u32;
const ATOM = u16;
const WNDPROC = *const fn (HWND, UINT, WPARAM, LPARAM) callconv(.winapi) LRESULT;

const WM_KEYDOWN: UINT = 0x0100;
const WM_SYSKEYDOWN: UINT = 0x0104;
const WM_LBUTTONDOWN: UINT = 0x0201;
const WM_LBUTTONUP: UINT = 0x0202;
const WM_RBUTTONDOWN: UINT = 0x0204;
const WM_RBUTTONUP: UINT = 0x0205;
const WM_MBUTTONDOWN: UINT = 0x0207;
const WM_MBUTTONUP: UINT = 0x0208;

const WNDCLASSA = extern struct {
    style: UINT,
    lpfnWndProc: WNDPROC,
    cbClsExtra: i32,
    cbWndExtra: i32,
    hInstance: ?*anyopaque,
    hIcon: ?*anyopaque,
    hCursor: ?*anyopaque,
    hbrBackground: ?*anyopaque,
    lpszMenuName: ?[*:0]const u8,
    lpszClassName: ?[*:0]const u8,
};

extern "user32" fn RegisterClassA(lpWndClass: *WNDCLASSA) callconv(.winapi) ATOM;

// Address of the CALL to RegisterClassA in Game.exe
const ADDR_REGISTER_CLASS: usize = 0x4f5379;

var old_wnd_proc: ?WNDPROC = null;

fn init() void {
    _ = patch.writeCall(ADDR_REGISTER_CLASS, @intFromPtr(&registerClassHook));
    _ = patch.writeNops(ADDR_REGISTER_CLASS + 5, 1); // original is CALL + NOP
}

fn deinit() void {
    patch.revertRange(ADDR_REGISTER_CLASS, 6);
}

fn registerClassHook(wnd_class: *WNDCLASSA) callconv(.winapi) ATOM {
    old_wnd_proc = wnd_class.lpfnWndProc;
    wnd_class.lpfnWndProc = &windowProc;
    // WndProc hooked
    return RegisterClassA(wnd_class);
}

fn loWord(v: LPARAM) i32 {
    return @as(i32, @as(i16, @truncate(v)));
}

fn hiWord(v: LPARAM) i32 {
    return @as(i32, @as(i16, @truncate(v >> 16)));
}

fn windowProc(hwnd: HWND, msg: UINT, wparam: WPARAM, lparam: LPARAM) callconv(.winapi) LRESULT {
    var allow = true;

    switch (msg) {
        WM_KEYDOWN, WM_SYSKEYDOWN => {
            // Only fire on initial press, not repeat
            if (lparam & 0x40000000 == 0) {
                if (!feature.dispatchKeyEvent(@intCast(wparam), true, @bitCast(@as(isize, lparam)))) {
                    allow = false;
                }
            }
        },
        WM_LBUTTONDOWN => {
            if (!feature.dispatchMouseEvent(loWord(lparam), hiWord(lparam), 0, true)) allow = false;
        },
        WM_LBUTTONUP => {
            if (!feature.dispatchMouseEvent(loWord(lparam), hiWord(lparam), 0, false)) allow = false;
        },
        WM_RBUTTONDOWN => {
            if (!feature.dispatchMouseEvent(loWord(lparam), hiWord(lparam), 1, true)) allow = false;
        },
        WM_RBUTTONUP => {
            if (!feature.dispatchMouseEvent(loWord(lparam), hiWord(lparam), 1, false)) allow = false;
        },
        WM_MBUTTONDOWN => {
            if (!feature.dispatchMouseEvent(loWord(lparam), hiWord(lparam), 2, true)) allow = false;
        },
        WM_MBUTTONUP => {
            if (!feature.dispatchMouseEvent(loWord(lparam), hiWord(lparam), 2, false)) allow = false;
        },
        else => {},
    }

    if (allow) {
        if (old_wnd_proc) |proc| {
            return proc(hwnd, msg, wparam, lparam);
        }
    }
    return 0;
}

pub const hooks = feature.Hooks{
    .init = &init,
    .deinit = &deinit,
};
