const std = @import("std");

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
    aether_mod.addOptions("config", b.addOptions());

    const aether = b.addLibrary(.{
        .linkage = .dynamic,
        .name = "Aether",
        .root_module = aether_mod,
    });

    // --- SpiderMonkey (pre-built DLL from packages/spidermonkey) ---
    // Build with: packages/spidermonkey/build-mozjs.sh && packages/spidermonkey/build-dll.sh
    const sm = std.Build.LazyPath{ .cwd_relative = "../spidermonkey" };

    // Link against mozjs.dll import library (built by build-dll.sh with MinGW g++)
    aether.addObjectFile(sm.path(b, "build-mingw/dll/libmozjs.dll.a"));

    // SM bridge header include path (for engine.zig's @cImport)
    aether_mod.addCMacro("MOZJS_DLL_IMPORT", "1");
    aether.addIncludePath(b.path("src/sm"));

    b.installArtifact(aether);
}
