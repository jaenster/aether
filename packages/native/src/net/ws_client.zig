const std = @import("std");
const log = @import("../log.zig");

// Win32 Winsock2 imports
const SOCKET = usize;
const INVALID_SOCKET: SOCKET = ~@as(SOCKET, 0);
const SOCKET_ERROR: c_int = -1;
const AF_INET: c_int = 2;
const SOCK_STREAM: c_int = 1;
const IPPROTO_TCP: c_int = 6;
const FIONBIO: c_long = @bitCast(@as(c_ulong, 0x8004667E));

const SockaddrIn = extern struct {
    sin_family: i16,
    sin_port: u16,
    sin_addr: u32,
    sin_zero: [8]u8 = .{0} ** 8,
};

const WSAData = extern struct {
    wVersion: u16,
    wHighVersion: u16,
    szDescription: [257]u8,
    szSystemStatus: [129]u8,
    iMaxSockets: u16,
    iMaxUdpDg: u16,
    lpVendorInfo: ?*u8,
};

const FdSet = extern struct {
    fd_count: u32,
    fd_array: [64]SOCKET,
};

const Timeval = extern struct {
    tv_sec: c_long,
    tv_usec: c_long,
};

extern "ws2_32" fn WSAStartup(wVersionRequested: u16, lpWSAData: *WSAData) callconv(.winapi) c_int;
extern "ws2_32" fn WSACleanup() callconv(.winapi) c_int;
extern "ws2_32" fn WSAGetLastError() callconv(.winapi) c_int;
extern "ws2_32" fn socket(af: c_int, @"type": c_int, protocol: c_int) callconv(.winapi) SOCKET;
extern "ws2_32" fn connect(s: SOCKET, name: *const SockaddrIn, namelen: c_int) callconv(.winapi) c_int;
extern "ws2_32" fn send(s: SOCKET, buf: [*]const u8, len: c_int, flags: c_int) callconv(.winapi) c_int;
extern "ws2_32" fn recv(s: SOCKET, buf: [*]u8, len: c_int, flags: c_int) callconv(.winapi) c_int;
extern "ws2_32" fn closesocket(s: SOCKET) callconv(.winapi) c_int;
extern "ws2_32" fn ioctlsocket(s: SOCKET, cmd: c_long, argp: *c_ulong) callconv(.winapi) c_int;
extern "ws2_32" fn select(nfds: c_int, readfds: ?*FdSet, writefds: ?*FdSet, exceptfds: ?*FdSet, timeout: ?*Timeval) callconv(.winapi) c_int;

const WSAEWOULDBLOCK: c_int = 10035;

// WebSocket opcodes
const WS_TEXT: u8 = 0x1;
const WS_BINARY: u8 = 0x2;
const WS_CLOSE: u8 = 0x8;
const WS_PING: u8 = 0x9;
const WS_PONG: u8 = 0xA;

pub const WsState = enum {
    disconnected,
    connecting,
    connected,
    closing,
};

pub const WsMessage = struct {
    data: []const u8,
    opcode: u8,
};

