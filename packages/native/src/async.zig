const std = @import("std");
const log = @import("log.zig");

const LPVOID = ?*anyopaque;
const DWORD = u32;

extern "kernel32" fn ConvertThreadToFiber(param: LPVOID) callconv(.winapi) LPVOID;
extern "kernel32" fn CreateFiber(stack_size: DWORD, start: *const fn (LPVOID) callconv(.winapi) void, param: LPVOID) callconv(.winapi) LPVOID;
extern "kernel32" fn SwitchToFiber(fiber: LPVOID) callconv(.winapi) void;
extern "kernel32" fn DeleteFiber(fiber: LPVOID) callconv(.winapi) void;

var main_fiber: LPVOID = null;
var task_fiber: LPVOID = null;
var task_fn: ?*const fn () void = null;
var task_done: bool = false;

pub fn getMainFiber() LPVOID {
    return main_fiber;
}

pub fn init() void {
    main_fiber = ConvertThreadToFiber(null);
    if (main_fiber == null) {
        log.print("async: ConvertThreadToFiber failed");
    }
}

/// Yield control back to the game loop. Call this from within a task.
pub fn yield() void {
    SwitchToFiber(main_fiber.?);
}

/// Tick the active task fiber. Call this from the game loop each tick.
/// Returns true if the task is still running, false if it completed or no task.
pub fn tick() bool {
    if (task_fiber == null) return false;
    if (task_done) {
        cleanup();
        return false;
    }
    SwitchToFiber(task_fiber.?);
    if (task_done) {
        cleanup();
        return false;
    }
    return true;
}

/// Spawn a new task. Cancels any existing task first.
pub fn spawn(func: *const fn () void) void {
    cancel();
    task_fn = func;
    task_done = false;
    task_fiber = CreateFiber(64 * 1024, &fiberEntry, null);
    if (task_fiber == null) {
        log.print("async: CreateFiber failed");
        task_fn = null;
    }
}

/// Cancel the active task without resuming it.
pub fn cancel() void {
    if (task_fiber) |f| {
        DeleteFiber(f);
        task_fiber = null;
        task_fn = null;
        task_done = false;
    }
}

/// Returns true if a task is currently active (spawned and not yet completed).
pub fn isActive() bool {
    return task_fiber != null and !task_done;
}

/// Wait exactly one game frame (alias for yield).
pub fn nextFrame() void {
    yield();
}

/// Wait N game frames.
pub fn waitFrames(n: u32) void {
    for (0..n) |_| yield();
}

/// Wait until the unit at (cur_x, cur_y) has moved, or max_frames elapses.
/// Returns the new position, or null if the unit pointer became invalid.
pub fn waitForMove(getPos: *const fn () ?[2]u32, max_frames: u32) ?[2]u32 {
    const start = getPos() orelse return null;
    for (0..max_frames) |_| {
        yield();
        const now = getPos() orelse return null;
        if (now[0] != start[0] or now[1] != start[1]) return now;
    }
    return getPos();
}

fn cleanup() void {
    if (task_fiber) |f| {
        DeleteFiber(f);
        task_fiber = null;
        task_fn = null;
        task_done = false;
    }
}

fn fiberEntry(_: LPVOID) callconv(.winapi) void {
    if (task_fn) |func| {
        func();
    }
    task_done = true;
    // Return to main fiber — fiber will be cleaned up on next resume()
    SwitchToFiber(main_fiber.?);
}
