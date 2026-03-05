const std = @import("std");
const feature = @import("../feature.zig");
const async_ = @import("../async.zig");
const act_map = @import("../pathing/act_map.zig");
const teleport_reducer = @import("../pathing/teleport_reducer.zig");
const walk_reducer = @import("../pathing/walk_reducer.zig");
const astar = @import("../pathing/astar.zig");
const poi = @import("../pathing/poi.zig");
const routes = @import("../pathing/routes.zig");
const log = @import("../log.zig");
const symbols = @import("../symbols.zig");
const settings = @import("settings.zig");
const patch = @import("../hook/patch.zig");
const trampoline = @import("../hook/trampoline.zig");
const d2 = struct {
    const functions = @import("../d2/functions.zig");
    const globals = @import("../d2/globals.zig");
    const types = @import("../d2/types.zig");
    const automap = @import("../d2/automap.zig");
};

const TELEPORT_SKILL_ID: u16 = 54;
// TP_RANGE is our pathfinding step size. The server validates teleport targets via
// DRLGROOM_FindBetterNearbyRoom (current room + 1-hop neighbours only).
// In tight dungeons (WSK, Durance) rooms are ~15-20 tiles wide, so 40 tiles can
// span 2-3 rooms — beyond what the server allows. 20 tiles safely stays within
// current + adjacent room in all level types.
const TP_RANGE: u32 = 40;

const Mode = enum { none, teleport, walk };

var mode: Mode = .none;
var current_wp: u32 = 0;
var saved_right_skill: u16 = 0;
var dest_x: i32 = 0;
var dest_y: i32 = 0;

// Exit state — N/P are hardcoded to specific exits (next=deeper, prev=toward town)
var scanned_level: u32 = 0;
const MAX_EXITS = 32;
var cached_exits: [MAX_EXITS]act_map.Exit = undefined;
var cached_exit_count: u32 = 0;
var next_exit_idx: ?u8 = null; // exit with highest target level (N key)
var prev_exit_idx: ?u8 = null; // exit with lowest target level (P key)

// POI state
var poi_index: u8 = 0;
var poi_scanned_level: u32 = 0;

// HUD labels — track what N/P/G would target
var hud_n_label: [64]u16 = undefined;
var hud_n_len: usize = 0;
var hud_p_label: [64]u16 = undefined;
var hud_p_len: usize = 0;
var hud_g_label: [64]u16 = undefined;
var hud_g_len: usize = 0;

// Snapshot of the active path for drawing (persists after move completes)
const MAX_DRAW_WPS = 256;
var draw_wps: [MAX_DRAW_WPS]astar.Point = undefined;
var draw_wp_count: u32 = 0;
var draw_dest_x: i32 = 0;
var draw_dest_y: i32 = 0;
var draw_current_wp: u32 = 0;
var show_path: bool = false;
var draw_start_x: f64 = 0;
var draw_start_y: f64 = 0;

// Live waypoint source (teleport or walk reducer)
var active_waypoints: []const astar.Point = &.{};
var active_waypoint_count: *u32 = undefined;

// ============================================================================
// SUNIT_RelocateUnit hook — trace teleport success/failure
// ============================================================================

const RELOCATE_ADDR: usize = 0x554ea0;
const RELOCATE_HOOK_SIZE: usize = 6; // 55 8B EC 83 EC 30

var relocate_trampoline_addr: usize = 0;
var relocate_last_x: i32 = 0;
var relocate_last_y: i32 = 0;

