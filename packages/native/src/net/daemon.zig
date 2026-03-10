const std = @import("std");
const log = @import("../log.zig");
const WsClient = @import("ws_client.zig").WsClient;

const DWORD = u32;
extern "kernel32" fn GetEnvironmentVariableA(name: [*:0]const u8, buf: [*]u8, size: DWORD) callconv(.winapi) DWORD;

pub const DaemonConnection = struct {
    ws: WsClient = .{},
    connected: bool = false,
    hello_sent: bool = false,
    welcomed: bool = false,
    client_name: [64]u8 = .{0} ** 64,
    client_name_len: usize = 0,

    /// Read AETHER_DAEMON env var and initialize the WS connection.
    pub fn init(self: *DaemonConnection) bool {
        // Read daemon address
        var addr_buf: [128]u8 = undefined;
        const addr_len = GetEnvironmentVariableA("AETHER_DAEMON", &addr_buf, addr_buf.len);
        if (addr_len == 0) {
            log.print("daemon: AETHER_DAEMON not set, scripting disabled");
            return false;
        }

        // Read client name
        self.client_name_len = GetEnvironmentVariableA("AETHER_CLIENT_NAME", &self.client_name, self.client_name.len);
        if (self.client_name_len == 0) {
            const default_name = "game";
            @memcpy(self.client_name[0..default_name.len], default_name);
            self.client_name_len = default_name.len;
        }

        // Parse host:port
        const addr = addr_buf[0..addr_len];
        const colon = findChar(addr, ':') orelse {
            log.print("daemon: invalid AETHER_DAEMON format (expected host:port)");
            return false;
        };

        const host = addr[0..colon];
        const port_str = addr[colon + 1 .. addr_len];
        const port = parsePort(port_str) orelse {
            log.print("daemon: invalid port in AETHER_DAEMON");
            return false;
        };

        self.ws.init(host, port);
        log.printStr("daemon: will connect to ", addr);
        return true;
    }

    pub fn deinit(self: *DaemonConnection) void {
        self.ws.deinit();
    }

    /// Poll the connection — call once per tick.
    /// Handles WS connect, hello/welcome handshake, and incoming messages.
    pub fn poll(self: *DaemonConnection) ?[]const u8 {
        const msg = self.ws.poll() orelse return null;

        if (!self.welcomed) {
            // Expect welcome response
            if (findInJson(msg.data, "\"welcome\"")) |_| {
                self.welcomed = true;
                log.print("daemon: welcome received");
            }
            return null;
        }

        // Return the raw JSON payload for the caller to handle
        return msg.data;
    }

    /// Send a JSON message to the daemon.
    pub fn send(self: *DaemonConnection, json: []const u8) bool {
        return self.ws.sendText(json);
    }

    /// Called after WS connection is established to send hello.
    pub fn sendHello(self: *DaemonConnection) void {
        if (self.hello_sent) return;
        self.hello_sent = true;

        // Build hello JSON
        var buf: [256]u8 = undefined;
        var pos: usize = 0;
        const parts = [_][]const u8{
            "{\"type\":\"hello\",\"protocolVersion\":1,\"clientType\":\"game\",\"clientName\":\"",
            self.client_name[0..self.client_name_len],
            "\"}",
        };
        for (parts) |part| {
            @memcpy(buf[pos .. pos + part.len], part);
            pos += part.len;
        }
        if (self.ws.sendText(buf[0..pos])) {
            log.print("daemon: hello sent");
        } else {
            log.print("daemon: failed to send hello");
        }
    }

    /// Tick — drives connect + handshake state machine.
    pub fn tick(self: *DaemonConnection) ?[]const u8 {
        // If we just connected, send hello
        if (self.ws.isConnected() and !self.hello_sent) {
            self.sendHello();
        }

        // If we disconnected, reset handshake state
        if (self.ws.state == .disconnected) {
            self.hello_sent = false;
            self.welcomed = false;
        }

        return self.poll();
    }

    pub fn isReady(self: *DaemonConnection) bool {
        return self.ws.isConnected() and self.welcomed;
    }

    /// Request a file (script) from the daemon.
    pub fn requestFile(self: *DaemonConnection, path: []const u8, request_id: u32) bool {
        var buf: [512]u8 = undefined;
        var pos: usize = 0;
        const parts = [_][]const u8{
            "{\"type\":\"file:request\",\"id\":\"",
        };
        for (parts) |part| {
            @memcpy(buf[pos .. pos + part.len], part);
            pos += part.len;
        }
        // Write request_id as decimal
        const id_str = uintToStr(request_id);
        @memcpy(buf[pos .. pos + id_str.len], id_str);
        pos += id_str.len;

        const mid = "\",\"path\":\"";
        @memcpy(buf[pos .. pos + mid.len], mid);
        pos += mid.len;

        @memcpy(buf[pos .. pos + path.len], path);
        pos += path.len;

        const tail = "\"}";
        @memcpy(buf[pos .. pos + tail.len], tail);
        pos += tail.len;

        return self.send(buf[0..pos]);
    }
};

// ── Helpers ──────────────────────────────────────────────────────────

fn findChar(s: []const u8, ch: u8) ?usize {
    for (s, 0..) |c, i| {
        if (c == ch) return i;
    }
    return null;
}

fn parsePort(s: []const u8) ?u16 {
    var val: u32 = 0;
    for (s) |ch| {
        if (ch < '0' or ch > '9') return null;
        val = val * 10 + (ch - '0');
        if (val > 65535) return null;
    }
    if (val == 0) return null;
    return @intCast(val);
}

fn findInJson(data: []const u8, needle: []const u8) ?usize {
    if (needle.len > data.len) return null;
    var i: usize = 0;
    while (i <= data.len - needle.len) : (i += 1) {
        if (std.mem.eql(u8, data[i .. i + needle.len], needle)) return i;
    }
    return null;
}

fn uintToStr(val: u32) []const u8 {
    const S = struct {
        var buf: [10]u8 = undefined;
    };
    var v = val;
    var i: usize = 10;
    if (v == 0) return "0";
    while (v > 0 and i > 0) {
        i -= 1;
        S.buf[i] = '0' + @as(u8, @intCast(v % 10));
        v /= 10;
    }
    return S.buf[i..10];
}
