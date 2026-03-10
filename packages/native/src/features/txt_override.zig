const std = @import("std");
const feature = @import("../feature.zig");
const patch = @import("../hook/patch.zig");
const trampoline = @import("../hook/trampoline.zig");
const log = @import("../log.zig");
const settings = @import("settings.zig");

const COMPILE_TXT_ADDR: usize = 0x6122f0;
const HOOK_SIZE: usize = 9; // PUSH EBP (1) + MOV EBP,ESP (2) + SUB ESP,0x11c (6)

const CompileTxtFn = *const fn (usize, usize, usize, usize, usize) callconv(.winapi) usize;
var original_fn: CompileTxtFn = undefined;

// Normal stdcall hook — JMP from patched site lands here with [ret][arg1..5] on stack.
// Use usize for all params to avoid Zig type system issues with nullable pointers.
fn hookCompileTxt(pMemory: usize, szTableName: usize, pBinFieldInput: usize, pnTxtTableSize: usize, nLineLength: usize) callconv(.winapi) usize {
    const table = original_fn(pMemory, szTableName, pBinFieldInput, pnTxtTableSize, nLineLength);
    if (table != 0 and szTableName != 0 and pnTxtTableSize != 0) {
        applyOverrides(table, szTableName, pnTxtTableSize, nLineLength);
    }
    return table;
}

fn applyOverrides(table_ptr: usize, name_addr: usize, size_addr: usize, nLineLength: usize) void {
    const name: [*:0]const u8 = @ptrFromInt(name_addr);
    const count_ptr: *const u32 = @ptrFromInt(size_addr);
    const count = count_ptr.*;
    const line_len: usize = nLineLength;
    if (line_len == 0 or count == 0) return;

    const name_slice = std.mem.span(name);

    if (settings.ladder_items) {
        if (std.mem.eql(u8, name_slice, "runes")) {
            patchRunes(table_ptr, count, line_len);
        } else if (std.mem.eql(u8, name_slice, "cubemain")) {
            patchCubemain(table_ptr, count, line_len);
        } else if (std.mem.eql(u8, name_slice, "uniqueitems")) {
            patchUniqueItems(table_ptr, count, line_len);
        }
    }

    if (settings.rebalance_drops) {
        if (std.mem.eql(u8, name_slice, "itemratio")) {
            patchItemRatio(table_ptr, count, line_len);
        } else if (std.mem.eql(u8, name_slice, "treasureclassex")) {
            patchTreasureClassEx(table_ptr, count);
        }
    }
}

// D2RunesTxt: server byte at +0x81 — set to 0 to enable ladder runewords offline
fn patchRunes(base: usize, count: u32, stride: usize) void {
    for (0..count) |i| {
        const server: *u8 = @ptrFromInt(base + i * stride + 0x81);
        if (server.* != 0) {
            server.* = 0;
        }
    }
}

// D2CubeMainTxt: ladder byte at +0x01 — set to 0 to enable ladder recipes
fn patchCubemain(base: usize, count: u32, stride: usize) void {
    for (0..count) |i| {
        const ladder: *u8 = @ptrFromInt(base + i * stride + 0x01);
        if (ladder.* != 0) {
            ladder.* = 0;
        }
    }
}

// D2UniqueItemsTxt: ladder flag = bit 3 at +0x2C — clear to enable ladder uniques
fn patchUniqueItems(base: usize, count: u32, stride: usize) void {
    for (0..count) |i| {
        const flags: *u8 = @ptrFromInt(base + i * stride + 0x2C);
        if (flags.* & 0x08 != 0) {
            flags.* &= 0xF7;
        }
    }
}

// D2ItemRatioTxt layout: { value, divisor, min } × 4 quality tiers, then hiQuality/normal
//   +0x00 unique.value,  +0x04 unique.divisor,  +0x08 unique.min
//   +0x0C rare.value,    +0x10 rare.divisor,    +0x14 rare.min
//   +0x18 set.value,     +0x1C set.divisor,     +0x20 set.min
//   +0x24 magic.value,   +0x28 magic.divisor,   +0x2C magic.min
// Charon approach: use magic tier as baseline, propagate divisor/min, scale values.
fn patchItemRatio(base: usize, count: u32, stride: usize) void {
    for (0..count) |i| {
        const row = base + i * stride;
        const magic_val = readU32(row + 0x24);
        const magic_div = readU32(row + 0x28);
        const magic_min = readU32(row + 0x2C);
        // unique = magic * 3, rare = set = magic * 2
        writeU32(row + 0x00, magic_val * 3); // unique.value
        writeU32(row + 0x0C, magic_val * 2); // rare.value
        writeU32(row + 0x18, magic_val * 2); // set.value
        // all divisors and mins match magic tier
        writeU32(row + 0x04, magic_div);
        writeU32(row + 0x10, magic_div);
        writeU32(row + 0x1C, magic_div);
        writeU32(row + 0x08, magic_min);
        writeU32(row + 0x14, magic_min);
        writeU32(row + 0x20, magic_min);
    }
}

