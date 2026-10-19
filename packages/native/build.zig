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

    // Link against mozjs.dll import library (built by build-dll.sh with MinGW g++).
    // The bridge table is filled from these imports (src/sm/bridge_linked.zig).
    aether_mod.addObjectFile(sm.path(b, "build-mingw/dll/libmozjs.dll.a"));

    b.installArtifact(aether);

    // --- AetherEmbed.dll: the engine for a host that owns the process ---
    // No patch on load and no import of mozjs.dll: the host loads it and hands
    // it to aether_init (src/embed.zig, src/embed_dll.zig).
    const embed = b.addLibrary(.{
        .linkage = .dynamic,
        .name = "AetherEmbed",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/embed_dll.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        }),
    });
    b.installArtifact(embed);

    // --- zig build test ---
    const test_step = b.step("test", "Unit tests and the embed path check");

    const bridge_tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/sm/bridge.zig"),
            .target = b.graph.host,
        }),
    });
    test_step.dependOn(&b.addRunArtifact(bridge_tests).step);

    const json_tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/net/json.zig"),
            .target = b.graph.host,
        }),
    });
    test_step.dependOn(&b.addRunArtifact(json_tests).step);

    const embed_check = b.addExecutable(.{
        .name = "embed_check",
        .root_module = b.createModule(.{
            .root_source_file = b.path("tools/embed_check.zig"),
            .target = b.graph.host,
        }),
    });
    const run_check = b.addRunArtifact(embed_check);
    run_check.addDirectoryArg(b.path("src"));
    run_check.addArgs(&.{ "embed.zig", "embed_dll.zig" });
    run_check.expectExitCode(0);
    test_step.dependOn(&run_check.step);
}
