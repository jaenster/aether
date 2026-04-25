# V8 x86 Spike — Phase 0

## Objective

Prove V8 can run inside a 32-bit Windows process, cross-compiled from macOS ARM via Zig. This is the project's go/no-go gate.

**Success criteria:** `charon_log.txt` prints `V8: 2` from inside running Game.exe after evaluating `1+1`.

## Existing Assets

### v8_monolith.zip (640MB)
- `libs/x86/release/v8_monolith.lib` — 605MB, x86 Windows, MSVC ABI, UCRT
- `libs/x86/debug/v8_monolith.lib` — 737MB, with debug symbols + PDBs
- Built April 2020 (V8 ~8.3, Chrome 83 era)
- **MSVC-compiled** — `.lib` + `.pdb` = MSVC toolchain
- **No headers included**

### What we need to source
- V8 ~8.3 headers from `v8/v8` git repo (tag matching April 2020)
- Only the `include/` directory (~50 files)

## ABI Switch: gnu → msvc

Current build targets `x86-windows-gnu` (MinGW ABI). The V8 monolith is MSVC-compiled. We need to switch.

### Why this should work
- All game function calls already use explicit `callconv(.winapi)` — not affected by default ABI
- D2 1.14d itself is MSVC-compiled, so `.abi = .msvc` is actually more compatible
- Zig's x86-windows-msvc target links against UCRT (same CRT as the V8 monolith)

### Migration steps
1. Change `build.zig`: `.abi = .gnu` → `.abi = .msvc`
2. Build without V8, verify game still works (all hooks, all features)
3. If anything breaks, audit for implicit calling convention assumptions

### Risk: what if it breaks?
- Check for any `callconv(.c)` that should be `.winapi` — `.c` means cdecl on both ABIs, should be fine
- Check for any functions without explicit callconv — these would change default
- The hook functions in `game_hooks.zig` use `callconv(.c)` and `callconv(.winapi)` explicitly — safe

## C Bridge Design

V8 has a C++ API. Zig can't call C++ directly. Write a thin `v8_bridge.cpp` with `extern "C"` functions.

### Bridge API (~200 lines)

```c
// v8_bridge.h
#pragma once
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Lifecycle
int      v8_init(void);
void     v8_shutdown(void);

// Isolate/Context
void*    v8_create_isolate(int heap_limit_mb);
void     v8_destroy_isolate(void* isolate);
void*    v8_create_context(void* isolate);
void     v8_destroy_context(void* context);

// Execution
int      v8_eval(void* context, const char* source, int source_len,
                 char* result_buf, int result_buf_len);
void     v8_pump_microtasks(void* isolate);

// Native function registration (Phase 2)
typedef void (*v8_native_fn)(void* info);
int      v8_register_function(void* context, const char* name, v8_native_fn fn);

// Module support (Phase 3)
typedef int (*v8_module_resolve_fn)(const char* specifier, int spec_len,
                                    char* source_buf, int source_buf_len);
void     v8_set_module_resolver(void* isolate, v8_module_resolve_fn fn);
int      v8_load_module(void* context, const char* name, const char* source, int source_len);

// Diagnostics
int      v8_get_heap_used(void* isolate);
int      v8_get_heap_limit(void* isolate);

#ifdef __cplusplus
}
#endif
```

### Implementation sketch

```cpp
// v8_bridge.cpp
#include "v8_bridge.h"
#include "v8.h"
#include "libplatform/libplatform.h"

static std::unique_ptr<v8::Platform> g_platform;

extern "C" int v8_init(void) {
    v8::V8::InitializeICUDefaultLocation(nullptr);
    g_platform = v8::platform::NewDefaultPlatform();
    v8::V8::InitializePlatform(g_platform.get());
    v8::V8::Initialize();
    return 0; // success
}

extern "C" void v8_shutdown(void) {
    v8::V8::Dispose();
    v8::V8::DisposePlatform();
}

extern "C" void* v8_create_isolate(int heap_limit_mb) {
    v8::Isolate::CreateParams params;
    params.array_buffer_allocator =
        v8::ArrayBuffer::Allocator::NewDefaultAllocator();
    if (heap_limit_mb > 0) {
        // V8 8.3: use resource constraints
        params.constraints.set_max_old_generation_size_in_bytes(
            heap_limit_mb * 1024 * 1024);
    }
    return v8::Isolate::New(params);
}

// ... ~150 more lines for eval, context, microtasks
```

## Build Integration

### Step 1: Extract V8 assets
```bash
# Extract only what we need
unzip v8_monolith.zip libs/x86/release/v8_monolith.lib -d v8/
mv v8/libs/x86/release/v8_monolith.lib packages/native/lib/
rm -rf v8/

# Source headers (one-time)
git clone --depth 1 --branch 8.3.110.9 https://chromium.googlesource.com/v8/v8.git v8-headers
cp -r v8-headers/include packages/native/v8-include/
rm -rf v8-headers
```

### Step 2: Update build.zig

