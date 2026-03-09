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

    // --- SpiderMonkey (pre-built static lib from packages/spidermonkey) ---
    // Build with: packages/spidermonkey/build-mozjs.sh
    const sm = std.Build.LazyPath{ .cwd_relative = "packages/spidermonkey" };
    const sm_build = sm.path(b, "build");
    const sm_include = sm.path(b, "build/include");
    const sm_src = sm.path(b, "src");

    // Link pre-built static libraries
    aether.addObjectFile(sm_build.path(b, "src/js/libjs.a"));
    aether.addObjectFile(sm_build.path(b, "src/mfbt/libmfbt.a"));
    aether.addObjectFile(sm_build.path(b, "src/mozglue/misc/libmozglue.a"));
    aether.addObjectFile(sm_build.path(b, "src/memory/mozalloc/libmozalloc.a"));
    aether.addObjectFile(sm_build.path(b, "src/memory/build/libmozmemory.a"));
    aether.addObjectFile(sm_build.path(b, "src/nsprpub/pr/libnspr.a"));
    aether.addObjectFile(sm_build.path(b, "src/nsprpub/lib/libc/liblibc.a"));
    aether.addObjectFile(sm_build.path(b, "src/modules/zlib/libzlib.a"));
    aether.addObjectFile(sm_build.path(b, "src/modules/fdlibm/libfdlibm.a"));

    // SM bridge — the only C++ we compile ourselves
    aether.addCSourceFiles(.{
        .files = &.{"src/sm/sm_bridge.cpp"},
        .flags = &.{ "-std=c++17", "-w" },
    });
    aether.addIncludePath(sm_include);
    aether.addIncludePath(sm_src.path(b, "js/src"));
    aether.addIncludePath(sm_src.path(b, "mfbt/src"));
    aether.addIncludePath(sm_src.path(b, "nsprpub/pr/include"));
    aether.addIncludePath(sm_src.path(b, "memory/mozalloc"));
    aether.addIncludePath(b.path("src/sm"));

    // Win32 libs needed by NSPR + SM
    aether.linkSystemLibrary("ws2_32");
    aether.linkSystemLibrary("winmm");
    aether.linkSystemLibrary("advapi32");
    aether.linkSystemLibrary("psapi");
    aether.linkLibCpp();

    b.installArtifact(aether);
}
