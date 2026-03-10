#!/bin/bash
set -e

cd "$(dirname "$0")"
SCRIPT_DIR="$(pwd)"
if [ -z "$GAME_DIR" ]; then
    echo "Set GAME_DIR to your Diablo II install directory"
    echo "  export GAME_DIR=~/path/to/diablo2"
    exit 1
fi
DLL_WINE_PATH="Z:$(echo "$SCRIPT_DIR/zig-out/bin/Aether.dll" | tr '/' '\\')"

# Build
zig build -Doptimize=ReleaseSmall

# Kill previous Wine Game.exe (avoid killing Ghidra workers that also match Game.exe)
pkill -9 -f "wine.*Game.exe" 2>/dev/null || true
wineserver --kill 2>/dev/null || true
sleep 2

# Clear log
rm -f "$GAME_DIR/aether_log.txt"

# Copy DLLs
cp "$SCRIPT_DIR/zig-out/bin/dbghelp.dll" "$GAME_DIR/"
cp "$SCRIPT_DIR/../spidermonkey/build-mingw/dll/mozjs.dll" "$GAME_DIR/"
cp /opt/homebrew/Cellar/mingw-w64/13.0.0_2/toolchain-i686/i686-w64-mingw32/bin/libwinpthread-1.dll "$GAME_DIR/" 2>/dev/null || true

# Auto-detect headless when using minimal install (marker file)
EXTRA_FLAGS=""
if [ -f "$GAME_DIR/.minimal" ]; then
    EXTRA_FLAGS="--headless"
    echo "Auto-detected minimal install, enabling --headless"
fi

# Daemon connection — auto-set if daemon is running on default port
if [ -z "$AETHER_DAEMON" ]; then
    if nc -z 127.0.0.1 13119 2>/dev/null; then
        export AETHER_DAEMON="127.0.0.1:13119"
        echo "Auto-detected daemon on $AETHER_DAEMON"
    fi
fi

# Launch — pass through extra flags (e.g. -spawn for spawn capture, --headless)
cd "$GAME_DIR"
WINEDLLOVERRIDES="dbghelp=n" wine Game.exe -w -ns -loaddll "$DLL_WINE_PATH" $EXTRA_FLAGS "$@" > /dev/null 2>&1 &

# Wait and show log
sleep 5
echo "=== aether_log.txt ==="
cat "$GAME_DIR/aether_log.txt" 2>/dev/null || echo "(no log)"
echo ""
if pgrep -f "Game.exe" > /dev/null; then
    echo "Game: RUNNING"
else
    echo "Game: DEAD"
fi