// Naked thunk: preserves the exact __fastcall stack layout.
// ECX=pGame, EDX=pUnit, stack: [ret] [pRoom] [nX] [nY] [nParam1] [nParam2]
fn hookRelocateUnit() callconv(.naked) void {
    asm volatile (
    // Save fastcall regs
        \\ push %%ecx
        \\ push %%edx
        // Save nX, nY for later (from original stack: +8=ret, +12=pRoom, +16=nX, +20=nY)
        // After 2 pushes, offsets shift by +8
        \\ mov 24(%%esp), %%eax
        \\ mov %%eax, %[last_x]
        \\ mov 28(%%esp), %%eax
        \\ mov %%eax, %[last_y]
        // Restore fastcall regs
        \\ pop %%edx
        \\ pop %%ecx
        // Push all 5 stack args for trampoline call
        \\ push 24(%%esp)
        \\ push 24(%%esp)
        \\ push 24(%%esp)
        \\ push 24(%%esp)
        \\ push 24(%%esp)
        // Call trampoline (it does RET 0x14, cleaning these 5 args)
        \\ call *%[trampoline]
        // EAX = result. Check for failure.
        \\ test %%eax, %%eax
        \\ jnz 1f
        // Failed — call log function (preserving EAX)
        \\ push %%eax
        \\ mov %[fail_fn], %%eax
        \\ call *%%eax
        \\ pop %%eax
        // Return to original caller, cleaning 5 stack args (0x14 = 20 bytes)
        \\ 1: ret $0x14
        :
        : [trampoline] "m" (relocate_trampoline_addr),
          [last_x] "m" (relocate_last_x),
          [last_y] "m" (relocate_last_y),
          [fail_fn] "i" (&relocateFailLog),
    );
}

fn relocateFailLog() callconv(.c) void {
    log.print("RELOCATE FAILED:");
    log.hex("  nX=", @as(u32, @bitCast(relocate_last_x)));
    log.hex("  nY=", @as(u32, @bitCast(relocate_last_y)));
    logStackTrace();
}

fn logStackTrace() void {
    log.print("  stack:");
    var ebp: usize = asm ("mov %%ebp, %[ebp]"
        : [ebp] "=r" (-> usize),
    );
    var depth: u32 = 0;
    while (ebp != 0 and depth < 12) : (depth += 1) {
        if (ebp < 0x10000 or ebp > 0x7FFFFFFF) break;
        const frame: [*]const usize = @ptrFromInt(ebp);
        const ret_addr = frame[1];
        if (ret_addr == 0) break;
        if (symbols.lookup(@intCast(ret_addr))) |sym| {
            log.printStr("    ", sym.name);
        } else {
            log.hex("    0x", ret_addr);
        }
        ebp = frame[0];
    }
}

fn installRelocateHook() void {
    const t = trampoline.build(RELOCATE_ADDR, RELOCATE_HOOK_SIZE) orelse {
        log.print("auto_move: failed to build relocate trampoline");
        return;
    };
    relocate_trampoline_addr = @intFromPtr(t.buffer);
    if (patch.writeJump(RELOCATE_ADDR, @intFromPtr(&hookRelocateUnit))) {
        // NOP the remaining byte (6-byte prologue, 5-byte JMP)
        _ = patch.writeNops(RELOCATE_ADDR + 5, 1);
        log.print("auto_move: SUNIT_RelocateUnit hook installed");
    } else {
        log.print("auto_move: failed to install relocate hook");
    }
}

// ============================================================================
// Lifecycle
// ============================================================================

fn init() void {
    async_.init();
    // installRelocateHook(); // TODO: fix crash — calling convention mismatch
    log.print("auto_move: initialized");
}

// ============================================================================
// Game loop — resume fiber each tick
// ============================================================================

fn gameLoop() void {
    if (!settings.auto_teleport) return;
    if (mode == .none) return;

    if (!async_.tick()) {
        finishMove();
    }
}

// ============================================================================
// Automap drawing — path visualization
// ============================================================================

fn snapshotPath() void {
    const wpc = active_waypoint_count.*;
    const n = @min(wpc, MAX_DRAW_WPS);
    for (0..n) |i| draw_wps[i] = active_waypoints[i];
    draw_wp_count = n;
    draw_dest_x = dest_x;
    draw_dest_y = dest_y;
    draw_current_wp = current_wp;
    // Fix start position at time of path creation
    const player = d2.globals.playerUnit().* orelse return;
    const pos = d2.automap.unitPos(player);
    draw_start_x = pos.x;
    draw_start_y = pos.y;
    show_path = true;
}

fn updateDrawProgress() void {
    if (mode != .none and current_wp < draw_wp_count) draw_current_wp = current_wp;
}

fn gameAutomapPostDraw() void {
    if (!settings.auto_teleport) return;
    if (!show_path) return;
    updateDrawProgress();
    if (draw_wp_count == 0) return;
    drawPath();
}

