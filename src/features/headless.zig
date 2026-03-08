const std = @import("std");
const win = std.os.windows;
const feature = @import("../feature.zig");
const patch = @import("../hook/patch.zig");
const log = @import("../log.zig");
const crash_handler = @import("../crash_handler.zig");

// Safety patches (always loaded):
// - DC6 null guards, bnet stubs, ExitProcess hook
//
// Headless mode (--headless flag):
// - Renderers stubbed (nothing draws)
// - Char select works without DC6 sprites
// - Video/palette loaders stubbed (files don't exist)

var headless_rendering: bool = false;

pub fn enableHeadlessMode() void {
    headless_rendering = true;

    // --- Renderers: nothing draws ---
    // RENDERER_DrawOutOfGameScene (0x004F98E0)
    _ = patch.writeBytes(0x004F98E0, &[_]u8{0xC3});
    // InGameDraw (0x0044C990) — stdcall, 1 arg
    _ = patch.writeBytes(0x0044C990, &[_]u8{ 0xC2, 0x04, 0x00 });

    // --- Char select without DC6 sprites ---
    // AllocCharSelectComponent (0x005066C0) — return NULL. Stdcall 4 args.
    _ = patch.writeBytes(0x005066C0, &[_]u8{ 0x31, 0xC0, 0xC2, 0x10, 0x00 });
    // In SAVEFILE_ParseSaveData, after AllocCharSelectComponent returns NULL:
    // skip the ERROR_Halt and 3 animation calls, jump to list building code.
    // Patch the JNZ at 0x00438D8B (2 bytes) + overwrite halt PUSH (5 bytes total).
    const skip_handler = @intFromPtr(&parseSaveSkipAnimHandler);
    const skip_jmp = patch.calcRelAddr(0x00438D8B, skip_handler, 5);
    const skip_bytes: [4]u8 = @bitCast(skip_jmp);
    _ = patch.writeBytes(0x00438D8B, &[_]u8{ 0xE9, skip_bytes[0], skip_bytes[1], skip_bytes[2], skip_bytes[3] });
    // D2COMP_DestroyCompositeUnit (0x005041b0) — halts on NULL, make it return instead.
    // At 0x005041BC: replace ERROR_Halt with POP ESI; POP ECX; POP EBP; RET 8
    _ = patch.writeBytes(0x005041BC, &[_]u8{ 0x5E, 0x59, 0x5D, 0xC2, 0x08, 0x00 });
    // DRAW_LocalCharsInSelectionScreen0 (0x00438560) — char list display
    _ = patch.writeBytes(0x00438560, &[_]u8{0xC3});
    // CHARSEL_UpdateSelectedCharDisplay (0x00439210) — char display update
    _ = patch.writeBytes(0x00439210, &[_]u8{ 0x31, 0xC0, 0xC3 });

    // Draw_UI_LoadGame (0x004565E0) — loading screen UI, fastcall 1 arg
    _ = patch.writeBytes(0x004565E0, &[_]u8{0xC3});
    // NOP out CurrentDrawFunction calls in CLIENT_GameLoopFrame
    _ = patch.writeBytes(0x0044F017, &[_]u8{ 0x90, 0x90, 0x90, 0x90, 0x90, 0x90 });
    _ = patch.writeBytes(0x0044F28B, &[_]u8{ 0x90, 0x90, 0x90, 0x90, 0x90, 0x90 });

    // --- Missing media files ---
    // D2COMP_LoadAllItemPalettes (0x00505550)
    _ = patch.writeBytes(0x00505550, &[_]u8{0xC3});
    // PALETTE_InitItemPalettes (0x00600B80)
    _ = patch.writeBytes(0x00600B80, &[_]u8{0xC3});
    // BINK video
    _ = patch.writeBytes(0x005137E0, &[_]u8{ 0xC2, 0x04, 0x00 });
    _ = patch.writeBytes(0x005136F0, &[_]u8{0xC3});
}

fn init() void {
    log.print("headless: applying safety patches");

    // DC6 null safety: CELCMP_FixupPointersAndPrepare (0x00601340)
    const handler_addr = @intFromPtr(&celcmpNullHandler);
    const jz_addr: usize = 0x00601349;
    const rel = patch.calcRelAddr(jz_addr, handler_addr, 6);
    const rel_bytes: [4]u8 = @bitCast(rel);
    _ = patch.writeBytes(jz_addr + 2, &rel_bytes);

    // IMAGE_GetFramesCount null guard (0x006019F0)
    const getframes_handler = @intFromPtr(&imageGetFramesCountGuard);
    const getframes_jmp = patch.calcRelAddr(0x006019F0, getframes_handler, 5);
    const getframes_bytes: [4]u8 = @bitCast(getframes_jmp);
    _ = patch.writeBytes(0x006019F0, &[_]u8{ 0xE9, getframes_bytes[0], getframes_bytes[1], getframes_bytes[2], getframes_bytes[3], 0x90 });

    // BNGatewayAccess::Load (0x005186d0) — halts if Realms.bin missing
    _ = patch.writeBytes(0x005186d0, &[_]u8{ 0xC2, 0x04, 0x00 });

    // CLIENT_ConnectToBattleNet (0x0043BF60)
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
    patch.revertRange(0x00601349 + 2, 4);
    patch.revertRange(0x006019F0, 6);
    patch.revertRange(0x005186d0, 3);
    patch.revertRange(0x0043BF60, 3);
    if (headless_rendering) {
        patch.revertRange(0x004F98E0, 1);
        patch.revertRange(0x0044C990, 3);
        patch.revertRange(0x005066C0, 5);
        patch.revertRange(0x00438D8B, 5);
        patch.revertRange(0x005041BC, 6);
        patch.revertRange(0x00438560, 1);
        patch.revertRange(0x00439210, 3);
        patch.revertRange(0x004565E0, 1);
        patch.revertRange(0x0044F017, 6);
        patch.revertRange(0x0044F28B, 6);
        patch.revertRange(0x00505550, 1);
        patch.revertRange(0x00600B80, 1);
        patch.revertRange(0x005137E0, 3);
        patch.revertRange(0x005136F0, 1);
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

// SAVEFILE_ParseSaveData: after the NULL check at 0x00438D89 (CMP EAX,EDI),
// if NULL: skip halt + 3 animation calls, jump to list building at 0x00438DD6.
// if non-NULL: jump to 0x00438DAC (original animation setup path).
fn parseSaveSkipAnimHandler() callconv(.naked) void {
    asm volatile (
        \\test %%eax, %%eax
        \\jnz 1f
        // NULL: skip halt and animation calls
        \\push $0x00438DD6
        \\ret
        \\1:
        // Non-NULL: continue with animation setup
        \\push $0x00438DAC
        \\ret
    );
}

pub const hooks = feature.Hooks{
    .init = &init,
    .deinit = &deinit,
};
