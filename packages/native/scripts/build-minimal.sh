#!/bin/bash
# build-minimal.sh — Build a minimal D2 1.14d install from a full install.
# Usage: ./build-minimal.sh <source-dir> <dest-dir>
# Example: ./build-minimal.sh ~/Documents/d2/114Clean ~/Documents/d2/minimal
set -e

if [ $# -ne 2 ]; then
    echo "Usage: $0 <source-dir> <dest-dir>"
    echo "  source-dir: full D2 1.14d install"
    echo "  dest-dir:   output directory for minimal install"
    exit 1
fi

SRC="$1"
DST="$2"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOL="$SCRIPT_DIR/rebuild-mpqs"

# Verify source
if [ ! -f "$SRC/Game.exe" ]; then
    echo "Error: $SRC/Game.exe not found"
    exit 1
fi

# Build the MPQ tool if needed
if [ ! -f "$TOOL" ] || [ "$SCRIPT_DIR/rebuild-mpqs.c" -nt "$TOOL" ]; then
    echo "Building rebuild-mpqs tool..."
    cc -o "$TOOL" "$SCRIPT_DIR/rebuild-mpqs.c" \
        -I/opt/homebrew/include -L/opt/homebrew/lib -lstorm \
        -O2
fi

# Create dest dir
mkdir -p "$DST"

# Rebuild MPQs
echo "=== Rebuilding MPQs ==="
"$TOOL" "$SRC" "$DST"

# Copy Game.exe and required DLLs
echo ""
echo "Copying Game.exe as minimal.exe and dependencies..."
cp "$SRC/Game.exe" "$DST/minimal.exe"
for dll in binkw32.dll SmackW32.dll ijl11.dll D2.LNG; do
    if [ -f "$SRC/$dll" ]; then
        cp "$SRC/$dll" "$DST/$dll"
    else
        echo "Warning: $dll not found in source"
    fi
done

# Copy dbghelp.dll proxy from build output
DLLINJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
if [ -f "$DLLINJECT_DIR/zig-out/bin/dbghelp.dll" ]; then
    cp "$DLLINJECT_DIR/zig-out/bin/dbghelp.dll" "$DST/dbghelp.dll"
    echo "Copied dbghelp.dll proxy from build output"
elif [ -f "$SRC/dbghelp.dll" ]; then
    cp "$SRC/dbghelp.dll" "$DST/dbghelp.dll"
    echo "Copied dbghelp.dll from source (may be stale)"
fi

echo ""
echo "=== Result ==="
du -sh "$DST"
echo ""
ls -lh "$DST"