fn gameUnitPostDraw() void {
    if (!settings.auto_teleport) return;

    drawRoomBoundaries();

    if (!show_path) return;
    updateDrawProgress();
    if (draw_wp_count == 0) return;
    drawPathInGame();
}

fn gamePostDraw() void {
    if (!settings.auto_teleport) return;
    refreshHUD();
    drawHUD();
    if (!show_path) return;
    if (draw_wp_count == 0) return;
    drawPathDistances();
}

fn drawRoomBoundaries() void {
    const player = d2.globals.playerUnit().* orelse return;
    const path = player.pPath orelse return;
    const room1 = path.pRoom1 orelse return;

    // Draw current room
    drawRoomRect(room1, 0x20); // green

    // Draw adjacent rooms
    const near_count = room1.dwRoomsNear;
    if (near_count == 0 or near_count > 64) return;
    const rooms_near = room1.pRoomsNear orelse return;

    var i: u32 = 0;
    while (i < near_count) : (i += 1) {
        if (rooms_near[i]) |near_room| {
            drawRoomRect(near_room, 0x08); // grey
        }
    }
}

fn drawRoomRect(room1: *d2.types.Room1, color: u32) void {
    const coll = room1.pColl orelse return;
    const rx: f64 = @floatFromInt(coll.dwPosGameX);
    const ry: f64 = @floatFromInt(coll.dwPosGameY);
    const rw: f64 = @floatFromInt(coll.dwSizeGameX);
    const rh: f64 = @floatFromInt(coll.dwSizeGameY);

    // Four corners in world space
    const tl = d2.automap.toScreen(rx, ry);
    const tr = d2.automap.toScreen(rx + rw, ry);
    const bl = d2.automap.toScreen(rx, ry + rh);
    const br = d2.automap.toScreen(rx + rw, ry + rh);

    d2.functions.DrawLine.call(tl.x, tl.y, tr.x, tr.y, color, 0x80);
    d2.functions.DrawLine.call(tr.x, tr.y, br.x, br.y, color, 0x80);
    d2.functions.DrawLine.call(br.x, br.y, bl.x, bl.y, color, 0x80);
    d2.functions.DrawLine.call(bl.x, bl.y, tl.x, tl.y, color, 0x80);
}

fn drawPath() void {
    const wps = draw_wps[0..draw_wp_count];

    // Lines first
    var prev_x: f64 = draw_start_x;
    var prev_y: f64 = draw_start_y;
    for (wps, 0..) |wp, i| {
        const wpx: f64 = @floatFromInt(wp.x);
        const wpy: f64 = @floatFromInt(wp.y);
        const past = i < draw_current_wp;
        const p1 = d2.automap.toAutomap(prev_x, prev_y);
        const p2 = d2.automap.toAutomap(wpx, wpy);
        d2.automap.drawDottedLine(p1.x, p1.y, p2.x, p2.y, if (past) 0x08 else 0x20);
        prev_x = wpx;
        prev_y = wpy;
    }

    // Markers on top
    for (wps, 0..) |wp, i| {
        const node_color: u32 = if (i < draw_current_wp) 0x08 else if (i == draw_current_wp) 0x84 else 0x20;
        d2.automap.drawAutomapMarker(@floatFromInt(wp.x), @floatFromInt(wp.y), node_color);
    }
}

fn drawPathInGame() void {
    const wps = draw_wps[0..draw_wp_count];

    // Lines first
    var prev_x: f64 = draw_start_x;
    var prev_y: f64 = draw_start_y;
    for (wps, 0..) |wp, i| {
        const wpx: f64 = @floatFromInt(wp.x);
        const wpy: f64 = @floatFromInt(wp.y);
        const past = i < draw_current_wp;
        d2.automap.drawScreenDottedLine(prev_x, prev_y, wpx, wpy, if (past) 0x08 else 0x20);
        prev_x = wpx;
        prev_y = wpy;
    }

    // Range diamonds + crosses on top
    for (wps, 0..) |wp, i| {
        const wpx: f64 = @floatFromInt(wp.x);
        const wpy: f64 = @floatFromInt(wp.y);

        const past = i < draw_current_wp;
        const node_color: u32 = if (past) 0x08 else if (i == draw_current_wp) 0x84 else 0x20;

        d2.automap.drawScreenCross(wpx, wpy, node_color, 4);
    }
}