pub const WsClient = struct {
    sock: SOCKET = INVALID_SOCKET,
    state: WsState = .disconnected,
    host: [64]u8 = .{0} ** 64,
    host_len: usize = 0,
    port: u16 = 0,
    recv_buf: [524288]u8 = undefined,
    recv_len: usize = 0,
    // Buffered frame assembly
    frame_buf: [524288]u8 = undefined,
    frame_len: usize = 0,
    wsa_initialized: bool = false,
    handshake_sent: bool = false,
    handshake_done: bool = false,
    reconnect_ticks: u32 = 0,
    reconnect_delay: u32 = 60, // ~1 second at 60fps

    pub fn init(self: *WsClient, host: []const u8, port: u16) void {
        if (!self.wsa_initialized) {
            var wsa_data: WSAData = undefined;
            if (WSAStartup(0x0202, &wsa_data) != 0) {
                log.print("ws: WSAStartup failed");
                return;
            }
            self.wsa_initialized = true;
        }
        const len = @min(host.len, self.host.len - 1);
        @memcpy(self.host[0..len], host[0..len]);
        self.host[len] = 0;
        self.host_len = len;
        self.port = port;
    }

    pub fn deinit(self: *WsClient) void {
        self.disconnect();
        if (self.wsa_initialized) {
            _ = WSACleanup();
            self.wsa_initialized = false;
        }
    }

    pub fn tryConnect(self: *WsClient) bool {
        if (self.state != .disconnected) return self.state == .connected;

        self.sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (self.sock == INVALID_SOCKET) {
            log.print("ws: socket() failed");
            return false;
        }

        // Parse IP from host string
        const ip = parseIp(self.host[0..self.host_len]) orelse {
            log.print("ws: invalid IP");
            _ = closesocket(self.sock);
            self.sock = INVALID_SOCKET;
            return false;
        };

        var addr = SockaddrIn{
            .sin_family = AF_INET,
            .sin_port = htons(self.port),
            .sin_addr = ip,
        };

        if (connect(self.sock, &addr, @sizeOf(SockaddrIn)) == SOCKET_ERROR) {
            log.print("ws: connect() failed");
            _ = closesocket(self.sock);
            self.sock = INVALID_SOCKET;
            return false;
        }

        // Set non-blocking
        var mode: c_ulong = 1;
        _ = ioctlsocket(self.sock, FIONBIO, &mode);

        self.state = .connecting;
        self.handshake_sent = false;
        self.handshake_done = false;
        self.recv_len = 0;
        self.frame_len = 0;

        // Send WS upgrade request
        self.sendHandshake();
        return false;
    }

    fn sendHandshake(self: *WsClient) void {
        // Minimal WebSocket upgrade request
        var buf: [512]u8 = undefined;
        const req = writeHandshakeRequest(&buf, self.host[0..self.host_len], self.port);
        const n = send(self.sock, req.ptr, @intCast(req.len), 0);
        if (n == SOCKET_ERROR) {
            log.print("ws: handshake send failed");
            self.disconnect();
            return;
        }
        self.handshake_sent = true;
    }

    /// Call once per tick to drive the connection state machine.
    /// Returns a received message if one is ready, null otherwise.
    pub fn poll(self: *WsClient) ?WsMessage {
        switch (self.state) {
            .disconnected => {
                if (self.reconnect_ticks > 0) {
                    self.reconnect_ticks -= 1;
                    return null;
                }
                if (!self.tryConnect()) {
                    // Back off on failed connect
                    self.reconnect_ticks = self.reconnect_delay;
                    if (self.reconnect_delay < 600) // cap at ~10 seconds
                        self.reconnect_delay *= 2;
                }
                return null;
            },
            .connecting => {
                // Check for handshake response
                const n = self.recvSome();
                if (n <= 0) return null;

                if (self.checkHandshakeResponse()) {
                    self.state = .connected;
                    self.handshake_done = true;
                    self.reconnect_delay = 60; // reset backoff
                    // connected
                    return null;
                }
                return null;
            },
            .connected => {
                const n = self.recvSome();
                if (n < 0) {
                    self.disconnect();
                    return null;
                }
                return self.tryReadFrame();
            },
            .closing => {
                self.disconnect();
                return null;
            },
        }
    }

    pub fn sendText(self: *WsClient, data: []const u8) bool {
        if (self.state != .connected) return false;
        return self.sendFrame(WS_TEXT, data);
    }

    pub fn sendBinary(self: *WsClient, data: []const u8) bool {
        if (self.state != .connected) return false;
        return self.sendFrame(WS_BINARY, data);
    }

    pub fn disconnect(self: *WsClient) void {
        if (self.sock != INVALID_SOCKET) {
            _ = closesocket(self.sock);
            self.sock = INVALID_SOCKET;
        }
        if (self.state == .connected) {
            log.print("ws: disconnected");
        }
        self.state = .disconnected;
        self.recv_len = 0;
        self.frame_len = 0;
        self.handshake_sent = false;
        self.handshake_done = false;
    }

    pub fn isConnected(self: *WsClient) bool {
        return self.state == .connected;
    }

    // ── Internal ──────────────────────────────────────────────────────

    fn recvSome(self: *WsClient) c_int {
        if (self.recv_len >= self.recv_buf.len) return 0;

        // Non-blocking select with zero timeout
        var read_fds = FdSet{ .fd_count = 1, .fd_array = .{0} ** 64 };
        read_fds.fd_array[0] = self.sock;
        var tv = Timeval{ .tv_sec = 0, .tv_usec = 0 };
        const sel = select(0, &read_fds, null, null, &tv);
        if (sel <= 0) return 0;

        const space = self.recv_buf.len - self.recv_len;
        const n = recv(self.sock, @ptrCast(self.recv_buf[self.recv_len..].ptr), @intCast(space), 0);
        if (n == 0) {
            // Connection closed
            return -1;
        }
        if (n == SOCKET_ERROR) {
            const err = WSAGetLastError();
            if (err == WSAEWOULDBLOCK) return 0;
            return -1;
        }
        self.recv_len += @intCast(n);
        return n;
    }

    fn checkHandshakeResponse(self: *WsClient) bool {
        // Look for the end of HTTP response headers
        const data = self.recv_buf[0..self.recv_len];
        const end = findSubstring(data, "\r\n\r\n") orelse return false;

        // Check for "101 Switching Protocols"
        if (findSubstring(data[0..end], "101") == null) {
            log.print("ws: handshake rejected");
            self.disconnect();
            return false;
        }

        // Consume the handshake from recv_buf
        const consumed = end + 4;
        const remaining = self.recv_len - consumed;
        if (remaining > 0) {
            std.mem.copyForwards(u8, self.recv_buf[0..remaining], self.recv_buf[consumed..self.recv_len]);
        }
        self.recv_len = remaining;
        return true;
    }

    fn tryReadFrame(self: *WsClient) ?WsMessage {
        if (self.recv_len < 2) return null;

        const b0 = self.recv_buf[0];
        const b1 = self.recv_buf[1];
        const opcode = b0 & 0x0F;
        const masked = (b1 & 0x80) != 0;
        var payload_len: usize = b1 & 0x7F;
        var header_len: usize = 2;

        if (payload_len == 126) {
            if (self.recv_len < 4) return null;
            payload_len = (@as(usize, self.recv_buf[2]) << 8) | self.recv_buf[3];
            header_len = 4;
        } else if (payload_len == 127) {
            if (self.recv_len < 10) return null;
            // 64-bit length — we only support up to frame_buf size
            payload_len = 0;
            for (2..10) |i| {
                payload_len = (payload_len << 8) | self.recv_buf[i];
            }
            header_len = 10;
        }

        if (masked) header_len += 4; // mask key

        const total = header_len + payload_len;
        if (self.recv_len < total) return null;
        if (payload_len > self.frame_buf.len) {
            // Frame too large, skip it
            self.consumeRecv(total);
            return null;
        }

        // Copy payload, unmask if needed
        const payload_start = header_len;
        @memcpy(self.frame_buf[0..payload_len], self.recv_buf[payload_start .. payload_start + payload_len]);

        if (masked) {
            const mask_start = header_len - 4;
            const mask = self.recv_buf[mask_start .. mask_start + 4];
            for (0..payload_len) |i| {
                self.frame_buf[i] ^= mask[i % 4];
            }
        }

        self.consumeRecv(total);

        // Handle control frames
        if (opcode == WS_PING) {
            _ = self.sendFrame(WS_PONG, self.frame_buf[0..payload_len]);
            return null;
        }
        if (opcode == WS_CLOSE) {
            self.state = .closing;
            return null;
        }

        self.frame_len = payload_len;
        return WsMessage{
            .data = self.frame_buf[0..payload_len],
            .opcode = opcode,
        };
    }

    fn sendFrame(self: *WsClient, opcode: u8, data: []const u8) bool {
        // Client frames must be masked (RFC 6455)
        var header: [14]u8 = undefined;
        var hlen: usize = 2;
        header[0] = 0x80 | opcode; // FIN + opcode

        if (data.len < 126) {
            header[1] = 0x80 | @as(u8, @intCast(data.len));
        } else if (data.len <= 65535) {
            header[1] = 0x80 | 126;
            header[2] = @intCast(data.len >> 8);
            header[3] = @intCast(data.len & 0xFF);
            hlen = 4;
        } else {
            header[1] = 0x80 | 127;
            var len = data.len;
            var i: usize = 9;
            while (i >= 2) : (i -= 1) {
                header[i] = @intCast(len & 0xFF);
                len >>= 8;
            }
            hlen = 10;
        }

        // Mask key (use a simple deterministic mask — not security-critical)
        const mask = [4]u8{ 0x37, 0xFA, 0x21, 0x3D };
        header[hlen] = mask[0];
        header[hlen + 1] = mask[1];
        header[hlen + 2] = mask[2];
        header[hlen + 3] = mask[3];
        hlen += 4;

        // Send header
        if (!self.sendAll(header[0..hlen])) return false;

        // Send masked payload
        if (data.len > 0) {
            // Mask in-place into frame_buf, then send
            const chunk_size = @min(data.len, self.frame_buf.len);
            var offset: usize = 0;
            while (offset < data.len) {
                const end = @min(offset + chunk_size, data.len);
                const n = end - offset;
                @memcpy(self.frame_buf[0..n], data[offset..end]);
                for (0..n) |j| {
                    self.frame_buf[j] ^= mask[(offset + j) % 4];
                }
                if (!self.sendAll(self.frame_buf[0..n])) return false;
                offset = end;
            }
        }
        return true;
    }

    fn sendAll(self: *WsClient, data: []const u8) bool {
        var sent: usize = 0;
        while (sent < data.len) {
            const n = send(self.sock, @ptrCast(data[sent..].ptr), @intCast(data.len - sent), 0);
            if (n == SOCKET_ERROR) return false;
            if (n == 0) return false;
            sent += @intCast(n);
        }
        return true;
    }

    fn consumeRecv(self: *WsClient, n: usize) void {
        const remaining = self.recv_len - n;
        if (remaining > 0) {
            std.mem.copyForwards(u8, self.recv_buf[0..remaining], self.recv_buf[n..self.recv_len]);
        }
        self.recv_len = remaining;
    }
};

