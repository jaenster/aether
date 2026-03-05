const feature = @import("../feature.zig");
const patch = @import("../hook/patch.zig");

// NET_D2GS_SERVER_Send_0x9C_ItemWorld — sends item-on-ground packet to client.
// When nAction == 0 (dropped), we set the IDENTIFIED flag before sending.
//
// Original: 0x53eae0, __fastcall(pClient, pItem, nAction, eItemFlag, param5)
// Prologue: push ebp / mov ebp,esp / sub esp,0x100 (9 bytes)
// Rejoin:   0x53eae9

const ADDR_ITEM_WORLD: usize = 0x53eae0;
const ADDR_ITEM_WORLD_REJOIN: usize = 0x53eae9;

// ITEM_EditItemData_eItemFlag(pItem, eItemFlag, bSet) — __stdcall
const EditItemFlag = *const fn (*anyopaque, u32, i32) callconv(.winapi) i32;
const editItemFlag: EditItemFlag = @ptrFromInt(0x6280d0);
const ITEMFLAG_IDENTIFIED: u32 = 4;

fn init() void {
    _ = patch.writeJump(ADDR_ITEM_WORLD, @intFromPtr(&itemWorldHook));
    _ = patch.writeNops(ADDR_ITEM_WORLD + 5, 4); // 9-byte prologue
}

fn deinit() void {
    patch.revertRange(ADDR_ITEM_WORLD, 9);
}

// The hook is naked because this is a __fastcall function and we need
// to preserve ECX/EDX while accessing stack args.
fn itemWorldHook() callconv(.naked) void {
    // __fastcall layout on entry:
    //   ECX = pClient, EDX = pItem
    //   [esp+4] = nAction, [esp+8] = eItemFlag, [esp+12] = param5
    asm volatile (
    // Save fastcall registers
        \\push %%ecx
        \\push %%edx
        // Check nAction == 0 (dropped on ground)
        // nAction is at [esp+4] originally, but we pushed 2 regs, so [esp+12]
        \\cmpl $0, 0xC(%%esp)
        \\jnz 1f
        // Call editItemFlag(pItem, ITEMFLAG_IDENTIFIED, TRUE) — __stdcall
        \\push $1
        \\push $4
        \\push %%edx
    );
    asm volatile ("call *%[func]"
        :
        : [func] "r" (@as(usize, 0x6280d0)),
    );
    asm volatile (
        \\1:
        // Restore fastcall registers
        \\pop %%edx
        \\pop %%ecx
        // Replicate original 9-byte prologue
        \\push %%ebp
        \\mov %%esp, %%ebp
        \\sub $0x100, %%esp
    );
    // Jump back to original function body
    asm volatile ("jmp *%[target]"
        :
        : [target] "r" (ADDR_ITEM_WORLD_REJOIN),
    );
}

pub const hooks = feature.Hooks{
    .init = &init,
    .deinit = &deinit,
};