fn drawPathDistances() void {
    const wps = draw_wps[0..draw_wp_count];
    const old_font = d2.functions.SetFont.call(.{1});
    defer _ = d2.functions.SetFont.call(.{old_font});

    for (wps, 0..) |wp, i| {
        const wpx: f64 = @floatFromInt(wp.x);
        const wpy: f64 = @floatFromInt(wp.y);
        const prev_wp_x: f64 = if (i == 0) draw_start_x else @floatFromInt(wps[i - 1].x);
        const prev_wp_y: f64 = if (i == 0) draw_start_y else @floatFromInt(wps[i - 1].y);
        const ddx = wpx - prev_wp_x;
        const ddy = wpy - prev_wp_y;
        const dist: u32 = @intFromFloat(@sqrt(ddx * ddx + ddy * ddy));
        drawScreenDistance(wpx, wpy, dist);
    }
}

fn fmtInt(val: u32, buf: []u16) usize {
    if (val == 0) {
        buf[0] = '0';
        return 1;
    }
    var v = val;
    var tmp: [10]u16 = undefined;
    var len: usize = 0;
    while (v > 0) : (len += 1) {
        tmp[len] = '0' + @as(u16, @intCast(v % 10));
        v /= 10;
    }
    for (0..len) |i| buf[i] = tmp[len - 1 - i];
    return len;
}

fn drawScreenDistance(wx: f64, wy: f64, dist: u32) void {
    const p = d2.automap.toScreen(wx, wy);
    var buf: [16]u16 = undefined;
    const len = fmtInt(dist, &buf);
    buf[len] = 0;
    d2.functions.DrawGameText.call(.{ @as([*:0]const u16, @ptrCast(&buf)), p.x - @as(c_int, @intCast(len * 3)), p.y + 14, 8, 0 });
}

fn drawScreenDiamond(x: f64, y: f64, radius: f64, color: u32) void {
    const n = d2.automap.toScreen(x, y - radius);
    const e = d2.automap.toScreen(x + radius, y);
    const s = d2.automap.toScreen(x, y + radius);
    const w = d2.automap.toScreen(x - radius, y);
    d2.functions.DrawLine.call(n.x, n.y, e.x, e.y, color, 0x40);
    d2.functions.DrawLine.call(e.x, e.y, s.x, s.y, color, 0x40);
    d2.functions.DrawLine.call(s.x, s.y, w.x, w.y, color, 0x40);
    d2.functions.DrawLine.call(w.x, w.y, n.x, n.y, color, 0x40);
}

// ============================================================================
// Input handling
// ============================================================================

fn keyEvent(key: u32, down: bool, _: u32) bool {
    if (!settings.auto_teleport) return true;

    // N = next area (deeper/higher level number)
    if (key == 0x4E and down) {
        if (mode != .none) cancelMove();
        goToExit(.next);
        return false;
    }

    // P = previous area (toward town/lower level number)
    if (key == 0x50 and down) {
        if (mode != .none) cancelMove();
        goToExit(.prev);
        return false;
    }

    // G = go to POI (waypoint, seal, quest object, etc.)
    if (key == 0x47 and down) {
        if (mode != .none) cancelMove();
        goToPOI();
        return false;
    }

    // ESC = cancel
    if (key == 0x1B and down and mode != .none) {
        cancelMove();
        return false;
    }

    // Movement keys cancel active move
    if (mode != .none and down) {
        switch (key) {
            0x57, 0x41, 0x53, 0x44, 0x25, 0x26, 0x27, 0x28 => cancelMove(),
            else => {},
        }
    }

    return true;
}

fn mouseEvent(_: i32, _: i32, _: u8, _: bool) bool {
    return true;
}

// ============================================================================
// Move to POI
// ============================================================================

