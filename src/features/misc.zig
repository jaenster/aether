const feature = @import("../feature.zig");
const patch = @import("../hook/patch.zig");
const settings = @import("settings.zig");
const d2 = struct {
    const globals = @import("../d2/globals.zig");
};

// These patches are applied at init time — they modify code bytes, not runtime state,
// so they're safe to apply early (the memory pages exist even before game starts).

fn init() void {
    // Disable the game's crash handler so our vectored handler fires first.
    _ = patch.writeNops(0x408D31, 5);

    // Kill ErrorReportingLaunch — prevents BlizzardError.exe crash dialog
    _ = patch.writeBytes(0x401790, &[_]u8{0xC3});

    // Kill DumpLog — another path to crash reporter
    _ = patch.writeBytes(0x4082E0, &[_]u8{0xC3});

    // Disable screen shake
    _ = patch.writeBytes(0x476D40, &[_]u8{0xC3});

    // Allow multiple game windows — NOP over FindWindowA check
    _ = patch.writeNops(0x4F5621, 0x4F5672 - 0x4F5621);

    // Disable fade effects when switching areas
    _ = patch.writeBytes(0x4DC000, &[_]u8{0xC3});

    // Sound cleanup delay — prevent crash on game exit
    _ = patch.writeBytes(0x515FB1, &[_]u8{0x01});

    // Hyperjoin for TCP/IP games
    _ = patch.writeBytes(0x4781AC, &[_]u8{ 0x6A, 0x05, 0x90, 0x90, 0x90 });

    // Fix RandTransforms.dat for LoD to colorize monsters properly
    _ = patch.writeBytes(0x4666A5, &[_]u8{0x26});

    // Fix LRUCACHE_Unlink null deref at 0x6091E5 (d2bs GameCrashFix)
    // Rewrite 18-byte unguarded unlink with null-checked version:
    //   mov ecx,[eax+10] / jecxz +0D / mov edx,[eax+0C] / test edx,edx / jz +06 / mov [ecx+0C],edx / mov [edx+10],ecx
    _ = patch.writeBytes(0x6091D6, &[_]u8{
        0x8B, 0x48, 0x10, // mov ecx, [eax+0x10]
        0xE3, 0x0D, // jecxz +0x0D (skip to 0x6091E8)
        0x8B, 0x50, 0x0C, // mov edx, [eax+0xC]
        0x85, 0xD2, // test edx, edx
        0x74, 0x06, // jz +0x06 (skip to 0x6091E8)
        0x89, 0x51, 0x0C, // mov [ecx+0xC], edx
        0x89, 0x4A, 0x10, // mov [edx+0x10], ecx
    });
}

fn deinit() void {
    patch.revertRange(0x408D31, 5);
    patch.revertRange(0x401790, 1);
    patch.revertRange(0x4082E0, 1);
    patch.revertRange(0x476D40, 1);
    patch.revertRange(0x4F5621, 0x4F5672 - 0x4F5621);
    patch.revertRange(0x4DC000, 1);
    patch.revertRange(0x515FB1, 1);
    patch.revertRange(0x4781AC, 5);
    patch.revertRange(0x4666A5, 1);
    patch.revertRange(0x6091D6, 18);
}

pub const hooks = feature.Hooks{
    .init = &init,
    .deinit = &deinit,
};