// ── Helpers ──────────────────────────────────────────────────────────

fn writeHandshakeRequest(buf: *[512]u8, host: []const u8, port: u16) []const u8 {
    // GET / HTTP/1.1\r\nHost: <host>:<port>\r\nUpgrade: websocket\r\n
    // Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n
    // Sec-WebSocket-Version: 13\r\n\r\n
    var pos: usize = 0;
    const parts = [_][]const u8{
        "GET / HTTP/1.1\r\nHost: ",
        host,
        ":",
        portStr(port),
        "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
    };
    for (parts) |part| {
        @memcpy(buf[pos .. pos + part.len], part);
        pos += part.len;
    }
    return buf[0..pos];
}

fn portStr(port: u16) []const u8 {
    const digits = "0123456789";
    const S = struct {
        var buf: [5]u8 = undefined;
    };
    var p = port;
    var i: usize = 5;
    while (i > 0) {
        i -= 1;
        S.buf[i] = digits[p % 10];
        p /= 10;
        if (p == 0) return S.buf[i..5];
    }
    return S.buf[0..5];
}

fn parseIp(s: []const u8) ?u32 {
    var parts: [4]u8 = undefined;
    var part_idx: usize = 0;
    var val: u16 = 0;
    var has_digit = false;

    for (s) |ch| {
        if (ch == '.') {
            if (!has_digit or part_idx >= 3) return null;
            if (val > 255) return null;
            parts[part_idx] = @intCast(val);
            part_idx += 1;
            val = 0;
            has_digit = false;
        } else if (ch >= '0' and ch <= '9') {
            val = val * 10 + (ch - '0');
            has_digit = true;
        } else {
            return null;
        }
    }
    if (!has_digit or part_idx != 3 or val > 255) return null;
    parts[3] = @intCast(val);

    return @as(u32, parts[0]) | (@as(u32, parts[1]) << 8) | (@as(u32, parts[2]) << 16) | (@as(u32, parts[3]) << 24);
}

fn htons(val: u16) u16 {
    return @byteSwap(val);
}

fn findSubstring(haystack: []const u8, needle: []const u8) ?usize {
    if (needle.len > haystack.len) return null;
    var i: usize = 0;
    while (i <= haystack.len - needle.len) : (i += 1) {
        if (std.mem.eql(u8, haystack[i .. i + needle.len], needle)) return i;
    }
    return null;
}
