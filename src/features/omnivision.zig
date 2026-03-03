const feature = @import("../feature.zig");
const patch = @import("../hook/patch.zig");
const settings = @import("settings.zig");

const patch1_addr: usize = 0x66BFD0;
const patch1_len: usize = 27;
const patch2_addr: usize = 0x4DC710;
const patch2_len: usize = 20;

var patched: bool = false;
var orig1: [patch1_len]u8 = undefined;
var orig2: [patch2_len]u8 = undefined;
var saved: bool = false;

const patch1_bytes = [_]u8{
    0xC6, 0x02, 0xFF, // mov byte [edx], 0xFF (gamma)
    0x8B, 0x44, 0x24, 0x04, // mov eax, [esp+4] (red)
    0xC6, 0x00, 0xFF,
    0x8B, 0x44, 0x24, 0x08, // mov eax, [esp+8] (green)
    0xC6, 0x00, 0xFF,
    0x8B, 0x44, 0x24, 0x0C, // mov eax, [esp+0xC] (blue)
    0xC6, 0x00, 0xFF,
    0xC2, 0x0C, 0x00, // ret 0x0C
};

const patch2_bytes = [_]u8{
    0x85, 0xF6, // test esi, esi
    0x74, 0x0A, // jz +10
    0x81, 0x8E, 0xC8, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00, // or [esi+0xC8], 0x80
    0xB8, 0x01, 0x00, 0x00, 0x00, // mov eax, 1
    0xC3, // ret
};

fn saveOriginals() void {
    if (saved) return;
    const src1: *const [patch1_len]u8 = @ptrFromInt(patch1_addr);
    const src2: *const [patch2_len]u8 = @ptrFromInt(patch2_addr);
    orig1 = src1.*;
    orig2 = src2.*;
    saved = true;
}

fn gameLoop() void {
    saveOriginals();
    if (settings.omnivision and !patched) {
        _ = patch.writeBytes(patch1_addr, &patch1_bytes);
        _ = patch.writeBytes(patch2_addr, &patch2_bytes);
        patched = true;
    } else if (!settings.omnivision and patched) {
        _ = patch.writeBytes(patch1_addr, &orig1);
        _ = patch.writeBytes(patch2_addr, &orig2);
        patched = false;
    }
}

fn deinit() void {
    if (patched and saved) {
        _ = patch.writeBytes(patch1_addr, &orig1);
        _ = patch.writeBytes(patch2_addr, &orig2);
    }
}

pub const hooks = feature.Hooks{
    .gameLoop = &gameLoop,
    .deinit = &deinit,
};