fn goToPOI() void {
    const player = d2.globals.playerUnit().* orelse return;
    const path = player.pPath orelse return;
    const room1 = path.pRoom1 orelse return;
    const room2 = room1.pRoom2 orelse return;
    const lvl = room2.pLevel orelse return;
    const level_no = lvl.dwLevelNo;

    // Re-scan POIs if level changed
    if (level_no != poi_scanned_level) {
        poi_index = 0;
        poi_scanned_level = level_no;
        _ = poi.scanLevel();
    }

    const pois = poi.getPOIs(level_no);
    if (pois.len == 0) {
        log.print("auto_move: no POIs in this level");
        return;
    }

    const idx = poi_index % @as(u8, @intCast(pois.len));
    const target = pois[idx];
    poi_index = if (idx + 1 >= pois.len) 0 else idx + 1;

    log.hex("auto_move: going to POI id=", target.id);
    startMoveTo(player, @intCast(target.x), @intCast(target.y));
    updateHUD();
}

// ============================================================================
// Move to exit
// ============================================================================

fn ensureExitsScanned() void {
    const player = d2.globals.playerUnit().* orelse return;
    const path = player.pPath orelse return;
    const room1 = path.pRoom1 orelse return;
    const room2 = room1.pRoom2 orelse return;
    const lvl = room2.pLevel orelse return;
    const player_act = player.pAct orelse return;

    if (lvl.dwLevelNo == scanned_level) return;

    act_map.cleanup();
    act_map.init(player_act, lvl);
    cached_exit_count = act_map.getExits(&cached_exits);
    scanned_level = lvl.dwLevelNo;
    log.hex("auto_move: found exits: ", cached_exit_count);

    // Also scan POIs for this level
    poi_scanned_level = lvl.dwLevelNo;
    _ = poi.scanLevel();
    poi_index = 0;

    // Assign N/P: N = highest target level, P = lowest target level
    next_exit_idx = null;
    prev_exit_idx = null;
    var max_target: u32 = 0;
    var min_target: u32 = std.math.maxInt(u32);
    for (cached_exits[0..cached_exit_count], 0..) |exit, i| {
        if (exit.target > max_target) {
            max_target = exit.target;
            next_exit_idx = @intCast(i);
        }
        if (exit.target < min_target) {
            min_target = exit.target;
            prev_exit_idx = @intCast(i);
        }
    }
    // If only one exit, both N and P go there
    if (cached_exit_count == 1) {
        next_exit_idx = 0;
        prev_exit_idx = 0;
    }
}

const ExitDirection = enum { next, prev };

fn goToExit(direction: ExitDirection) void {
    const player = d2.globals.playerUnit().* orelse return;

    ensureExitsScanned();

    if (cached_exit_count == 0) {
        log.print("auto_move: no exits found");
        return;
    }

    const idx: u8 = switch (direction) {
        .next => next_exit_idx orelse return,
        .prev => prev_exit_idx orelse return,
    };
    const exit = cached_exits[idx];

    log.hex("auto_move: going to exit level ", exit.target);
    startMoveTo(player, @intCast(exit.x), @intCast(exit.y));
    updateHUD();
}

fn startMoveTo(player: *d2.types.UnitAny, target_x: i32, target_y: i32) void {
    const pp = player.pPath orelse return;

    dest_x = target_x;
    dest_y = target_y;

    const sx: i32 = @intCast(pp.xPos);
    const sy: i32 = @intCast(pp.yPos);

    if (hasTeleportSkill(player)) {
        const wp_count = teleport_reducer.findPath(sx, sy, dest_x, dest_y, TP_RANGE);
        if (wp_count == 0) {
            log.print("auto_move: no teleport path found");
            return;
        }
        log.hex("auto_move: teleport waypoints=", wp_count);
        current_wp = 0;
        active_waypoints = &teleport_reducer.waypoints;
        active_waypoint_count = &teleport_reducer.waypoint_count;
        mode = .teleport;
        snapshotPath();
        async_.spawn(&teleportSequence);
    } else {
        const wp_count = walk_reducer.findPath(sx, sy, dest_x, dest_y);
        if (wp_count == 0) {
            log.print("auto_move: no walk path found");
            return;
        }
        log.hex("auto_move: walk waypoints=", wp_count);
        current_wp = 0;
        active_waypoints = &walk_reducer.waypoints;
        active_waypoint_count = &walk_reducer.waypoint_count;
        mode = .walk;
        snapshotPath();
        async_.spawn(&walkSequence);
    }
}

// ============================================================================
// Skill management
// ============================================================================