```zig
pub fn build(b: *std.Build) void {
    const target = b.resolveTargetQuery(.{
        .cpu_arch = .x86,
        .os_tag = .windows,
        .abi = .msvc,  // Changed from .gnu
    });
    const optimize = b.standardOptimizeOption(.{});

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

    // V8 bridge (C++ compiled by Zig's bundled clang)
    aether.addCSourceFiles(.{
        .files = &.{"src/v8/v8_bridge.cpp"},
        .flags = &.{
            "-std=c++17",
            "-fno-exceptions",  // V8 doesn't use exceptions
            "-fno-rtti",        // V8 built without RTTI
        },
    });
    aether.addIncludePath(b.path("v8-include"));

    // Link V8 monolith
    aether.addObjectFile(b.path("lib/v8_monolith.lib"));

    // V8 depends on these Windows libs
    aether.linkSystemLibrary("winmm");
    aether.linkSystemLibrary("dbghelp");  // V8 stack traces (not our proxy)
    aether.linkSystemLibrary("advapi32");
    aether.linkSystemLibrary("shlwapi");

    b.installArtifact(aether);
}
```

### Step 3: Zig-side V8 wrapper

```zig
// src/v8/engine.zig
const c = @cImport({
    @cInclude("v8_bridge.h");
});

pub const Engine = struct {
    isolate: *anyopaque,
    context: *anyopaque,

    pub fn init(heap_limit_mb: i32) !Engine {
        if (c.v8_init() != 0) return error.V8InitFailed;
        const isolate = c.v8_create_isolate(heap_limit_mb) orelse return error.IsolateCreateFailed;
        const context = c.v8_create_context(isolate) orelse return error.ContextCreateFailed;
        return .{ .isolate = isolate, .context = context };
    }

    pub fn eval(self: *Engine, source: []const u8) ![256]u8 {
        var buf: [256]u8 = undefined;
        const len = c.v8_eval(self.context, source.ptr, @intCast(source.len), &buf, buf.len);
        if (len < 0) return error.EvalFailed;
        return buf;
    }

    pub fn pumpMicrotasks(self: *Engine) void {
        c.v8_pump_microtasks(self.isolate);
    }

    pub fn deinit(self: *Engine) void {
        c.v8_destroy_context(self.context);
        c.v8_destroy_isolate(self.isolate);
        c.v8_shutdown();
    }
};
```

## Spike Steps (ordered)

### Step 1: ABI switch validation
- Change `.abi = .gnu` → `.abi = .msvc` in build.zig
- Build, inject into Game.exe, verify all features still work
- If broken: fix and document what changed

### Step 2: Extract V8 assets
- Extract `v8_monolith.lib` from zip → `packages/native/lib/`
- Source V8 8.3 headers → `packages/native/v8-include/`
- Add `lib/` and `v8-include/` to `.gitignore` (too large for git)

### Step 3: Standalone test (outside Game.exe)
- Write `v8_bridge.cpp` + `v8_bridge.h`
- Build a standalone 32-bit .exe that links V8, calls `v8_init()` + `v8_eval("1+1")`
- Run under Wine, verify output

### Step 4: Integrate into Aether.dll
- Add `v8_bridge.cpp` to the Aether build via `addCSourceFiles`
- Link `v8_monolith.lib`
- Call `v8_init()` from DllMain (or from scripting feature init)
- Call `v8_eval("1+1")` and log result

### Step 5: Validate in-game
- Inject into Game.exe via dbghelp proxy
- Verify: no address space conflicts, no symbol clashes
- Verify: JIT memory allocation works post-injection
- Verify: existing features unaffected

## Failure Modes

| Failure | Likelihood | Mitigation |
|-|-|-|
| `.abi = .msvc` breaks hooks | Low | All hooks use explicit callconv. Test incrementally. |
| Zig's clang can't compile V8 C++ | Low | V8 API is standard C++. Fallback: compile bridge externally with clang-cl, add .obj. |
| V8 8.3 headers unavailable | Very Low | V8 is open source, `git checkout` the tag. |
| DLL too large for 32-bit | Low | Static link → ~30MB code. Game uses ~200MB. 4GB total. Strip symbols. |
| JIT pages fail VirtualAlloc | Low | Test with `--jitless` flag first (V8 interpreter-only mode). |
| V8 8.3 too old for JS features | Low | SWC on daemon side can downlevel. Rebuild newer V8 later. |
| V8 init crashes in DllMain | Medium | Don't init in DllMain directly. Use a separate init call after game loads. Feature init hook fires after DllMain. |

## What NOT to do

- No daemon, no protocol, no types packages
- No game API exposure — just `eval("1+1")`
- No module system — raw string eval only
- No networking — pure local test

## V8 8.3 Header Source

The V8 monolith was built April 2020. V8 8.3 corresponds to Chrome 83 (stable May 2020).

```bash
# Option A: git checkout
git clone --depth 1 --branch 8.3.110.9 https://chromium.googlesource.com/v8/v8.git

# Option B: if exact tag unavailable, use the 8.3 branch
git clone --depth 1 --branch 8.3-lkgr https://chromium.googlesource.com/v8/v8.git
```

We only need `include/` (~2MB). Everything else can be deleted.

## Address Space Budget

| Component | Estimated Size |
|-|-|
| Game.exe text/data | ~15MB |
| Game.exe heap + stack | ~200MB |
| V8 code (linked) | ~30MB |
| V8 heap (capped) | 64-128MB |
| Zig DLL code | ~2MB |
| Other DLLs | ~50MB |
| **Total** | **~360-430MB** |
| **Available** | **4GB** (32-bit) |

Plenty of headroom.
