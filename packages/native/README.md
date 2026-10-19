# Aether

The unseen layer between you and Diablo II.

A QoL tool for Diablo II 1.14d written in Zig, with embedded Lua 5.4 scripting. Cross-compiles from any platform to x86 Windows.

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

Requires [Zig 0.16](https://ziglang.org/download/).

```
zig build -Doptimize=ReleaseSmall
```

Output: `zig-out/bin/Aether.dll`, `zig-out/bin/dbghelp.dll` and `zig-out/bin/AetherEmbed.dll`.

`zig build test` runs the unit tests and `tools/embed_check.zig`.

## Embedding

`src/embed.zig` runs the same script engine inside a host that owns the process (its own `DllMain`, hook sites,
crash handler and log). On that path Aether patches nothing, allocates no console and writes no log file;
`embed_check` fails the build if anything it imports reaches `hook/`, `features/` or `feature.zig`.

- The host loads `mozjs.dll` itself and passes the module to `init`. The 31 bridge functions of
  `src/sm/sm_bridge.h` are resolved from it into a table (`src/sm/bridge.zig`), so the host never imports
  `mozjs.dll` at link time. A missing export leaves Aether off with a log line.
- The host calls the callouts from its own sites, on the game thread: `tick(in_game)` once per frame,
  `packetIn(bytes, size)` for each server packet with its real size before the game handles it,
  `packetOut(bytes, size)` before each sent packet, `drawGame()`, `drawAutomap()`, `drawOog()`, and `shutdown()`.
- Log lines go to the host's sink. A script's screenshot request goes to the host's `screenshot` function.
- Scripts register sent packets with `registerPacketOutHook(opcode)` and get `__onPacketOut(opcode)`.

A Zig host imports `src/embed.zig` as a module. Any other host loads `AetherEmbed.dll`, which exports the same
callouts as `aether_init`, `aether_tick`, `aether_packet_in`, `aether_packet_out`, `aether_draw_game`,
`aether_draw_automap`, `aether_draw_oog` and `aether_shutdown`.

The injector (`Aether.dll` with `dbghelp.dll`) fills the same table from `mozjs.dll`'s import library and works as
before.

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
