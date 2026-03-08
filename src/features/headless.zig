const std = @import("std");
const win = std.os.windows;
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
    // Draws/hit-tests animated images; asserts on type and dereferences frame tables.
    // In headless mode nothing to draw — stub: XOR EAX,EAX; RET (return 0).
    _ = patch.writeBytes(0x005003A0, &[_]u8{ 0x31, 0xC0, 0xC3 });

    // Patch 11: IMAGE_GetFramesCount (0x006019F0) — __stdcall, 1 arg
    // Called with NULL pDC6 when frame table entries fail to load.
    // Redirect to null-safe handler that returns 0 on NULL input.
    const getframes_handler = @intFromPtr(&imageGetFramesCountGuard);
    const getframes_jmp = patch.calcRelAddr(0x006019F0, getframes_handler, 5);
    const getframes_bytes: [4]u8 = @bitCast(getframes_jmp);
    // Write JMP rel32 (E9) + NOP to fill 6 bytes (replaces PUSH EBP; MOV EBP,ESP; MOV EAX,[EBP+8])
    _ = patch.writeBytes(0x006019F0, &[_]u8{ 0xE9, getframes_bytes[0], getframes_bytes[1], getframes_bytes[2], getframes_bytes[3], 0x90 });

    // Patch 17: InitRoomTiles (0x0066EC10) — __fastcall, 2 reg + 4 stack args
    // Processes DT1 tiles for rooms; asserts on missing tile data. Stub: RET 0x10.
    _ = patch.writeBytes(0x0066EC10, &[_]u8{ 0xC2, 0x10, 0x00 });

    // Patch 15: InitCache (0x00642A30) — __fastcall, 2 args
    // Tile cache init; halts when no tile projects loaded (we stub tile loading). Stub: RET.
    _ = patch.writeBytes(0x00642A30, &[_]u8{0xC3});

    // Patch 16: PALETTE_InitItemPalettes (0x00600B80) — 0 args
    // Loads item palette transform files; halts if missing. Stub: RET.
    _ = patch.writeBytes(0x00600B80, &[_]u8{0xC3});

    // Patch 12: BNGatewayAccess::Load (0x005186d0) — __stdcall, 1 arg
    // Loads Realms.bin + gateway list from registry; halts if Realms.bin missing.
    // Stubbing Load covers all 3 callers (BnetLoadAndReturn, GetBnetIp, UpdateGatewaysFromIni).
    _ = patch.writeBytes(0x005186d0, &[_]u8{ 0xC2, 0x04, 0x00 });

    // Patch 13: CLIENT_ConnectToBattleNet (0x0043BF60) — __stdcall, 0 args
    // Tries to connect to bnet; crashes on uninitialized UI. Stub: XOR EAX,EAX; RET.
    _ = patch.writeBytes(0x0043BF60, &[_]u8{ 0x31, 0xC0, 0xC3 });

    // Patch 14: CHARSEL_EnumerateLocalSaves (0x00438F70) — __stdcall, 0 args
    // Parses save files; halts on parse errors. Stub: XOR EAX,EAX; RET (return 0).
    _ = patch.writeBytes(0x00438F70, &[_]u8{ 0x31, 0xC0, 0xC3 });

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

    // Save original bytes
    const src: [*]const u8 = @ptrFromInt(exit_process_addr);
    @memcpy(&exit_process_original, src[0..5]);

    // Write JMP to our interceptor
    _ = patch.writeJump(exit_process_addr, @intFromPtr(&exitProcessInterceptor));
}

fn exitProcessInterceptor(exit_code: u32) callconv(.winapi) noreturn {
    log.print("headless: ExitProcess called!");
    crash_handler.logStackTrace("ExitProcess");
    log.hex("headless: exit code ", exit_code);

    // Restore original ExitProcess bytes and call real
    _ = patch.writeBytes(exit_process_addr, &exit_process_original);
    const realExitProcess: *const fn (u32) callconv(.winapi) noreturn = @ptrFromInt(exit_process_addr);
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
    patch.revertRange(0x005003A0, 3); // Patch 10: DrawAnim stub
    patch.revertRange(0x006019F0, 6); // Patch 11: IMAGE_GetFramesCount null guard
    patch.revertRange(0x0066EC10, 3); // Patch 17: InitRoomTiles
    patch.revertRange(0x00642A30, 1); // Patch 15: InitCache
    patch.revertRange(0x00600B80, 1); // Patch 16
    patch.revertRange(0x005186d0, 3); // Patch 12: BNGatewayAccess::Load
    patch.revertRange(0x0043BF60, 3); // Patch 13
    patch.revertRange(0x00438F70, 3); // Patch 14
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

// Null-safe wrapper for IMAGE_GetFramesCount (0x006019F0).
// Original: PUSH EBP; MOV EBP,ESP; MOV EAX,[EBP+8]; CMP [EAX],6 ...
// If pDC6 (arg1) is NULL, return 0 instead of crashing on dereference.
// Replayed prologue: 6 bytes (55 8B EC 8B 45 08), resume at 0x006019F6.
fn imageGetFramesCountGuard() callconv(.naked) void {
    asm volatile (
        \\push %%ebp
        \\mov %%esp, %%ebp
        \\mov 0x08(%%ebp), %%eax
        \\test %%eax, %%eax
        \\jnz 1f
        // NULL pDC6: return 0 frames
        \\xor %%eax, %%eax
        \\pop %%ebp
        \\ret $0x04
        \\1:
        // Non-NULL: resume original at CMP [EAX],6 (0x006019F6)
        \\push $0x006019F6
        \\ret
    );
}

pub const hooks = feature.Hooks{
    .init = &init,
    .deinit = &deinit,
};
