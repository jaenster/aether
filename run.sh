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

# Kill previous instance
pkill -9 -f "start.exe.*Game.exe" 2>/dev/null || true
pkill -9 -f '\\Game.exe' 2>/dev/null || true
wineserver --kill 2>/dev/null || true
sleep 2

# Clear log
rm -f "$GAME_DIR/aether_log.txt"

# Copy Lua scripts
mkdir -p "$GAME_DIR/aether/scripts"
cp -r "$SCRIPT_DIR/scripts/"*.lua "$GAME_DIR/aether/scripts/" 2>/dev/null || true

# Launch
cd "$GAME_DIR"
WINEDLLOVERRIDES="dbghelp=n" wine Game.exe -w -loaddll "$DLL_WINE_PATH" > /dev/null 2>&1 &

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