fn hasTeleportSkill(player: *d2.types.UnitAny) bool {
    const info = player.pInfo orelse return false;
    var skill = info.pFirstSkill;
    while (skill) |s| : (skill = s.pNextSkill) {
        const si = s.pSkillInfo orelse continue;
        if (si.wSkillId == TELEPORT_SKILL_ID) {
            if (s.is_charge == 0 or s.charges_left > 0) return true;
        }
    }
    return false;
}

fn saveAndSwitchToTeleport(player: *d2.types.UnitAny) void {
    const info = player.pInfo orelse return;
    if (info.pRightSkill) |rs| {
        if (rs.pSkillInfo) |si| {
            saved_right_skill = si.wSkillId;
        }
    }
    d2.functions.sendSelectSkill(TELEPORT_SKILL_ID, false);
}

fn restoreSkill() void {
    if (saved_right_skill != 0 and saved_right_skill != TELEPORT_SKILL_ID) {
        d2.functions.sendSelectSkill(saved_right_skill, false);
        saved_right_skill = 0;
    }
}

// ============================================================================
// Teleport sequence (runs in fiber)
// ============================================================================

fn getPlayerPos() ?[2]u32 {
    const p = d2.globals.playerUnit().* orelse return null;
    const pp = p.pPath orelse return null;
    return .{ pp.xPos, pp.yPos };
}

fn teleportSequence() void {
    const player = d2.globals.playerUnit().* orelse return;
    saveAndSwitchToTeleport(player);

    // Wait for skill switch
    async_.waitFrames(6);

    log.hex("tele: total wps=", teleport_reducer.waypoint_count);

    var retries: u32 = 0;

    while (current_wp < teleport_reducer.waypoint_count) {
        const pos_before = getPlayerPos() orelse {
            restoreSkill();
            return;
        };
        const px: i32 = @intCast(pos_before[0]);
        const py: i32 = @intCast(pos_before[1]);

        // Skip optimization: if we're already close to current_wp+1 (within TP_RANGE),
        // skip current node. Distance-based to avoid chain-skipping through rooms.
        if (retries == 0 and current_wp + 1 < teleport_reducer.waypoint_count) {
            const next = teleport_reducer.waypoints[current_wp + 1];
            const ds_next = distSq(next.x, next.y, px, py);
            if (ds_next < @as(i32, TP_RANGE) * @as(i32, TP_RANGE)) {
                current_wp += 1;
                continue;
            }
        }

        const wp = teleport_reducer.waypoints[current_wp];

        const ds = distSq(wp.x, wp.y, px, py);
        if (ds < 15 * 15) {
            current_wp += 1;
            retries = 0;
            continue;
        }

        // Validate target is reachable from here (game's own room check)
        if (!isTeleportReachable(wp.x, wp.y)) {
            log.print("tele: wp not reachable!");
            log.hex("  wp.x=", @as(u32, @bitCast(wp.x)));
            log.hex("  wp.y=", @as(u32, @bitCast(wp.y)));
            log.hex("  player.x=", pos_before[0]);
            log.hex("  player.y=", pos_before[1]);
            const ddx = wp.x - px;
            const ddy = wp.y - py;
            const dist: u32 = @intFromFloat(@sqrt(@as(f64, @floatFromInt(ddx * ddx + ddy * ddy))));
            log.hex("  dist=", dist);
            log.hex("  wp#=", current_wp);
            restoreSkill();
            return;
        }

        // Cast teleport
        d2.functions.castRightSkillAt(@intCast(wp.x), @intCast(wp.y));

        // Wait for position change (teleport animation ~20 frames)
        const pos_after = async_.waitForMove(&getPlayerPos, 20);

        if (pos_after) |after| {
            const moved = after[0] != pos_before[0] or after[1] != pos_before[1];
            if (moved) {
                retries = 0;
                current_wp += 1;
                continue;
            }
        }

        retries += 1;
        if (retries >= 5) {
            log.print("tele: stuck after 5 retries, stopping");
            restoreSkill();
            return;
        } else {
            // Verify skill is still teleport before retry
            const p2 = d2.globals.playerUnit().* orelse {
                restoreSkill();
                return;
            };
            const info = p2.pInfo orelse {
                restoreSkill();
                return;
            };
            if (info.pRightSkill) |rs| {
                if (rs.pSkillInfo) |si| {
                    if (si.wSkillId != TELEPORT_SKILL_ID) {
                        d2.functions.sendSelectSkill(TELEPORT_SKILL_ID, false);
                        async_.waitFrames(6);
                    }
                }
            }
            async_.waitFrames(2);
        }
    }

    // Final teleport to actual destination if not already there
    const final_pos = getPlayerPos() orelse {
        restoreSkill();
        return;
    };
    const final_ds = distSq(dest_x, dest_y, @intCast(final_pos[0]), @intCast(final_pos[1]));
    if (final_ds >= 5 * 5 and isTeleportReachable(dest_x, dest_y)) {
        d2.functions.castRightSkillAt(@intCast(dest_x), @intCast(dest_y));
        _ = async_.waitForMove(&getPlayerPos, 12);
    }

    log.print("tele: sequence done");
    restoreSkill();
}

