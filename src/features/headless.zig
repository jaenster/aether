const std = @import("std");
const win = std.os.windows;
const feature = @import("../feature.zig");
const patch = @import("../hook/patch.zig");
const log = @import("../log.zig");
const crash_handler = @import("../crash_handler.zig");

// Safety patches (always loaded):
// - DC6 null guards — prevent crashes on missing sprites
// - Bnet stubs — no network needed
// - ExitProcess hook — crash diagnostics
//
// Headless mode (--headless flag):
// - DrawAnim stub — skip all rendering

var headless_rendering: bool = false;

pub fn enableHeadlessMode() void {
    headless_rendering = true;
    // DrawAnim (0x005003A0) — skip rendering
    _ = patch.writeBytes(0x005003A0, &[_]u8{ 0x31, 0xC0, 0xC3 });
}

fn init() void {
    log.print("headless: applying safety patches");

    // DC6 null safety: CELCMP_FixupPointersAndPrepare (0x00601340)
    // When pDC6 is NULL, the JZ at 0x00601349 jumps to epilogue but never
    // writes *ppDC6Out. Redirect to handler that writes NULL first.
    const handler_addr = @intFromPtr(&celcmpNullHandler);
    const jz_addr: usize = 0x00601349;
    const rel = patch.calcRelAddr(jz_addr, handler_addr, 6);
    const rel_bytes: [4]u8 = @bitCast(rel);
    _ = patch.writeBytes(jz_addr + 2, &rel_bytes);

    // IMAGE_GetFramesCount null guard (0x006019F0)
    // Returns 0 instead of crashing when pDC6 is NULL.
    const getframes_handler = @intFromPtr(&imageGetFramesCountGuard);
    const getframes_jmp = patch.calcRelAddr(0x006019F0, getframes_handler, 5);
    const getframes_bytes: [4]u8 = @bitCast(getframes_jmp);
    _ = patch.writeBytes(0x006019F0, &[_]u8{ 0xE9, getframes_bytes[0], getframes_bytes[1], getframes_bytes[2], getframes_bytes[3], 0x90 });

    // BNGatewayAccess::Load (0x005186d0) — halts if Realms.bin missing
    _ = patch.writeBytes(0x005186d0, &[_]u8{ 0xC2, 0x04, 0x00 });

    // CLIENT_ConnectToBattleNet (0x0043BF60) — no bnet
    _ = patch.writeBytes(0x0043BF60, &[_]u8{ 0x31, 0xC0, 0xC3 });

    hookExitProcess();

    log.print("headless: safety patches applied");
}

extern "kernel32" fn GetModuleHandleA(name: ?[*:0]const u8) callconv(.winapi) ?win.HINSTANCE;
extern "kernel32" fn GetProcAddress(h: win.HINSTANCE, name: [*:0]const u8) callconv(.winapi) ?*anyopaque;

var exit_process_original: [5]u8 = undefined;
var exit_process_addr: usize = 0;

fn hookExitProcess() void {
    const kernel32 = GetModuleHandleA("kernel32.dll") orelse return;
    const proc = GetProcAddress(kernel32, "ExitProcess") orelse return;
    exit_process_addr = @intFromPtr(proc);

    const src: [*]const u8 = @ptrFromInt(exit_process_addr);
    @memcpy(&exit_process_original, src[0..5]);

    _ = patch.writeJump(exit_process_addr, @intFromPtr(&exitProcessInterceptor));
}

fn exitProcessInterceptor(exit_code: u32) callconv(.winapi) noreturn {
    log.print("headless: ExitProcess called!");
    crash_handler.logStackTrace("ExitProcess");
    log.hex("headless: exit code ", exit_code);

    _ = patch.writeBytes(exit_process_addr, &exit_process_original);
    const realExitProcess: *const fn (u32) callconv(.winapi) noreturn = @ptrFromInt(exit_process_addr);
    realExitProcess(exit_code);
}

fn deinit() void {
    patch.revertRange(0x00601349 + 2, 4); // CELCMP null handler
    patch.revertRange(0x006019F0, 6); // IMAGE_GetFramesCount null guard
    patch.revertRange(0x005186d0, 3); // BNGatewayAccess::Load
    patch.revertRange(0x0043BF60, 3); // CLIENT_ConnectToBattleNet
    if (headless_rendering) {
        patch.revertRange(0x005003A0, 3); // DrawAnim
    }
}

fn celcmpNullHandler() callconv(.naked) void {
    asm volatile (
        \\mov 0x0C(%%ebp), %%eax
        \\movl $0, (%%eax)
        \\pop %%esi
        \\pop %%ebp
        \\ret $0x18
    );
}

fn imageGetFramesCountGuard() callconv(.naked) void {
    asm volatile (
        \\push %%ebp
        \\mov %%esp, %%ebp
        \\mov 0x08(%%ebp), %%eax
        \\test %%eax, %%eax
        \\jnz 1f
        \\xor %%eax, %%eax
        \\pop %%ebp
        \\ret $0x04
        \\1:
        \\push $0x006019F6
        \\ret
    );
}

pub const hooks = feature.Hooks{
    .init = &init,
    .deinit = &deinit,
};
