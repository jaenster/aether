# SpiderMonkey → Zig Build: Port Guide

## Source
- **Origin:** `/Users/jaenster/code/CPP/d2bs2/vendor/mozjs/` — Modern SpiderMonkey ESR with async/await, Promises, ESM modules, IonMonkey JIT
- **Target:** Copy source into `aether/packages/native/vendor/mozjs/` and compile as static lib with Zig's clang targeting `x86-windows-gnu`
- **432 .cpp files**, ~984k LOC, all deps vendored (ICU, NSPR, zlib, jemalloc)

## Architecture

```
aether/packages/native/
├── vendor/mozjs/src/          # Copied from d2bs2 (source only, no CMake)
│   ├── js/                    # SpiderMonkey core
│   ├── intl/                  # ICU (vendored)
│   ├── mfbt/                  # Mozilla foundation types
│   ├── mozglue/               # Glue code
│   ├── modules/               # zlib etc
│   ├── memory/                # jemalloc
│   └── nsprpub/               # NSPR (threading, networking)
├── src/sm/sm_bridge.cpp       # extern "C" bridge (replaces v8_bridge.cpp)
├── src/sm/sm_bridge.h         # C header for Zig to @cImport
└── build.zig                  # Builds mozjs static lib + links into Aether.dll
```

## Step-by-step

### 1. Copy source
```sh
cp -r /Users/jaenster/code/CPP/d2bs2/vendor/mozjs/src aether/packages/native/vendor/mozjs/src
```
Only the `src/` directory. No CMake files needed.

### 2. Create Zig build integration

In `build.zig`, when SpiderMonkey is enabled:
- Add all ~432 .cpp files via `addCSourceFiles`
- The full file list is in `/Users/jaenster/code/CPP/d2bs2/vendor/mozjs/src/js/CMakeLists.txt` (lines 37-500+)
- Also need files from `src/mfbt/`, `src/mozglue/`, `src/nsprpub/`, `src/intl/`, `src/memory/`, `src/modules/`
- Each subdirectory has its own `CMakeLists.txt` with its source list

Key compile flags:
```
-std=c++17 -w
-DWIN32 -D_WIN32 -DXP_WIN -D_X86_ -DJS_32BIT -DJS_NUNBOX32 -DJS_CODEGEN_X86
-DJSGC_INCREMENTAL -DJS_ION -DSTATIC_JS_API -DNOMINMAX
-DMOZILLA_VERSION="0.0"
-DJS_DEFAULT_JITREPORT_GRANULARITY=3
-DWINVER=0x601
-DPSAPI_VERSION=1
-D_USE_MATH_DEFINES
-DENABLE_TRACE_LOGGING
```

Include paths needed:
```
vendor/mozjs/src/js/src              # Main SM source
vendor/mozjs/src/js/src/assembler    # JIT assembler
vendor/mozjs/src/mfbt/src            # Mozilla foundation
vendor/mozjs/src/nsprpub/pr/include  # NSPR public headers
vendor/mozjs/src/intl/icu/source/common
vendor/mozjs/src/intl/icu/source/i18n
vendor/mozjs/src/mozglue/src         # Glue
vendor/mozjs/src/modules/zlib/src    # zlib
<build-dir>                          # For generated js-config.h
```

### 3. Generate js-config.h

Take `src/js/src/js-config.h.in` and create a concrete `js-config.h` with these settings:

```c
// js-config.h — generated for x86-windows-gnu
#ifndef JS_CONFIG_H
#define JS_CONFIG_H

#define JS_NUNBOX32 1
/* #undef JS_PUNBOX64 */
#define JS_CODEGEN_X86 1
/* #undef JS_CODEGEN_X64 */

/* #undef JS_DEBUG */
#define JS_GC_ZEAL 1
/* #undef JS_THREADSAFE */       // disable initially, simplifies build
/* #undef JS_HAS_CTYPES */
/* #undef JS_CRASH_DIAGNOSTICS */
/* #undef JS_GC_SMALL_CHUNK_SIZE */

#endif
```

Place in a generated include directory that's in the include path.

### 4. Fix NSPR threading for MinGW

Files in `src/nsprpub/pr/src/md/windows/` use `#ifdef _MSC_VER` guards around standard Win32 API calls. The APIs themselves (`CreateThread`, `WaitForSingleObject`, `InitializeCriticalSection`, `TlsAlloc`, etc.) work identically under MinGW.

**Fix:** Change `#ifdef _MSC_VER` to `#ifdef _WIN32` (or add `|| defined(__MINGW32__) || defined(__clang__)`) in these files:
- `w32poll.c`, `w32shm.c`, `w95thred.c`, `ntthread.c`, `w95cv.c`, `w95sock.c`
- Plus any others that fail to compile

### 5. Fix atomics header selection

In `src/js/src/jit/x86-shared/AtomicOperations-x86-shared.h` (or similar parent file):
- There's an `#ifdef _MSC_VER` that includes `AtomicOperations-x86-shared-msvc.h`
- The `#else` branch includes `AtomicOperations-x86-shared-gcc.h`
- Zig's clang should take the GCC path automatically (no `_MSC_VER` defined)
- **Verify this works.** If not, check that `__GNUC__` or `__clang__` is tested.

### 6. Fix MSVC intrinsics

Some files use MSVC intrinsics behind `_MSC_VER` guards:
- `_BitScanReverse` / `_BitScanForward` → clang has `__builtin_clz` / `__builtin_ctz`
- `_InterlockedCompareExchange` → clang has `__sync_val_compare_and_swap` or `__atomic_*`
- `__debugbreak()` → `__builtin_trap()` or `asm("int3")`
- `__assume(0)` → `__builtin_unreachable()`

