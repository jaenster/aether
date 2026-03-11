# Aether — Linux Build & Install Guide

This guide covers building and running Aether on Linux, including cross-compiling
the native DLLs (SpiderMonkey + Aether.dll) for Windows/Wine.

## Prerequisites

### System packages

```bash
sudo apt update
sudo apt install -y \
  cmake make \
  mingw-w64 g++-mingw-w64-i686 \
  wine32 wine \
  xvfb \
  python3
```

### Zig 0.15.2

Download from https://ziglang.org/download/ (linux-x86_64):

```bash
wget https://ziglang.org/builds/zig-linux-x86_64-0.15.2.tar.xz
tar xf zig-linux-x86_64-0.15.2.tar.xz
export PATH="$PWD/zig-linux-x86_64-0.15.2:$PATH"
zig version  # should print 0.15.2
```

### Node.js & pnpm

```bash
# Node 22+
node --version

# pnpm 10+
npm install -g pnpm
pnpm install   # from repo root
```

## 1. Build SpiderMonkey (mozjs.dll)

SpiderMonkey 60 is cross-compiled with MinGW for 32-bit Windows.

```bash
cd packages/spidermonkey

# Create build directory for MinGW cross-compilation
mkdir -p build-mingw && cd build-mingw

cmake .. \
  -DCMAKE_SYSTEM_NAME=Windows \
  -DCMAKE_C_COMPILER=/usr/bin/i686-w64-mingw32-gcc \
  -DCMAKE_CXX_COMPILER=/usr/bin/i686-w64-mingw32-g++

make -j$(nproc)
```

### Case-sensitivity fix

Linux filesystems are case-sensitive, but the SM source has a case mismatch:

```bash
# The generated header is "unused.h" but source includes "mozilla/Unused.h"
cd build-mingw/include/mozilla
ln -sf unused.h Unused.h
```

Then re-run `make -j$(nproc)` if needed.

### 32-bit JIT allocation fix

If you see "SM init failed" with a 1GB VirtualAlloc OOM, edit
`packages/spidermonkey/src/js/src/jit/ProcessExecutableMemory.h`:

Replace the `JS_BITS_PER_WORD` guard with `__SIZEOF_POINTER__`:

```cpp
// Before:
#if JS_BITS_PER_WORD == 32
// After:
#if defined(__SIZEOF_POINTER__) && __SIZEOF_POINTER__ == 4
```

This fixes the case where `JS_BITS_PER_WORD` is not yet defined when the
header is included during cross-compilation.

The built DLL is at `build-mingw/dll/mozjs.dll`.

## 2. Build Aether.dll

```bash
cd packages/native
zig build -Doptimize=ReleaseFast
```

Output: `packages/native/zig-out/bin/Aether.dll` and `dbghelp.dll`.

## 3. Build the daemon

```bash
cd packages/daemon
pnpm install
npm run build
```

## 4. Set up Wine prefix

```bash
export WINEPREFIX=/tmp/d2wine
export WINEARCH=win32
wineboot --init
```

## 5. Set up the minimal game directory

The minimal game directory (`packages/native/minimal/`) needs:

- `Game.exe` — Diablo II 1.14d executable
- `mozjs.dll` — from SpiderMonkey build
- `Aether.dll`, `dbghelp.dll` — from Zig build
- MPQ data files (`Patch_D2.mpq`, `d2data.mpq`, etc.)
- `save/` directory with `.d2s` character files

Copy the built DLLs:

```bash
cp packages/spidermonkey/build-mingw/dll/mozjs.dll packages/native/minimal/
cp packages/native/zig-out/bin/Aether.dll packages/native/minimal/
cp packages/native/zig-out/bin/dbghelp.dll packages/native/minimal/
```

### Character saves

D2 1.14d reads saves from the Wine user profile:

```bash
SAVE_DIR="$WINEPREFIX/drive_c/users/$(whoami)/Saved Games/Diablo II"
mkdir -p "$SAVE_DIR"
cp packages/native/minimal/save/*.d2s "$SAVE_DIR/"
```

## 6. Running

### Start Xvfb (headless display)

```bash
Xvfb :99 -screen 0 800x600x24 &
```

### Start the daemon

Normal mode:
```bash
cd packages/daemon
node dist/index.js
```

Test mode (serves test suite instead of main bot):
```bash
node dist/index.js --tests
```

### Launch the game

```bash
cd packages/native/minimal

export WINEPREFIX=/tmp/d2wine
export WINEARCH=win32
export AETHER_DAEMON=127.0.0.1:13119
export AETHER_ENTRY=main.ts

DLL_WINE_PATH="Z:\home\user\aether\packages\native\zig-out\bin\Aether.dll"

DISPLAY=:99 WINEDLLOVERRIDES="dbghelp=n" \
  wine Game.exe -w -nosound --headless -loaddll "$DLL_WINE_PATH"
```

The game will connect to the daemon, load modules, and either run the bot
or the test suite depending on daemon mode.

### Check output

The game writes logs to `packages/native/minimal/aether_log.txt`.

Test output looks like:

```
=== Test Run: 4 tests ===
[RUN]  character is in game
[PASS] character is in game
[RUN]  character has valid stats
[PASS] character has valid stats
[RUN]  character name is EpicSorc
[PASS] character name is EpicSorc
[RUN]  can read area exits
[PASS] can read area exits
=== Results: 4/4 passed, 0 failed ===
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `AETHER_DAEMON not set` | Set the env var before launching wine |
| `AETHER_ENTRY not set` | Set to `main.ts` |
| `no characters found` | Copy .d2s files to Wine Saved Games dir |
| `SM init failed` (1GB alloc) | Apply the `__SIZEOF_POINTER__` fix above |
| Wine "no driver" / display errors | Start Xvfb first, set `DISPLAY=:99` |
| `Cannot resolve module 'diablo:test'` | Rebuild daemon (`npm run build`) |
