const std = @import("std");
const win = std.os.windows;
const WINAPI = win.WINAPI;

const feature = @import("feature.zig");
const game_hooks = @import("hook/game_hooks.zig");
const d2 = struct {
    const functions = @import("d2/functions.zig");
    const globals = @import("d2/globals.zig");
    const types = @import("d2/types.zig");
};
pub const fog_allocator = @import("fog_allocator.zig");
const crash_handler = @import("crash_handler.zig");
const log = @import("log.zig");
const ogl = @import("renderer/ogl.zig");

// Features
const screen_info = @import("features/screen_info.zig");
const omnivision = @import("features/omnivision.zig");
const weather = @import("features/weather.zig");
const misc = @import("features/misc.zig");
const map_reveal = @import("features/map_reveal.zig");
const map_units = @import("features/map_units.zig");
const room_init = @import("features/room_init.zig");
const item_qol = @import("features/item_qol.zig");
const input = @import("features/input.zig");
const debug_mode = @import("features/debug_mode.zig");
const auto_move = @import("features/auto_move.zig");
pub const settings = @import("features/settings.zig");
pub const lua_engine = @import("lua/engine.zig");
const lua_feature = @import("lua/feature.zig");

const BOOL = win.BOOL;
const HMODULE = win.HINSTANCE;

extern "kernel32" fn DisableThreadLibraryCalls(h: HMODULE) callconv(WINAPI) BOOL;

pub export fn DllMain(hModule: HMODULE, reason: u32, _: ?*anyopaque) BOOL {
    switch (reason) {
        1 => { // DLL_PROCESS_ATTACH
            log.initConsole();
            log.print("aether: DLL_PROCESS_ATTACH");
            _ = DisableThreadLibraryCalls(hModule);
            crash_handler.install();

            // OpenGL renderer — must run before game_hooks to patch D2GFX_Initialize
            ogl.earlyInit();

            // Register features — isolating crash
            feature.register(&screen_info.hooks);
            feature.register(&misc.hooks);
            feature.register(&map_reveal.hooks);
            feature.register(&map_units.hooks);
            feature.register(&room_init.hooks);
            feature.register(&item_qol.hooks);
            feature.register(&input.hooks);
            feature.register(&debug_mode.hooks);
            feature.register(&auto_move.hooks);
            feature.register(&omnivision.hooks);
            feature.register(&weather.hooks);
            feature.register(&settings.hooks);
            feature.register(&lua_feature.hooks);

            // Init features, then install hooks
            feature.initAll();
            game_hooks.install();
            log.print("aether: all hooks installed");

            // Lua scripting engine
            lua_engine.init();
        },
        0 => { // DLL_PROCESS_DETACH
            lua_engine.deinit();
            game_hooks.uninstall();
            feature.deinitAll();
            ogl.cleanup();
        },
        else => {},
    }
    return 1; // TRUE
}