Most of these already have `#else` branches for GCC/clang. If any don't, add them.

### 7. Self-hosted JS (selfhosted.out.h)

SpiderMonkey compiles JS builtins (Array.js, Promise.js, etc.) into a C header at build time.

**Check if pre-generated:** Look in `/Users/jaenster/code/CPP/d2bs2/out/build/` for `selfhosted.out.h`. If it exists, just copy it.

**If not pre-generated:** Need to run the embedjs.py script:
```sh
python src/js/src/builtin/embedjs.py \
  -DDEBUG \
  -p "clang -E" \       # preprocessor command
  -m src/js/src/js.msg \
  -o selfhosted.out.h \
  -s selfhosted.js \
  src/js/src/builtin/Array.js \
  src/js/src/builtin/Date.js \
  src/js/src/builtin/Promise.js \
  src/js/src/builtin/AsyncIteration.js \
  ... (all .js files listed in CMakeLists.txt)
```

The full list of self-hosted JS files is in `src/js/CMakeLists.txt` around lines 500+.

### 8. Disable jemalloc initially

Jemalloc may conflict with MinGW's allocator. Add `-DMOZ_MEMORY=0` to compile defs to use the system allocator. Re-enable later if needed.

### 9. Write sm_bridge.cpp

Thin `extern "C"` wrapper around SpiderMonkey's C++ API, same pattern as existing `v8_bridge.cpp`:

```cpp
// sm_bridge.cpp
#include "sm_bridge.h"
#include "jsapi.h"
#include "js/Initialization.h"
#include "js/CompilationAndEvaluation.h"

static JSRuntime* g_runtime = nullptr;

extern "C" {

int sm_init(void) {
    JS_Init();
    return 0;
}

void sm_shutdown(void) {
    JS_ShutDown();
}

void* sm_create_runtime(int heap_limit_mb) {
    JSRuntime* rt = JS_NewRuntime(heap_limit_mb * 1024 * 1024);
    JS_SetNativeStackQuota(rt, 500 * 1024);
    return rt;
}

void sm_destroy_runtime(void* rt) {
    JS_DestroyRuntime((JSRuntime*)rt);
}

void* sm_create_context(void* rt) {
    JSContext* cx = JS_NewContext((JSRuntime*)rt, 0x4000);
    // ... setup global object, options
    return cx;
}

void sm_destroy_context(void* cx) {
    JS_DestroyContext((JSContext*)cx);
}

int sm_eval(void* cx, const char* source, int source_len,
            char* result_buf, int result_buf_len) {
    // JS::Evaluate + convert result to string
    // Same pattern as v8_bridge.cpp
}

} // extern "C"
```

The existing `engine.zig` and `scripting.zig` need minimal changes — just swap `v8_bridge.h` for `sm_bridge.h` in the `@cImport`.

### 10. Link into Aether.dll

In `build.zig`:
```zig
if (enable_sm) {
    // Add all SpiderMonkey .cpp files
    aether.addCSourceFiles(.{
        .files = &sm_source_files,
        .flags = &.{ "-std=c++17", "-w", "-DSTATIC_JS_API", "-DXP_WIN", ... },
    });
    // Add include paths
    aether_mod.addIncludePath(b.path("vendor/mozjs/src/js/src"));
    // ... more include paths

    // Add bridge
    aether.addCSourceFiles(.{
        .files = &.{"src/sm/sm_bridge.cpp"},
        .flags = &.{ "-std=c++17", "-w" },
    });

    // Win32 libs needed by NSPR
    aether.linkSystemLibrary("ws2_32");
    aether.linkSystemLibrary("winmm");
    aether.linkSystemLibrary("advapi32");
    aether.linkSystemLibrary("psapi");
    aether.linkLibCpp();
}
```

## Key reference files
| File | What's in it |
|-|-|
| `d2bs2/vendor/mozjs/src/js/CMakeLists.txt` | Full .cpp file list + JS self-hosted file list |
| `d2bs2/vendor/mozjs/src/mfbt/CMakeLists.txt` | MFBT source list |
| `d2bs2/vendor/mozjs/src/nsprpub/CMakeLists.txt` | NSPR source list |
| `d2bs2/vendor/mozjs/src/intl/CMakeLists.txt` | ICU source list |
| `d2bs2/vendor/mozjs/src/memory/CMakeLists.txt` | jemalloc source list |
| `d2bs2/vendor/mozjs/src/modules/CMakeLists.txt` | zlib source list |
| `d2bs2/vendor/mozjs/src/mozglue/CMakeLists.txt` | mozglue source list |
| `d2bs2/vendor/mozjs/cmake/configure.cmake` | All platform defines |
| `d2bs2/vendor/mozjs/cmake/options.cmake` | Feature toggles |
| `d2bs2/vendor/mozjs/src/js/src/js-config.h.in` | Config template |

## Likely gotchas (in order of probability)

1. **selfhosted.out.h** — may need Python build step or pre-generated copy
2. **NSPR `_MSC_VER` guards** — straightforward but tedious patching
3. **jemalloc vs MinGW malloc** — disable jemalloc first
4. **Missing `#include <intrin.h>`** — some MSVC intrinsic uses behind `_MSC_VER` guards that clang won't enter; the `#else` branches should work but verify
5. **`/W0` → `-w`** — trivial but need to make sure no MSVC flags leak through
6. **`io.h` / `direct.h`** — MSVC-specific headers; MinGW provides them but paths may differ
7. **Wide string APIs** (`_wcsdup`, `_wcslwr_s`) — these are MSVC CRT extensions; MinGW has them but they might need `_POSIX_C_SOURCE` or `__MINGW32__` defines
