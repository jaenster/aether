const std = @import("std");
const log = @import("../log.zig");
const DaemonConnection = @import("daemon.zig").DaemonConnection;
const json = @import("json.zig");
const Engine = @import("../sm/engine.zig").Engine;

const DWORD = u32;
extern "kernel32" fn GetEnvironmentVariableA(name: [*:0]const u8, buf: [*]u8, size: DWORD) callconv(.winapi) DWORD;

pub const LoadState = enum {
    idle,
    waiting_response,
    loaded,
    failed,
};

pub const ScriptLoader = struct {
    state: LoadState = .idle,
    entry_path: [256]u8 = .{0} ** 256,
    entry_path_len: usize = 0,
    request_id: u32 = 0,
    modules_loaded: u32 = 0,

    pub fn init(self: *ScriptLoader) bool {
        var buf: [256]u8 = undefined;
        const len = GetEnvironmentVariableA("AETHER_ENTRY", &buf, buf.len);
        if (len == 0) {
            log.print("loader: AETHER_ENTRY not set, no script to load");
            return false;
        }
        @memcpy(self.entry_path[0..len], buf[0..len]);
        self.entry_path_len = len;
        log.printStr("loader: entry = ", buf[0..len]);
        return true;
    }

    /// Request the entry script from the daemon.
    pub fn requestEntry(self: *ScriptLoader, daemon: *DaemonConnection) void {
        if (self.state != .idle) return;
        if (!daemon.isReady()) return;

        self.request_id += 1;
        if (daemon.requestFile(self.entry_path[0..self.entry_path_len], self.request_id)) {
            self.state = .waiting_response;
            log.print("loader: requested entry script");
        }
    }

    /// Handle a daemon message — check if it's a file:response for us.
    /// If it is, eval all modules in the given engine context.
    pub fn handleMessage(self: *ScriptLoader, msg: []const u8, eng: *Engine, ctx: *anyopaque) void {
        if (self.state != .waiting_response) return;

        // Check if this is a file:response
        if (!json.hasStringValue(msg, "type", "file:response")) return;

        // Check for error
        if (json.getString(msg, "error")) |err| {
            log.printStr("loader: error: ", err);
            if (json.getString(msg, "message")) |m| {
                log.printStr("loader: ", m);
            }
            self.state = .failed;
            return;
        }

        // Get modules array and eval each one
        var modules = json.getArray(msg, "modules") orelse {
            log.print("loader: no modules in response");
            self.state = .failed;
            return;
        };

        var count: u32 = 0;
        while (modules.next()) |module_json| {
            const source = json.getString(module_json, "source") orelse continue;
            const path = json.getString(module_json, "path") orelse "unknown";

            // Decode JSON-escaped source into a buffer for eval
            var decode_buf: [65536]u8 = undefined;
            const decoded = json.decodeString(source, &decode_buf) orelse {
                log.printStr("loader: decode failed for ", path);
                continue;
            };

            if (eng.eval(ctx, decoded)) |result| {
                _ = result;
                count += 1;
            } else {
                log.printStr("loader: eval failed for ", path);
            }
        }

        self.modules_loaded = count;
        self.state = .loaded;
        log.print("loader: script loaded");
    }

    /// Handle file:invalidate — triggers a reload
    pub fn handleInvalidate(self: *ScriptLoader, msg: []const u8) bool {
        if (!json.hasStringValue(msg, "type", "file:invalidate")) return false;
        log.print("loader: file invalidated, will reload");
        self.state = .idle;
        self.modules_loaded = 0;
        return true;
    }
};
