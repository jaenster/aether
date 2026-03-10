const std = @import("std");
const log = @import("../log.zig");
const DaemonConnection = @import("daemon.zig").DaemonConnection;
const json = @import("json.zig");
const Engine = @import("../sm/engine.zig").Engine;
const bindings = @import("../sm/bindings.zig");

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
        return true;
    }

    /// Request the entry script from the daemon.
    pub fn requestEntry(self: *ScriptLoader, daemon: *DaemonConnection) void {
        if (self.state != .idle) return;
        if (!daemon.isReady()) return;

        self.request_id += 1;
        if (daemon.requestFile(self.entry_path[0..self.entry_path_len], self.request_id)) {
            self.state = .waiting_response;
        }
    }

    /// Handle a daemon message — check if it's a file:response for us.
    /// On hot-reload (state == .loaded), returns true to signal context recreation needed.
    pub fn handleMessage(self: *ScriptLoader, msg: []const u8, eng: *Engine, ctx: *anyopaque) bool {
        if (self.state != .waiting_response and self.state != .loaded and self.state != .failed) return false;

        if (!json.hasStringValue(msg, "type", "file:response")) return false;

        // Check for error
        if (json.getString(msg, "error")) |err| {
            log.printStr("loader: error: ", err);
            if (json.getString(msg, "message")) |m| {
                log.printStr("loader: ", m);
            }
            self.state = .failed;
            return false;
        }

        const is_reload = self.state == .loaded;

        // Init module system
        if (!eng.moduleInit(ctx)) {
            log.print("loader: module init failed");
            self.state = .failed;
            return false;
        }

        // Compile diablo:native built-in module
        if (eng.moduleCompile(ctx, "diablo:native", bindings.native_module_source)) |err| {
            log.printStr("loader: diablo:native compile failed: ", err);
            self.state = .failed;
            return false;
        }

        // Get entry specifier
        const entry_spec = json.getString(msg, "entry") orelse {
            log.print("loader: no entry specifier in response");
            self.state = .failed;
            return false;
        };

        // Compile each module from the response
        var modules = json.getArray(msg, "modules") orelse {
            log.print("loader: no modules in response");
            self.state = .failed;
            return false;
        };

        var count: u32 = 0;
        while (modules.next()) |module_json| {
            const source = json.getString(module_json, "source") orelse continue;
            const specifier = json.getString(module_json, "specifier") orelse continue;

            // Decode JSON-escaped source (up to 256KB for large transpiled + sourcemap modules)
            var decode_buf: [262144]u8 = undefined;
            const decoded = json.decodeString(source, &decode_buf) orelse {
                log.printStr("loader: decode failed for ", specifier);
                continue;
            };

            if (eng.moduleCompile(ctx, specifier, decoded)) |err| {
                log.printStr("loader: compile failed for ", specifier);
                log.printStr("loader: ", err);
                self.state = .failed;
                return false;
            }
            count += 1;
        }

        // Decode the entry specifier (it's JSON-escaped too)
        var entry_buf: [256]u8 = undefined;
        const entry_decoded = json.decodeString(entry_spec, &entry_buf) orelse {
            log.print("loader: failed to decode entry specifier");
            self.state = .failed;
            return false;
        };

        // Instantiate — resolves all import dependencies
        if (eng.moduleInstantiate(ctx, entry_decoded)) |err| {
            log.printStr("loader: instantiate failed: ", err);
            self.state = .failed;
            return false;
        }

        // Evaluate — executes the module graph
        if (eng.moduleEvaluate(ctx, entry_decoded)) |err| {
            log.printStr("loader: evaluate failed: ", err);
            self.state = .failed;
            return false;
        }

        self.modules_loaded = count;
        self.state = .loaded;
        if (is_reload) {
            log.hex("loader: hot-reloaded modules=", count);
        } else {
            log.hex("loader: modules loaded=", count);
        }
        return is_reload;
    }
};
