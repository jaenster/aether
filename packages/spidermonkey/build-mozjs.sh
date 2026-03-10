#!/bin/sh
# Build SpiderMonkey as a static library for x86-windows-gnu.
# Uses zig cc as a cross-compiler (drop-in clang with bundled sysroot).
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"

cmake -S "$SCRIPT_DIR" -B "$BUILD_DIR" \
  -DCMAKE_SYSTEM_NAME=Windows \
  -DCMAKE_C_COMPILER="$SCRIPT_DIR/zig-cc" \
  -DCMAKE_CXX_COMPILER="$SCRIPT_DIR/zig-c++" \
  -DCMAKE_AR="$SCRIPT_DIR/zig-ar" \
  -DCMAKE_RANLIB="$SCRIPT_DIR/zig-ranlib" \
  -DCMAKE_SIZEOF_VOID_P=4 \
  -DMOZJS_STATIC_LIB=ON \
  -DMOZJS_ENABLE_ION=ON \
  -DMOZJS_SM_PROMISE=ON \
  -DMOZJS_THREADSAFE=OFF \
  -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DCMAKE_C_FLAGS_INIT="-fno-zero-initialized-in-bss" \
  -DCMAKE_CXX_FLAGS_INIT="-fno-zero-initialized-in-bss" \
  "$@"

cmake --build "$BUILD_DIR" -j "$(nproc 2>/dev/null || sysctl -n hw.ncpu)"

echo ""
echo "Built:"
find "$BUILD_DIR" -name "*.a" -o -name "*.lib" | head -20
echo ""
echo "Include headers exported to: $BUILD_DIR/include"
