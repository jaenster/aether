const std = @import("std");
const log = @import("../log.zig");
const fog = @import("../fog_allocator.zig");
const D2PoolManagerStrc = @import("../d2/types.zig").D2PoolManagerStrc;

const c = @cImport({
    @cInclude("lua.h");
    @cInclude("lualib.h");
    @cInclude("lauxlib.h");
});

pub const LuaState = *c.lua_State;

var L: ?LuaState = null;
var lua_alloc_count: u32 = 0;
var lua_free_count: u32 = 0;
var using_fog_pool: bool = false;

fn fogLuaAlloc(ud: ?*anyopaque, ptr: ?*anyopaque, _: usize, nsize: usize) callconv(.c) ?*anyopaque {
    const pool: *D2PoolManagerStrc = @ptrCast(@alignCast(ud orelse return null));
    const old_ptr: ?[*]u8 = if (ptr) |p| @ptrCast(p) else null;

    if (nsize == 0) {
        // free
        if (old_ptr) |p| {
            var freeable: ?[*]u8 = p;
            fog.pool_free(pool, &freeable, "Lua", 0);
            lua_free_count += 1;
        }
        return null;
    }

    // alloc or realloc
    const result = fog.pool_realloc(pool, old_ptr, nsize, "Lua", 0);
    if (result != null) lua_alloc_count += 1;
    return @ptrCast(result);
}

fn luaPanic(state: ?*c.lua_State) callconv(.c) c_int {
    const s = state orelse return 0;
    const msg = c.lua_tolstring(s, -1, null);
    if (msg) |m| {
        log.printStr("lua: PANIC: ", std.mem.span(m));
    } else {
        log.print("lua: PANIC (no message)");
    }
    return 0;
}

pub fn init() void {
    log.print("lua: creating state");
    L = c.lua_newstate(defaultAlloc, null);
    if (L == null) {
        log.print("lua: newstate returned null");
        return;
    }
    log.print("lua: state created, setting panic");
    _ = c.lua_atpanic(L.?, luaPanic);
    log.print("lua: opening libs");
    c.luaL_openlibs(L.?);
    registerAPI(L.?);
    log.print("lua: initialized");
    _ = loadScript("aether\\scripts\\init.lua");
}

extern "kernel32" fn GetProcessHeap() callconv(.winapi) ?*anyopaque;
extern "kernel32" fn HeapAlloc(heap: *anyopaque, flags: u32, size: usize) callconv(.winapi) ?*anyopaque;
extern "kernel32" fn HeapReAlloc(heap: *anyopaque, flags: u32, ptr: *anyopaque, size: usize) callconv(.winapi) ?*anyopaque;
extern "kernel32" fn HeapFree(heap: *anyopaque, flags: u32, ptr: *anyopaque) callconv(.winapi) i32;

fn defaultAlloc(_: ?*anyopaque, ptr: ?*anyopaque, _: usize, nsize: usize) callconv(.c) ?*anyopaque {
    const heap = GetProcessHeap() orelse return null;
    if (nsize == 0) {
        if (ptr) |p| _ = HeapFree(heap, 0, p);
        return null;
    }
    if (ptr) |p| {
        return HeapReAlloc(heap, 0, p, nsize);
    }
    return HeapAlloc(heap, 0, nsize);
}

/// Swap Lua to use a FOG memory pool. Call once the game's memory system is ready.
pub fn attachPool(pool: *D2PoolManagerStrc) void {
    const state = L orelse return;
    if (using_fog_pool) return;
    c.lua_setallocf(state, fogLuaAlloc, @ptrCast(@alignCast(pool)));
    using_fog_pool = true;
    lua_alloc_count = 0;
    lua_free_count = 0;
    log.print("lua: switched to FOG pool allocator");
}

pub fn deinit() void {
    if (L) |state| {
        c.lua_close(state);
        L = null;
    }
}

pub fn getState() ?LuaState {
    return L;
}

pub fn loadScript(path: [*:0]const u8) bool {
    const state = L orelse return false;
    if (c.luaL_loadfilex(state, path, null) != 0) {
        const err = c.lua_tolstring(state, -1, null);
        if (err) |msg| {
            log.printStr("lua: load error: ", std.mem.span(msg));
        }
        c.lua_settop(state, -2); // pop error
        return false;
    }
    if (c.lua_pcallk(state, 0, c.LUA_MULTRET, 0, 0, null) != 0) {
        const err = c.lua_tolstring(state, -1, null);
        if (err) |msg| {
            log.printStr("lua: runtime error: ", std.mem.span(msg));
        }
        c.lua_settop(state, -2); // pop error
        return false;
    }
    return true;
}

// Called each game loop tick
pub fn tick() void {
    callGlobal("onTick");
}

// Called each OOG (out-of-game) loop tick
pub fn oogTick() void {
    callGlobal("onOogTick");
}

