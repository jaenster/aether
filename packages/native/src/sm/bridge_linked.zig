//! The bridge table filled from mozjs.dll's import library. Only the injector
//! (Aether.dll) references this file, so only its import table names mozjs.dll.

const bridge = @import("bridge.zig");

pub fn install() void {
    var table: bridge.Api = undefined;
    inline for (@typeInfo(bridge.Api).@"struct".fields) |f| {
        @field(table, f.name) = @extern(f.type, .{ .name = f.name, .is_dll_import = true });
    }
    bridge.install(table);
}
