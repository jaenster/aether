const std = @import("std");
const win = std.os.windows;
const feature = @import("../feature.zig");
const patch = @import("../hook/patch.zig");
const log = @import("../log.zig");
const crash_handler = @import("../crash_handler.zig");

// Headless mode patches — allow the game to boot without video/sound/network.
// Only stubs functions that deal with missing media or network connectivity.
// Game logic (tiles, palettes, item data) runs normally.

fn init() void {
    log.print("headless: applying media-skip patches");

    // DC6 null safety: CELCMP_FixupPointersAndPrepare (0x00601340)
    // When pDC6 is NULL (file not found), the JZ at 0x00601349 jumps to epilogue
    // but never writes *ppDC6Out, leaving caller with uninitialized garbage.
    // Redirect the JZ to our handler that writes NULL to *ppDC6Out first.
    const handler_addr = @intFromPtr(&celcmpNullHandler);
    const jz_addr: usize = 0x00601349;
    const rel = patch.calcRelAddr(jz_addr, handler_addr, 6);
    const rel_bytes: [4]u8 = @bitCast(rel);
    _ = patch.writeBytes(jz_addr + 2, &rel_bytes);

    // IMAGE_GetFramesCount null guard (0x006019F0)
    // Called with NULL pDC6 when frame table entries fail to load.
    const getframes_handler = @intFromPtr(&imageGetFramesCountGuard);
    const getframes_jmp = patch.calcRelAddr(0x006019F0, getframes_handler, 5);
    const getframes_bytes: [4]u8 = @bitCast(getframes_jmp);
    _ = patch.writeBytes(0x006019F0, &[_]u8{ 0xE9, getframes_bytes[0], getframes_bytes[1], getframes_bytes[2], getframes_bytes[3], 0x90 });

    // --- Video/sound stubs (media files not in minimal MPQs) ---

    // MPQ_LoadVideoMpqFiles (0x004FAD10) — video MPQs don't exist
    _ = patch.writeBytes(0x004FAD10, &[_]u8{ 0xB8, 0x01, 0x00, 0x00, 0x00, 0xC2, 0x04, 0x00 });

    // MPQ_LoadAllMediaMpqFiles (0x004FAEC0) — media MPQs don't exist
    _ = patch.writeBytes(0x004FAEC0, &[_]u8{ 0xB8, 0x01, 0x00, 0x00, 0x00, 0xC2, 0x08, 0x00 });

    // D2WINARCHIVE_GetArchiveHandle (0x004FAC90) — disc-insert check
    _ = patch.writeBytes(0x004FAC90, &[_]u8{ 0x31, 0xC0, 0xC3 });

    // BINK_PlayVideoFile (0x005137E0) — no video files
    _ = patch.writeBytes(0x005137E0, &[_]u8{ 0xC2, 0x04, 0x00 });

    // BINK_RenderVideoFrame (0x005136F0) — no video files
    _ = patch.writeBytes(0x005136F0, &[_]u8{0xC3});

    // DrawAnim (0x005003A0) — skip rendering in headless mode
    _ = patch.writeBytes(0x005003A0, &[_]u8{ 0x31, 0xC0, 0xC3 });

    // --- Network stubs (no bnet/realms connectivity) ---

    // BNGatewayAccess::Load (0x005186d0) — halts if Realms.bin missing
    _ = patch.writeBytes(0x005186d0, &[_]u8{ 0xC2, 0x04, 0x00 });

    // CLIENT_ConnectToBattleNet (0x0043BF60) — no bnet
    _ = patch.writeBytes(0x0043BF60, &[_]u8{ 0x31, 0xC0, 0xC3 });

    // Hook ExitProcess to log stack trace before the game silently exits
    hookExitProcess();

    log.print("headless: all patches applied");
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
    patch.revertRange(0x004FAD10, 8); // MPQ_LoadVideoMpqFiles
    patch.revertRange(0x004FAEC0, 8); // MPQ_LoadAllMediaMpqFiles
    patch.revertRange(0x004FAC90, 3); // D2WINARCHIVE_GetArchiveHandle
    patch.revertRange(0x005137E0, 3); // BINK_PlayVideoFile
    patch.revertRange(0x005136F0, 1); // BINK_RenderVideoFrame
    patch.revertRange(0x005003A0, 3); // DrawAnim
    patch.revertRange(0x005186d0, 3); // BNGatewayAccess::Load
    patch.revertRange(0x0043BF60, 3); // CLIENT_ConnectToBattleNet
}

// Naked handler: writes NULL to *ppDC6Out when pDC6 is NULL.
// Stack at JZ: EBP+0x0C=ppDC6Out. Epilogue: POP ESI; POP EBP; RET 0x18.
fn celcmpNullHandler() callconv(.naked) void {
    asm volatile (
        \\mov 0x0C(%%ebp), %%eax
        \\movl $0, (%%eax)
        \\pop %%esi
        \\pop %%ebp
        \\ret $0x18
    );
}

// Null-safe wrapper for IMAGE_GetFramesCount.
// If pDC6 (arg1) is NULL, return 0 instead of crashing on dereference.
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