/// Check if (x,y) is reachable by teleport from the player's current position.
/// Calls the game's own DRLGROOM_FindBetterNearbyRoom — the exact function the server
/// uses to validate teleport targets. Returns true if (x,y) is in player's current
/// room or any directly adjacent room.
fn isTeleportReachable(x: i32, y: i32) bool {
    const player = d2.globals.playerUnit().* orelse return false;
    const path = player.pPath orelse return false;
    const room1 = path.pRoom1 orelse return false;
    return d2.functions.FindBetterNearbyRoom.call(.{ room1, x, y }) != null;
}

/// Check if (x,y) is a valid teleport landing spot — reachable AND not blocked.
/// Uses the game's collision check with PLAYER_COLLISION_DEFAULT (0x1C09).
fn isTeleportValid(x: i32, y: i32) bool {
    const player = d2.globals.playerUnit().* orelse return false;
    const path = player.pPath orelse return false;
    const room1 = path.pRoom1 orelse return false;
    const target_room = d2.functions.FindBetterNearbyRoom.call(.{ room1, x, y }) orelse return false;
    // Unit size 1 (player), collision mask 0x1C09 (PLAYER_COLLISION_DEFAULT)
    const coll = d2.functions.CheckCollisionWidth.call(.{ target_room, x, y, 1, 0x1C09 });
    return coll == 0; // COLLIDE_NONE
}

fn distSq(wx: i32, wy: i32, px: i32, py: i32) i32 {
    const dx = wx - px;
    const dy = wy - py;
    return dx * dx + dy * dy;
}

// ============================================================================
// Walk sequence (runs in fiber)
// ============================================================================

fn walkSequence() void {
    while (current_wp < walk_reducer.waypoint_count) {
        const wp = walk_reducer.waypoints[current_wp];

        d2.functions.clickAtWorld(1, wp.x, wp.y);

        var wait_ticks: u32 = 0;
        while (wait_ticks < 300) : (wait_ticks += 1) {
            async_.yield();
            const player = d2.globals.playerUnit().* orelse return;
            const path = player.pPath orelse break;
            const dx = wp.x - @as(i32, @intCast(path.xPos));
            const dy = wp.y - @as(i32, @intCast(path.yPos));
            if (dx * dx + dy * dy < 10 * 10) break;

            if (wait_ticks % 30 == 0 and wait_ticks > 0) {
                d2.functions.clickAtWorld(1, wp.x, wp.y);
            }
        }

        current_wp += 1;
    }

    // Final click to actual destination
    d2.functions.clickAtWorld(1, dest_x, dest_y);
}

// ============================================================================
// HUD — key target labels above right skill orb
// ============================================================================

fn refreshHUD() void {
    ensureExitsScanned();
    updateHUD();
}

