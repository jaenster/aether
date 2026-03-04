const feature = @import("../feature.zig");
const patch = @import("../hook/patch.zig");
const log = @import("../log.zig");

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

    log.print("headless: all patches applied");
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
