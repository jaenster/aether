const feature = @import("../feature.zig");
const patch = @import("../hook/patch.zig");

// RoomInit hook at 0x542b40 — __fastcall(pGame, pRoom1)
// Hooks the start of the room initialization function so features
// can run custom code when rooms are initialized.
//
// The original prologue is 6 bytes:
//   push ebp          (55)
//   mov ebp, esp      (8B EC)
//   sub esp, 0x18     (83 EC 18)
//
// We overwrite with a JMP to our naked thunk, which:
// 1. Saves ECX/EDX (fastcall args)
// 2. Executes the original prologue
// 3. Jumps back to the original function body at +6

const ADDR_ROOM_INIT: usize = 0x542b40;
const ADDR_ROOM_INIT_REJOIN: usize = 0x542b46;

fn init() void {
    _ = patch.writeJump(ADDR_ROOM_INIT, @intFromPtr(&roomInitThunk));
    _ = patch.writeNops(ADDR_ROOM_INIT + 5, 1);
}

fn deinit() void {
    patch.revertRange(ADDR_ROOM_INIT, 6);
}

fn roomInitThunk() callconv(.naked) void {
    // Replicate original 6-byte prologue then jump back
    asm volatile (
        \\push %%ebp
        \\mov %%esp, %%ebp
        \\sub $0x18, %%esp
    );
    asm volatile ("jmp *%[target]"
        :
        : [target] "r" (ADDR_ROOM_INIT_REJOIN),
    );
}

pub const hooks = feature.Hooks{
    .init = &init,
    .deinit = &deinit,
};
