const std = @import("std");
const win = std.os.windows;
const WINAPI = win.WINAPI;
const feature = @import("../feature.zig");
const patch = @import("../hook/patch.zig");
const log = @import("../log.zig");
const crash_handler = @import("../crash_handler.zig");

// Headless mode patches — allow the game to boot without media files.
// Stubs out DC6/DT1/video/sound loaders so the game survives with minimal MPQs.

fn init() void {
    log.print("headless: applying media-skip patches");

    // Patch 1: CELCMP_FixupPointersAndPrepare (0x00601340)
    // When pDC6 is NULL (file not found), the JZ at 0x00601349 jumps to epilogue
    // but never writes *ppDC6Out, leaving caller with uninitialized garbage.
    // Redirect the JZ to our handler that writes NULL to *ppDC6Out first.
    //
    // Original: 0F 84 B3 00 00 00  (JZ +0xB3 → 0x00601402)
    // We patch the 4-byte displacement to jump to our naked handler instead.
    const handler_addr = @intFromPtr(&celcmpNullHandler);
    const jz_addr: usize = 0x00601349;
    const jz_end: usize = jz_addr + 6; // JZ is 6 bytes (0F 84 xx xx xx xx)
    const rel = patch.calcRelAddr(jz_addr, handler_addr, 6);
    const rel_bytes: [4]u8 = @bitCast(rel);
    // Patch only the 4-byte displacement (bytes 2-5 of the JZ instruction)
    _ = patch.writeBytes(jz_addr + 2, &rel_bytes);
    _ = jz_end;

    // Patch 2: TILEPROJECT_AllocSlot (0x00604A40) — __stdcall, 2 args
    // Loads DT1 tile files; crashes if slots full or file missing. Stub with RET 8.
    _ = patch.writeBytes(0x00604A40, &[_]u8{ 0xC2, 0x08, 0x00 });

    // Patch 3: GAMEDATA_LoadActTiles (0x0044DB60) — __stdcall, 1 arg
    // Pre-caches DT1 tiles per act. Stub with RET 4.
    _ = patch.writeBytes(0x0044DB60, &[_]u8{ 0xC2, 0x04, 0x00 });

    // Patch 4: MPQ_LoadVideoMpqFiles (0x004FAD10) — __fastcall, 1 stack arg
    // Returns 0 if video MPQ missing → game fails. Stub: MOV EAX,1; RET 4.
    _ = patch.writeBytes(0x004FAD10, &[_]u8{ 0xB8, 0x01, 0x00, 0x00, 0x00, 0xC2, 0x04, 0x00 });

    // Patch 5: MPQ_LoadAllMediaMpqFiles (0x004FAEC0) — __fastcall, 2 stack args
    // Loads d2char, d2music, d2Xmusic, d2Xtalk, d2Xvideo. Stub: MOV EAX,1; RET 8.
    _ = patch.writeBytes(0x004FAEC0, &[_]u8{ 0xB8, 0x01, 0x00, 0x00, 0x00, 0xC2, 0x08, 0x00 });

    // Patch 6: D2WINARCHIVE_GetArchiveHandle (0x004FAC90)
    // Checks if d2char.mpq exists; returns nonzero on failure (disc-insert dialog).
    // Stub: XOR EAX,EAX; RET.
    _ = patch.writeBytes(0x004FAC90, &[_]u8{ 0x31, 0xC0, 0xC3 });

    // Patch 7: BINK_PlayVideoFile (0x005137E0) — 1 stack arg
    // Stub: RET 4.
    _ = patch.writeBytes(0x005137E0, &[_]u8{ 0xC2, 0x04, 0x00 });

    // Patch 8: BINK_RenderVideoFrame (0x005136F0) — __stdcall, 0 args
    // Stub: RET.
    _ = patch.writeBytes(0x005136F0, &[_]u8{0xC3});

    // Patch 9: D2COMP_LoadAllItemPalettes (0x00505550) — __stdcall, 0 args
    // Loads item palette .dat files; calls ERROR_Halt if missing. Stub: RET.
    _ = patch.writeBytes(0x00505550, &[_]u8{0xC3});

    // Patch 10: DrawAnim (0x005003A0) — __fastcall, 1 arg in ECX
    // Draws animated DC6 images; asserts on form type then deref NULL DC6. Stub: RET.
    _ = patch.writeBytes(0x005003A0, &[_]u8{0xC3});

    // Patch 11: Draw(D2WinAnimImage) (0x005005B0) — __fastcall, 1 arg in ECX
    // Anim image draw; deref NULL frame table at +0x9A. Stub: RET.
    _ = patch.writeBytes(0x005005B0, &[_]u8{0xC3});

    // Hook ExitProcess to log stack trace before the game silently exits
    hookExitProcess();

    log.print("headless: all patches applied");
}