fn updateHUD() void {
    const player = d2.globals.playerUnit().* orelse return;
    const path = player.pPath orelse return;
    const room1 = path.pRoom1 orelse return;
    const room2 = room1.pRoom2 orelse return;
    const lvl = room2.pLevel orelse return;
    const level_no = lvl.dwLevelNo;

    // N label: next exit (deeper)
    hud_n_len = 0;
    if (next_exit_idx) |idx| {
        hud_n_len = buildExitLabel(&hud_n_label, "N: ", cached_exits[idx].target);
    }

    // P label: previous exit (toward town)
    hud_p_len = 0;
    if (prev_exit_idx) |idx| {
        // Only show P if it's different from N
        if (next_exit_idx == null or idx != next_exit_idx.?) {
            hud_p_len = buildExitLabel(&hud_p_label, "P: ", cached_exits[idx].target);
        }
    }

    // G label: next POI
    hud_g_len = 0;
    const pois = poi.getPOIs(level_no);
    if (pois.len > 0) {
        const idx = poi_index % @as(u8, @intCast(pois.len));
        const p = pois[idx];
        hud_g_len = buildPOILabel(&hud_g_label, "G: ", p);
    }
}

fn buildExitLabel(buf: []u16, comptime prefix: []const u8, target_level: u32) usize {
    var pos: usize = 0;
    for (prefix) |c| {
        if (pos >= buf.len - 1) break;
        buf[pos] = c;
        pos += 1;
    }

    // Try to get level name
    if (d2.functions.GetLevelText.call(target_level)) |txt| {
        const name_ptr: [*]const u16 = @ptrCast(&txt.wName);
        var i: usize = 0;
        while (i < 40 and pos < buf.len - 1) : (i += 1) {
            if (name_ptr[i] == 0) break;
            buf[pos] = name_ptr[i];
            pos += 1;
        }
    }

    buf[pos] = 0;
    return pos;
}

fn buildPOILabel(buf: []u16, comptime prefix: []const u8, p: poi.POI) usize {
    var pos: usize = 0;
    for (prefix) |c| {
        if (pos >= buf.len - 1) break;
        buf[pos] = c;
        pos += 1;
    }

    const label = poi.nameForPOI(p);
    var i: usize = 0;
    while (pos < buf.len - 1) : (i += 1) {
        if (label[i] == 0) break;
        buf[pos] = label[i];
        pos += 1;
    }

    buf[pos] = 0;
    return pos;
}

fn drawHUD() void {
    if (hud_n_len == 0 and hud_p_len == 0 and hud_g_len == 0) return;

    const old_font = d2.functions.SetFont.call(.{1});
    defer _ = d2.functions.SetFont.call(.{old_font});

    const sw = d2.globals.screenWidth().*;
    const sh = d2.globals.screenHeight().*;
    const base_x: c_int = sw - 10;
    var y: c_int = sh - 120; // above right orb

    if (hud_g_len > 0) {
        drawHUDLine(&hud_g_label, hud_g_len, base_x, y);
        y -= 16;
    }
    if (hud_p_len > 0) {
        drawHUDLine(&hud_p_label, hud_p_len, base_x, y);
        y -= 16;
    }
    if (hud_n_len > 0) {
        drawHUDLine(&hud_n_label, hud_n_len, base_x, y);
    }
}

fn drawHUDLine(buf: [*]const u16, len: usize, right_x: c_int, y: c_int) void {
    var width: u32 = 0;
    var font_num: u32 = 1;
    const text: [*:0]const u16 = @ptrCast(buf);
    _ = d2.functions.GetTextSize.call(.{ text, &width, &font_num });
    _ = len;
    const x = right_x - @as(c_int, @intCast(width));
    d2.functions.DrawGameText.call(.{ text, x, y, 4, 0 }); // color 4 = orange
}

// ============================================================================
// Cleanup
// ============================================================================

fn cancelMove() void {
    if (mode == .teleport) restoreSkill();
    async_.cancel();
    mode = .none;
    current_wp = 0;
    show_path = false;
    hud_n_len = 0;
    hud_p_len = 0;
    hud_g_len = 0;
}

fn finishMove() void {
    // Keep show_path visible, freeze draw_current_wp at last position
    mode = .none;
    current_wp = 0;
}

// ============================================================================
// Feature hooks
// ============================================================================

pub const hooks = feature.Hooks{
    .init = &init,
    .gameLoop = &gameLoop,
    .gameUnitPostDraw = &gameUnitPostDraw,
    .gamePostDraw = &gamePostDraw,
    .gameAutomapPostDraw = &gameAutomapPostDraw,
    .keyEvent = &keyEvent,
    .mouseEvent = &mouseEvent,
};
