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

    const aether = b.addLibrary(.{
        .linkage = .dynamic,
        .name = "Aether",
        .root_module = aether_mod,
    });
    b.installArtifact(aether);
}
