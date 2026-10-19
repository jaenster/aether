//! `embed_check [--list] SRC_DIR ROOT...`: the embedding path patches nothing.
//!
//! With --list it prints the files on the path instead (the .zig files and what
//! they @embedFile), one per line, sorted: what a host that vendors the engine
//! copies.
//!
//! Follows every @import from each root (embed.zig, embed_dll.zig) through the
//! source tree and fails when it reaches a file that patches the game, owns the
//! process or links mozjs.dll at load time, or when a file it reaches calls an
//! API that writes code or opens a console. Comments are not read.

const std = @import("std");

/// Files the embedding path must never import.
const forbidden_files = [_][]const u8{
    "aether.zig",            "dbghelp_proxy.zig", "feature.zig",
    "crash_handler.zig",     "fog_allocator.zig", "spawn_logger.zig",
    "sm/bridge_linked.zig",
};

/// Directories the embedding path must never import from.
const forbidden_dirs = [_][]const u8{ "hook/", "features/" };

/// Calls no file on the embedding path may make.
const forbidden_calls = [_][]const u8{
    "VirtualProtect", "WriteProcessMemory", "FlushInstructionCache", "AllocConsole",
    "DllMain",        "@cImport",           "AddVectoredExceptionHandler",
};

var failures: usize = 0;

/// `src` without its // comments (string literals are kept as they are).
fn code(gpa: std.mem.Allocator, src: []const u8) ![]u8 {
    var out: std.ArrayList(u8) = .empty;
    var lines = std.mem.splitScalar(u8, src, '\n');
    while (lines.next()) |line| {
        var in_str = false;
        var i: usize = 0;
        var end = line.len;
        while (i < line.len) : (i += 1) {
            const ch = line[i];
            if (in_str) {
                if (ch == '\\') i += 1 else if (ch == '"') in_str = false;
            } else if (ch == '"') {
                in_str = true;
            } else if (ch == '/' and i + 1 < line.len and line[i + 1] == '/') {
                end = i;
                break;
            }
        }
        try out.appendSlice(gpa, line[0..end]);
        try out.append(gpa, '\n');
    }
    return out.items;
}

pub fn main(init: std.process.Init) !void {
    const arena = init.arena.allocator();
    const io = init.io;
    const all_args = try init.minimal.args.toSlice(arena);
    const list = all_args.len > 1 and std.mem.eql(u8, all_args[1], "--list");
    const args = if (list) all_args[1..] else all_args;
    if (args.len < 3) {
        std.debug.print("usage: embed_check [--list] SRC_DIR ROOT...\n", .{});
        std.process.exit(2);
    }
    const src_dir = try std.Io.Dir.cwd().openDir(io, args[1], .{});

    var seen: std.StringHashMapUnmanaged(void) = .empty;
    var todo: std.ArrayList([]const u8) = .empty;
    for (args[2..]) |root| try todo.append(arena, root);

    while (todo.pop()) |rel| {
        if (seen.contains(rel)) continue;
        try seen.put(arena, rel, {});

        for (forbidden_files) |f| if (std.mem.eql(u8, rel, f)) {
            std.debug.print("  embed path imports {s}\n", .{rel});
            failures += 1;
        };
        for (forbidden_dirs) |d| if (std.mem.startsWith(u8, rel, d)) {
            std.debug.print("  embed path imports {s}\n", .{rel});
            failures += 1;
        };

        // embedded files (.js, .bin) are data, not code
        if (!std.mem.endsWith(u8, rel, ".zig")) continue;
        const raw = src_dir.readFileAlloc(io, rel, arena, .limited(16 << 20)) catch |e| {
            std.debug.print("  {s}: {s}\n", .{ rel, @errorName(e) });
            failures += 1;
            continue;
        };
        const src = try code(arena, raw);
        for (forbidden_calls) |call| if (std.mem.indexOf(u8, src, call) != null) {
            std.debug.print("  {s} on the embed path names {s}\n", .{ rel, call });
            failures += 1;
        };

        const dir = std.fs.path.dirname(rel) orelse "";
        for ([_][]const u8{ "@import(\"", "@embedFile(\"" }) |builtin| {
            var rest: []const u8 = src;
            while (std.mem.indexOf(u8, rest, builtin)) |at| {
                rest = rest[at + builtin.len ..];
                const close = std.mem.indexOfScalar(u8, rest, '"') orelse break;
                const name = rest[0..close];
                rest = rest[close..];
                // std, builtin, build options
                if (builtin[1] == 'i' and !std.mem.endsWith(u8, name, ".zig")) continue;
                const joined = try std.fs.path.resolvePosix(arena, &.{ dir, name });
                try todo.append(arena, joined);
            }
        }
    }

    if (list) {
        var names: std.ArrayList([]const u8) = .empty;
        var it = seen.keyIterator();
        while (it.next()) |k| try names.append(arena, k.*);
        std.mem.sort([]const u8, names.items, {}, struct {
            fn lt(_: void, a: []const u8, b: []const u8) bool {
                return std.mem.lessThan(u8, a, b);
            }
        }.lt);
        var buf: [4096]u8 = undefined;
        var w = std.Io.File.stdout().writerStreaming(io, &buf);
        for (names.items) |n| w.interface.print("{s}\n", .{n}) catch {};
        w.interface.flush() catch {};
        if (failures != 0) std.process.exit(1);
        return;
    }

    if (seen.count() < 10) {
        std.debug.print("  embed path: only {d} files read\n", .{seen.count()});
        failures += 1;
    }
    if (failures != 0) {
        std.debug.print("embed_check: {d} failures over {d} files\n", .{ failures, seen.count() });
        std.process.exit(1);
    }
    var buf: [128]u8 = undefined;
    var w = std.Io.File.stdout().writerStreaming(io, &buf);
    w.interface.print("embed_check: {d} files on the embed path, none patches\n", .{seen.count()}) catch {};
    w.interface.flush() catch {};
}
