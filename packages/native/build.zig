const std = @import("std");

const lua_sources = [_][]const u8{
    "lapi.c",     "lauxlib.c",  "lbaselib.c", "lcode.c",    "lcorolib.c",
    "lctype.c",   "ldblib.c",   "ldebug.c",   "ldo.c",      "ldump.c",
    "lfunc.c",    "lgc.c",      "linit.c",    "liolib.c",   "llex.c",
    "lmathlib.c", "lmem.c",     "loadlib.c",  "lobject.c",  "lopcodes.c",
    "loslib.c",   "lparser.c",  "lstate.c",   "lstring.c",  "lstrlib.c",
    "ltable.c",   "ltablib.c",  "ltm.c",      "lundump.c",  "lutf8lib.c",
    "lvm.c",      "lzio.c",
};

pub fn build(b: *std.Build) void {
    const target = b.resolveTargetQuery(.{
        .cpu_arch = .x86,
        .os_tag = .windows,
        .abi = .gnu,
    });
    const optimize = b.standardOptimizeOption(.{});

    // --- dbghelp.dll proxy ---
    const dbghelp = b.addLibrary(.{
        .linkage = .dynamic,
        .name = "dbghelp",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/dbghelp_proxy.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        }),
    });
    b.installArtifact(dbghelp);

    // --- Aether.dll ---
    const aether_mod = b.createModule(.{
        .root_source_file = b.path("src/aether.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });

    // Lua 5.4.7
    const lua_dir = "vendor/lua-5.4.7";
    aether_mod.addIncludePath(b.path(lua_dir));
    aether_mod.addCSourceFiles(.{
        .files = &lua_sources,
        .root = b.path(lua_dir),
        .flags = &.{"-std=c99"},
    });

    const aether = b.addLibrary(.{
        .linkage = .dynamic,
        .name = "Aether",
        .root_module = aether_mod,
    });
    b.installArtifact(aether);
}