extern "kernel32" fn GetModuleHandleA(name: ?[*:0]const u8) callconv(WINAPI) ?win.HINSTANCE;
extern "kernel32" fn GetProcAddress(h: win.HINSTANCE, name: [*:0]const u8) callconv(WINAPI) ?*anyopaque;

var exit_process_original: [5]u8 = undefined;
var exit_process_addr: usize = 0;

fn hookExitProcess() void {
    const kernel32 = GetModuleHandleA("kernel32.dll") orelse return;
    const proc = GetProcAddress(kernel32, "ExitProcess") orelse return;
    exit_process_addr = @intFromPtr(proc);

    // Save original bytes
    const src: [*]const u8 = @ptrFromInt(exit_process_addr);
    @memcpy(&exit_process_original, src[0..5]);

    // Write JMP to our interceptor
    _ = patch.writeJump(exit_process_addr, @intFromPtr(&exitProcessInterceptor));
}

fn exitProcessInterceptor(exit_code: u32) callconv(WINAPI) noreturn {
    log.print("headless: ExitProcess called!");
    crash_handler.logStackTrace("ExitProcess");
    log.hex("headless: exit code ", exit_code);

    // Restore original ExitProcess bytes and call real
    _ = patch.writeBytes(exit_process_addr, &exit_process_original);
    const realExitProcess: *const fn (u32) callconv(WINAPI) noreturn = @ptrFromInt(exit_process_addr);
    realExitProcess(exit_code);
}

fn deinit() void {
    patch.revertRange(0x00601349 + 2, 4); // Patch 1: JZ displacement
    patch.revertRange(0x00604A40, 3); // Patch 2
    patch.revertRange(0x0044DB60, 3); // Patch 3
    patch.revertRange(0x004FAD10, 8); // Patch 4
    patch.revertRange(0x004FAEC0, 8); // Patch 5
    patch.revertRange(0x004FAC90, 3); // Patch 6
    patch.revertRange(0x005137E0, 3); // Patch 7
    patch.revertRange(0x005136F0, 1); // Patch 8
    patch.revertRange(0x00505550, 1); // Patch 9
    patch.revertRange(0x005003A0, 1); // Patch 10
    patch.revertRange(0x005005B0, 1); // Patch 11
}

// Naked handler for Patch 1.
// When CELCMP_FixupPointersAndPrepare gets pDC6==NULL, the original code
// jumps to the epilogue without writing *ppDC6Out. We intercept to write NULL.
//
// Stack at JZ: EBP+0x04=retaddr, EBP+0x08=pDC6, EBP+0x0C=ppDC6Out.
// Write NULL to *ppDC6Out, then epilogue: POP ESI; POP EBP; RET 0x18.
fn celcmpNullHandler() callconv(.naked) void {
    asm volatile (
        \\mov 0x0C(%%ebp), %%eax
        \\movl $0, (%%eax)
        \\pop %%esi
        \\pop %%ebp
        \\ret $0x18
    );
}

pub const hooks = feature.Hooks{
    .init = &init,
    .deinit = &deinit,
};
