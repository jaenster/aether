# Aether

The unseen layer between you and Diablo II.

A QoL tool for Diablo II 1.14d written in Zig, with embedded Lua 5.4 scripting. Cross-compiles from any platform to x86 Windows.

[**Download latest release**](https://github.com/jaenster/aether/releases/latest)

## Features

- Map reveal with room boundaries and exit markers
- Teleport and walk pathfinding (A* with collision-aware reducers)
- POI discovery (waypoints, quest objects, seals, bosses)
- Farming route system with HUD overlay
- Item quality-of-life (name colors, filtering)
- Embedded Lua 5.4 scripting engine
- Console window for live log output
- Settings menu (F10) with persistent config

## Build

Requires [Zig 0.14+](https://ziglang.org/download/).

```
zig build -Doptimize=ReleaseSmall
```

Output: `zig-out/bin/Aether.dll` and `zig-out/bin/dbghelp.dll`

## Run

**Wine (macOS/Linux):**
```
GAME_DIR=~/path/to/diablo2 ./run.sh
```

**Windows:**
```
set GAME_DIR=C:\Games\Diablo II
run.cmd
```

Or manually: copy both DLLs to the game directory and launch `Game.exe -w`.

## Lua Scripting

Scripts live in `scripts/` and are copied to `<game_dir>/aether/scripts/` on launch. The entry point is `init.lua`.

```lua
aether.log("hello from lua")

function onTick()
    local x, y = aether.getPlayerPos()
    local level = aether.getPlayerLevel()
    local hp = aether.getPlayerHP()
    local maxhp = aether.getPlayerMaxHP()
end
```

## Known Issues

- **Zig `callconv(.Fastcall)` is broken on x86** — [ziglang/zig#10363](https://github.com/ziglang/zig/issues/10363). Zig generates incorrect code for `__fastcall` (ECX/EDX) on 32-bit targets. We work around this with inline asm wrappers that manually set ECX/EDX and push stack args. See `src/d2/functions.zig` for the comptime `fastcall()` generator and `src/fog_allocator.zig` for hand-written examples. If you add new game function bindings, never use `callconv(.Fastcall)` — use the inline asm pattern instead.

## Structure

```
src/
  aether.zig          -- DLL entry point
  d2/                 -- game types, functions, globals
  features/           -- auto_move, map_reveal, settings, etc.
  hook/               -- game hook framework
  lua/                -- Lua engine + game loop binding
  pathing/            -- A*, teleport/walk reducers, POI, routes
vendor/lua-5.4.7/     -- Lua source (compiled by Zig)
scripts/              -- Lua scripts
```
