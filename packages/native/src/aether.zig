const std = @import("std");
const win = std.os.windows;

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

// Features
const headless = @import("features/headless.zig");
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
const txt_override = @import("features/txt_override.zig");
pub const settings = @import("features/settings.zig");
const esc_menu = @import("features/esc_menu.zig");
const arcane_portal = @import("features/arcane_portal.zig");
const spawn_capture = @import("features/spawn_capture.zig");
const auto_enter = @import("features/auto_enter.zig");
const packet_hooks = @import("features/packet_hooks.zig");
const scripting = @import("features/scripting.zig");
const resource_monitor = @import("features/resource_monitor.zig");
const game_data = @import("features/game_data.zig");
const frame_limiter = @import("features/frame_limiter.zig");
const perf_tracker = @import("features/perf_tracker.zig");
pub const console = @import("features/console.zig");

const BOOL = win.BOOL;
const HMODULE = win.HINSTANCE;

extern "kernel32" fn DisableThreadLibraryCalls(h: HMODULE) callconv(.winapi) BOOL;
extern "kernel32" fn GetCommandLineA() callconv(.winapi) [*:0]const u8;

/// Check for --flag in command line (e.g. hasFlag("headless") matches "--headless")
fn hasFlag(comptime flag: []const u8) bool {
    const needle = "--" ++ flag;
    const cmdline: [*:0]const u8 = GetCommandLineA();
    var i: usize = 0;
    while (cmdline[i] != 0) : (i += 1) {
        if (cmdline[i] == '-' and cmdline[i + 1] == '-') {
            var j: usize = 0;
            while (j < needle.len and cmdline[i + j] != 0) : (j += 1) {
                if (cmdline[i + j] != needle[j]) break;
            } else {
                const after = cmdline[i + needle.len];
                if (after == 0 or after == ' ' or after == '\t') return true;
            }
        }
    }
    return false;
}

pub export fn DllMain(hModule: HMODULE, reason: u32, _: ?*anyopaque) BOOL {
    switch (reason) {
        1 => { // DLL_PROCESS_ATTACH
            log.initConsole();
            log.print("aether: DLL_PROCESS_ATTACH");
            _ = DisableThreadLibraryCalls(hModule);
            crash_handler.install();

            // Register features
            feature.register(&headless.hooks); // null guards + ExitProcess hook (always)
            if (hasFlag("headless")) {
                headless.enableHeadlessMode();
                log.print("aether: headless rendering disabled");
            }
            feature.register(&misc.hooks);
            feature.register(&map_reveal.hooks);
            feature.register(&map_units.hooks);
            feature.register(&room_init.hooks);
            feature.register(&item_qol.hooks);
            feature.register(&input.hooks);
            feature.register(&console.hooks);
            feature.register(&debug_mode.hooks);
            feature.register(&auto_move.hooks);
            feature.register(&omnivision.hooks);
            feature.register(&weather.hooks);
            feature.register(&txt_override.hooks);
            feature.register(&settings.hooks);
            feature.register(&esc_menu.hooks);
            //feature.register(&arcane_portal.hooks);
            if (hasFlag("spawn")) {
                feature.register(&spawn_capture.hooks);
                log.print("aether: spawn capture enabled");
            }
            // auto_enter disabled — JS handles OOG (char select, game creation)
            if (hasFlag("auto-enter")) {
                feature.register(&auto_enter.hooks);
                log.print("aether: auto_enter enabled (--auto-enter flag)");
            }
            feature.register(&packet_hooks.hooks);
            feature.register(&scripting.hooks);
            feature.register(&resource_monitor.hooks);
            feature.register(&game_data.hooks);
            feature.register(&perf_tracker.hooks);
            feature.register(&frame_limiter.hooks); // LAST — sleeps after all other features
            // Init features, then install hooks
            feature.initAll();
            game_hooks.install();
            log.print("aether: all hooks installed");
        },
        0 => { // DLL_PROCESS_DETACH
            game_hooks.uninstall();
            feature.deinitAll();
        },
        else => {},
    }
    return 1; // TRUE
}