// Call a global Lua function by name, no args, no returns
pub fn callGlobal(name: [*:0]const u8) void {
    const state = L orelse return;
    _ = c.lua_getglobal(state, name);
    if (c.lua_type(state, -1) != c.LUA_TFUNCTION) {
        c.lua_settop(state, -2); // pop non-function
        return;
    }
    if (c.lua_pcallk(state, 0, 0, 0, 0, null) != 0) {
        const err = c.lua_tolstring(state, -1, null);
        if (err) |msg| {
            log.printStr("lua: call error: ", std.mem.span(msg));
        }
        c.lua_settop(state, -2);
    }
}

// ============================================================================
// API exposed to Lua as `aether.*`
// ============================================================================

const d2 = struct {
    const functions = @import("../d2/functions.zig");
    const globals = @import("../d2/globals.zig");
    const types = @import("../d2/types.zig");
};

fn registerAPI(state: LuaState) void {
    c.lua_createtable(state, 0, 16);

    setFunc(state, "log", luaLog);
    setFunc(state, "getPlayerPos", luaGetPlayerPos);
    setFunc(state, "getPlayerLevel", luaGetPlayerLevel);
    setFunc(state, "getPlayerHP", luaGetPlayerHP);
    setFunc(state, "getPlayerMaxHP", luaGetPlayerMaxHP);
    setFunc(state, "getAllocStats", luaGetAllocStats);
    setFunc(state, "isInGame", luaIsInGame);

    c.lua_setglobal(state, "aether");
}

fn setFunc(state: LuaState, name: [*:0]const u8, func: c.lua_CFunction) void {
    c.lua_pushcclosure(state, func, 0);
    c.lua_setfield(state, -2, name);
}

// aether.log(msg)
fn luaLog(state: ?*c.lua_State) callconv(.c) c_int {
    const s = state orelse return 0;
    const msg = c.lua_tolstring(s, 1, null);
    if (msg) |m| {
        log.printStr("lua: ", std.mem.span(m));
    }
    return 0;
}

// aether.getPlayerPos() -> x, y
fn luaGetPlayerPos(state: ?*c.lua_State) callconv(.c) c_int {
    const s = state orelse return 0;
    const player = (d2.globals.playerUnit().* orelse return pushNil2(s));
    const path = player.pPath orelse return pushNil2(s);
    c.lua_pushinteger(s, @intCast(path.xPos));
    c.lua_pushinteger(s, @intCast(path.yPos));
    return 2;
}

// aether.getPlayerLevel() -> level_no
fn luaGetPlayerLevel(state: ?*c.lua_State) callconv(.c) c_int {
    const s = state orelse return 0;
    const player = (d2.globals.playerUnit().* orelse return pushNil1(s));
    const path = player.pPath orelse return pushNil1(s);
    const room1 = path.pRoom1 orelse return pushNil1(s);
    const room2 = room1.pRoom2 orelse return pushNil1(s);
    const lvl = room2.pLevel orelse return pushNil1(s);
    c.lua_pushinteger(s, @intCast(lvl.dwLevelNo));
    return 1;
}

// aether.getPlayerHP() -> current_hp
fn luaGetPlayerHP(state: ?*c.lua_State) callconv(.c) c_int {
    const s = state orelse return 0;
    const player = (d2.globals.playerUnit().* orelse return pushNil1(s));
    const hp = d2.functions.GetUnitStat.call(player, 6, 0); // stat 6 = hitpoints
    c.lua_pushinteger(s, @intCast(hp >> 8)); // fixed point: >> 8
    return 1;
}

// aether.getPlayerMaxHP() -> max_hp
fn luaGetPlayerMaxHP(state: ?*c.lua_State) callconv(.c) c_int {
    const s = state orelse return 0;
    const player = (d2.globals.playerUnit().* orelse return pushNil1(s));
    const hp = d2.functions.GetUnitStat.call(player, 7, 0); // stat 7 = maxhitpoints
    c.lua_pushinteger(s, @intCast(hp >> 8));
    return 1;
}

// aether.getAllocStats() -> allocs, frees, using_fog
fn luaGetAllocStats(state: ?*c.lua_State) callconv(.c) c_int {
    const s = state orelse return 0;
    c.lua_pushinteger(s, @intCast(lua_alloc_count));
    c.lua_pushinteger(s, @intCast(lua_free_count));
    c.lua_pushboolean(s, @intFromBool(using_fog_pool));
    return 3;
}

// aether.isInGame() -> bool
fn luaIsInGame(state: ?*c.lua_State) callconv(.c) c_int {
    const s = state orelse return 0;
    const player = d2.globals.playerUnit().*;
    c.lua_pushboolean(s, @intFromBool(player != null));
    return 1;
}

fn pushNil1(s: *c.lua_State) c_int {
    c.lua_pushnil(s);
    return 1;
}

fn pushNil2(s: *c.lua_State) c_int {
    c.lua_pushnil(s);
    c.lua_pushnil(s);
    return 2;
}
