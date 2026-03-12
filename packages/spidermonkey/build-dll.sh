#!/bin/bash
# Build mozjs.dll — SM60 compiled entirely with MinGW g++ (i686).
# This solves two Zig linker issues:
#   1. .ctors run on DLL load → JIT VMFunction linked list gets built
#   2. No .bss misplacement of pointer-initialized const data
#
# Prerequisites: brew install mingw-w64
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build-mingw"
BRIDGE_SRC="$SCRIPT_DIR/../native/src/sm/sm_bridge.cpp"

GCC=/opt/homebrew/bin/i686-w64-mingw32-gcc
GXX=/opt/homebrew/bin/i686-w64-mingw32-g++
AR=/opt/homebrew/bin/i686-w64-mingw32-ar
RANLIB=/opt/homebrew/bin/i686-w64-mingw32-ranlib

if ! command -v "$GXX" &>/dev/null; then
    echo "Missing MinGW g++ — install with: brew install mingw-w64"
    exit 1
fi

echo "=== Building SM60 with MinGW g++ (i686-w64-mingw32) ==="

# Step 1: CMake configure with MinGW compilers
# GCC 15 made -Wincompatible-pointer-types an error. Old C code (NSPR) needs relaxation.
cmake -S "$SCRIPT_DIR" -B "$BUILD_DIR" \
  -DCMAKE_SYSTEM_NAME=Windows \
  -DCMAKE_C_COMPILER="$GCC" \
  -DCMAKE_CXX_COMPILER="$GXX" \
  -DCMAKE_AR="$AR" \
  -DCMAKE_RANLIB="$RANLIB" \
  -DCMAKE_SIZEOF_VOID_P=4 \
  -DMOZJS_STATIC_LIB=ON \
  -DMOZJS_ENABLE_ION=ON \
  -DMOZJS_SM_PROMISE=ON \
  -DMOZJS_THREADSAFE=OFF \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_FLAGS_INIT="-std=gnu11 -Wno-incompatible-pointer-types -Wno-int-conversion" \
  -DCMAKE_CXX_FLAGS_INIT="-Wno-deprecated" \
  "$@"

# Step 2: Build static libs
NJOBS="$(nproc 2>/dev/null || sysctl -n hw.ncpu)"
cmake --build "$BUILD_DIR" -j "$NJOBS"

# Step 3: Compile sm_bridge.cpp
echo ""
echo "=== Compiling sm_bridge.cpp ==="
$GXX -c -O2 -std=c++17 \
    -DWIN32 -D_WIN32 -DXP_WIN \
    -DSTATIC_JS_API -DIMPL_MFBT \
    -DJS_CODEGEN_X86 -DJS_CPU_X86 -DJS_NUNBOX32 \
    -DJSGC_INCREMENTAL -DNOMINMAX \
    -DMOZJS_DLL_BUILD \
    -I"$BUILD_DIR/include" \
    -I"$SCRIPT_DIR/generated" \
    -I"$SCRIPT_DIR/src/js/src" \
    -I"$SCRIPT_DIR/src/js/public" \
    -I"$SCRIPT_DIR/src/mfbt/src" \
    -I"$SCRIPT_DIR/src/nsprpub/pr/include" \
    -I"$SCRIPT_DIR/src/memory/mozalloc" \
    -I"$SCRIPT_DIR/../native/src/sm" \
    -o "$BUILD_DIR/sm_bridge.o" \
    "$BRIDGE_SRC"

# Step 4: Link mozjs.dll
echo "=== Linking mozjs.dll ==="
# Only libjs.a needs --whole-archive (to include .ctors for JIT VMFunction init).
# Other libs use normal linking to avoid pulling in unused NSPR thread code.
WHOLE_ARCHIVE_LIBS=(
    "$BUILD_DIR/src/js/libjs.a"
)
NORMAL_LIBS=(
    "$BUILD_DIR/src/mfbt/libmfbt.a"
    "$BUILD_DIR/src/mozglue/misc/libmozglue.a"
    "$BUILD_DIR/src/memory/mozalloc/libmozalloc.a"
    "$BUILD_DIR/src/memory/build/libmozmemory.a"
    "$BUILD_DIR/src/nsprpub/pr/libnspr.a"
    "$BUILD_DIR/src/nsprpub/lib/libc/liblibc.a"
    "$BUILD_DIR/src/modules/zlib/libzlib.a"
    "$BUILD_DIR/src/modules/fdlibm/libfdlibm.a"
)

mkdir -p "$BUILD_DIR/dll"

# Create a local lib dir where we shadow the dynamic winpthread with the static one
# This tricks g++'s default -lpthread into finding the static archive first
SHADOW_LIB="$BUILD_DIR/shadow-lib"
mkdir -p "$SHADOW_LIB"
cp "$($GXX -print-file-name=libwinpthread.a)" "$SHADOW_LIB/libpthread.a"
cp "$($GXX -print-file-name=libwinpthread.a)" "$SHADOW_LIB/libwinpthread.a"
# Remove any dynamic import lib copies
rm -f "$SHADOW_LIB/libpthread.dll.a" "$SHADOW_LIB/libwinpthread.dll.a"

$GXX -shared -o "$BUILD_DIR/dll/mozjs.dll" \
    "$BUILD_DIR/sm_bridge.o" \
    -Wl,--whole-archive "${WHOLE_ARCHIVE_LIBS[@]}" -Wl,--no-whole-archive \
    "${NORMAL_LIBS[@]}" \
    -lws2_32 -lwinmm -ladvapi32 -lpsapi -lmswsock -lkernel32 -ldbghelp \
    -static-libgcc -static-libstdc++ \
    -L"$SHADOW_LIB" \
    -Wl,--out-implib,"$BUILD_DIR/dll/libmozjs.dll.a" \
    -Wl,--enable-stdcall-fixup

# Strip debug symbols (11MB vs 1.1GB)
i686-w64-mingw32-strip "$BUILD_DIR/dll/mozjs.dll"

echo ""
echo "=== Built ==="
ls -lh "$BUILD_DIR/dll/mozjs.dll" "$BUILD_DIR/dll/libmozjs.dll.a"
echo ""
echo "Deploy: copy mozjs.dll to game directory"
echo "Link:   $BUILD_DIR/dll/libmozjs.dll.a"