// D2TreasureClassExTxt layout (0x2E0 = 736 bytes per row):
//   +0x00  char treasureClass[32]
//   +0x20  long picks
//   +0x24  short group, level, magic, rare, set, unique, unk1[2]
//   +0x34  short nodrop
//   +0x36  short unk2
//   +0x38  char items[10][64]   (10 item name slots, 64 chars each)
//   +0x2B8 long prob[10]        (probability for each item slot)
const TC_STRIDE: usize = 0x2E0;
const TC_ITEMS_OFF: usize = 0x38;
const TC_PROB_OFF: usize = 0x2B8;
const TC_NODROP_OFF: usize = 0x34;

fn patchTreasureClassEx(base: usize, count: u32) void {
    // Rune TCs start at index 25 ("Runes 1" through "Runes 17").
    // For rows 26..41 (indices 1..16 relative to runes base), boost prob[2] with cubic formula.
    const rune_base_idx: u32 = 25;
    if (count > rune_base_idx + 17) {
        var c: u32 = 1;
        while (c < 17) : (c += 1) {
            const row = base + (rune_base_idx + c) * TC_STRIDE;
            const prob2: *i32 = @ptrFromInt(row + TC_PROB_OFF + 2 * 4); // prob[2]
            prob2.* = @as(i32, 2) + @as(i32, @intCast((c * c * c * 798) >> 12));
        }
        // rune probs boosted
    }

    // Countess rune TCs at indices 837-839: upgrade to better rune tiers
    if (count > 839) {
        copyItemName(base + 837 * TC_STRIDE + TC_ITEMS_OFF, "Runes 5");
        copyItemName(base + 838 * TC_STRIDE + TC_ITEMS_OFF, "Runes 11");
        copyItemName(base + 839 * TC_STRIDE + TC_ITEMS_OFF, "Runes 17");
        // Equalize nodrop across the three Countess TCs
        const nodrop839: *const i16 = @ptrFromInt(base + 839 * TC_STRIDE + TC_NODROP_OFF);
        const nd = nodrop839.*;
        const nodrop837: *i16 = @ptrFromInt(base + 837 * TC_STRIDE + TC_NODROP_OFF);
        const nodrop838: *i16 = @ptrFromInt(base + 838 * TC_STRIDE + TC_NODROP_OFF);
        nodrop837.* = nd;
        nodrop838.* = nd;
        // countess upgraded
    }
}

fn copyItemName(dest_addr: usize, name: []const u8) void {
    const dest: [*]u8 = @ptrFromInt(dest_addr);
    @memcpy(dest[0..name.len], name);
    dest[name.len] = 0;
}

fn readU32(addr: usize) u32 {
    const ptr: *const u32 = @ptrFromInt(addr);
    return ptr.*;
}

fn writeU32(addr: usize, val: u32) void {
    const ptr: *u32 = @ptrFromInt(addr);
    ptr.* = val;
}

fn init() void {
    const t = trampoline.build(COMPILE_TXT_ADDR, HOOK_SIZE) orelse {
        log.print("txt_override: failed to build trampoline");
        return;
    };
    original_fn = @ptrCast(@as(*const anyopaque, @ptrCast(t.buffer)));
    if (patch.writeJump(COMPILE_TXT_ADDR, @intFromPtr(&hookCompileTxt))) {
        _ = patch.writeNops(COMPILE_TXT_ADDR + 5, 4);
        log.print("txt_override: hooked CompileTxt");
    } else {
        log.print("txt_override: failed to install hook");
    }
}

fn deinit() void {
    patch.revertRange(COMPILE_TXT_ADDR, HOOK_SIZE);
}

pub const hooks = feature.Hooks{
    .init = &init,
    .deinit = &deinit,
};
