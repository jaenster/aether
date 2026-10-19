const std = @import("std");

/// Minimal JSON string extraction — not a full parser.
/// Finds the value of a string field by key in a JSON object.
pub fn getString(json: []const u8, key: []const u8) ?[]const u8 {
    // Find "key": "value" pattern
    var i: usize = 0;
    while (i < json.len) : (i += 1) {
        // Look for the key
        if (json[i] == '"') {
            const key_start = i + 1;
            const key_end = findClosingQuote(json, key_start) orelse continue;
            if (key_end - key_start == key.len and std.mem.eql(u8, json[key_start..key_end], key)) {
                // Skip to colon then value
                var j = key_end + 1;
                while (j < json.len and (json[j] == ' ' or json[j] == ':' or json[j] == '\t' or json[j] == '\n' or json[j] == '\r')) : (j += 1) {}
                if (j < json.len and json[j] == '"') {
                    const val_start = j + 1;
                    const val_end = findClosingQuote(json, val_start) orelse continue;
                    return json[val_start..val_end];
                }
            }
            i = key_end;
        }
    }
    return null;
}

/// Check if a JSON object has a string field with the given value.
pub fn hasStringValue(json: []const u8, key: []const u8, value: []const u8) bool {
    const v = getString(json, key) orelse return false;
    return std.mem.eql(u8, v, value);
}

/// Iterate over elements of a JSON array field.
/// Returns an iterator that yields slices of each array element (object or primitive).
pub const ArrayIterator = struct {
    data: []const u8,
    pos: usize,

    pub fn next(self: *ArrayIterator) ?[]const u8 {
        // Skip whitespace and commas
        while (self.pos < self.data.len) {
            const ch = self.data[self.pos];
            if (ch == ']') return null;
            if (ch == ' ' or ch == '\t' or ch == '\n' or ch == '\r' or ch == ',') {
                self.pos += 1;
                continue;
            }
            break;
        }
        if (self.pos >= self.data.len) return null;

        if (self.data[self.pos] == '{') {
            return self.readObject();
        } else if (self.data[self.pos] == '"') {
            const start = self.pos;
            self.pos += 1;
            const end = findClosingQuote(self.data, self.pos) orelse return null;
            self.pos = end + 1;
            return self.data[start .. end + 1];
        } else {
            // Number or other literal
            const start = self.pos;
            while (self.pos < self.data.len and self.data[self.pos] != ',' and self.data[self.pos] != ']') {
                self.pos += 1;
            }
            return self.data[start..self.pos];
        }
    }

    fn readObject(self: *ArrayIterator) ?[]const u8 {
        const start = self.pos;
        var depth: usize = 0;
        var in_string = false;
        while (self.pos < self.data.len) {
            const ch = self.data[self.pos];
            if (in_string) {
                if (ch == '\\') {
                    self.pos += 1; // skip escaped char
                } else if (ch == '"') {
                    in_string = false;
                }
            } else {
                if (ch == '"') {
                    in_string = true;
                } else if (ch == '{') {
                    depth += 1;
                } else if (ch == '}') {
                    depth -= 1;
                    if (depth == 0) {
                        self.pos += 1;
                        return self.data[start..self.pos];
                    }
                }
            }
            self.pos += 1;
        }
        return null;
    }
};

/// Find the start of a JSON array field and return an iterator over its elements.
pub fn getArray(json: []const u8, key: []const u8) ?ArrayIterator {
    var i: usize = 0;
    while (i < json.len) : (i += 1) {
        if (json[i] == '"') {
            const key_start = i + 1;
            const key_end = findClosingQuote(json, key_start) orelse {
                i = key_start;
                continue;
            };
            if (key_end - key_start == key.len and std.mem.eql(u8, json[key_start..key_end], key)) {
                // Skip to colon then value
                var j = key_end + 1;
                while (j < json.len and (json[j] == ' ' or json[j] == ':' or json[j] == '\t' or json[j] == '\n' or json[j] == '\r')) : (j += 1) {}
                if (j < json.len and json[j] == '[') {
                    return ArrayIterator{ .data = json, .pos = j + 1 };
                }
            }
            i = key_end;
        }
    }
    return null;
}

/// Extract a string value with JSON escape decoding.
/// For now handles \\, \", \n, \t, \r, \/ — enough for JS source code.
/// Returns the decoded string written into the provided buffer.
pub fn decodeString(json_str: []const u8, buf: []u8) ?[]const u8 {
    var out: usize = 0;
    var i: usize = 0;
    while (i < json_str.len) {
        if (out >= buf.len) return null;
        if (json_str[i] == '\\' and i + 1 < json_str.len) {
            const next = json_str[i + 1];
            switch (next) {
                'n' => {
                    buf[out] = '\n';
                    out += 1;
                    i += 2;
                },
                'r' => {
                    buf[out] = '\r';
                    out += 1;
                    i += 2;
                },
                't' => {
                    buf[out] = '\t';
                    out += 1;
                    i += 2;
                },
                '\\' => {
                    buf[out] = '\\';
                    out += 1;
                    i += 2;
                },
                '"' => {
                    buf[out] = '"';
                    out += 1;
                    i += 2;
                },
                '/' => {
                    buf[out] = '/';
                    out += 1;
                    i += 2;
                },
                'b' => {
                    buf[out] = 0x08;
                    out += 1;
                    i += 2;
                },
                'f' => {
                    buf[out] = 0x0C;
                    out += 1;
                    i += 2;
                },
                'u' => {
                    // \uXXXX as UTF-8. A surrogate half becomes U+FFFD.
                    if (i + 6 > json_str.len) return null;
                    const cp = std.fmt.parseInt(u21, json_str[i + 2 .. i + 6], 16) catch return null;
                    const ch: u21 = if (cp >= 0xD800 and cp <= 0xDFFF) 0xFFFD else cp;
                    var enc: [4]u8 = undefined;
                    const n = std.unicode.utf8Encode(ch, &enc) catch return null;
                    if (out + n > buf.len) return null;
                    @memcpy(buf[out .. out + n], enc[0..n]);
                    out += n;
                    i += 6;
                },
                else => {
                    buf[out] = json_str[i];
                    out += 1;
                    i += 1;
                },
            }
        } else {
            buf[out] = json_str[i];
            out += 1;
            i += 1;
        }
    }
    return buf[0..out];
}

fn findClosingQuote(data: []const u8, start: usize) ?usize {
    var i = start;
    while (i < data.len) {
        if (data[i] == '\\') {
            i += 2; // skip escaped char
            continue;
        }
        if (data[i] == '"') return i;
        i += 1;
    }
    return null;
}

/// Append `s` as a JSON string literal, quotes included. Bytes >= 0x80 pass
/// through as they are (the game's strings are UTF-8 or Latin-1; the daemon
/// reads both).
pub fn appendString(out: *std.ArrayList(u8), gpa: std.mem.Allocator, s: []const u8) !void {
    try out.append(gpa, '"');
    for (s) |ch| {
        switch (ch) {
            '"' => try out.appendSlice(gpa, "\\\""),
            '\\' => try out.appendSlice(gpa, "\\\\"),
            '\n' => try out.appendSlice(gpa, "\\n"),
            '\r' => try out.appendSlice(gpa, "\\r"),
            '\t' => try out.appendSlice(gpa, "\\t"),
            0...8, 11, 12, 14...0x1F, 0x7F => {
                var b: [6]u8 = undefined;
                _ = std.fmt.bufPrint(&b, "\\u{x:0>4}", .{ch}) catch unreachable;
                try out.appendSlice(gpa, &b);
            },
            else => try out.append(gpa, ch),
        }
    }
    try out.append(gpa, '"');
}

test "appendString escapes what JSON requires and decodeString reads it back" {
    const gpa = std.testing.allocator;
    var out: std.ArrayList(u8) = .empty;
    defer out.deinit(gpa);
    const src = "a\"b\\c\nd\te\x01f\x7f";
    try appendString(&out, gpa, src);
    try std.testing.expectEqualStrings("\"a\\\"b\\\\c\\nd\\te\\u0001f\\u007f\"", out.items);
    var buf: [64]u8 = undefined;
    const back = decodeString(out.items[1 .. out.items.len - 1], &buf).?;
    try std.testing.expectEqualStrings(src, back);
}

test "decodeString reads \\u escapes as UTF-8" {
    var buf: [16]u8 = undefined;
    try std.testing.expectEqualStrings("\xc3\xa9!", decodeString("\\u00e9!", &buf).?);
    try std.testing.expectEqualStrings("\xef\xbf\xbd", decodeString("\\ud83d", &buf).?);
}

test "getString finds an eval request's code" {
    const msg = "{\"type\":\"eval\",\"id\":\"7\",\"code\":\"getArea() + \\\"x\\\"\"}";
    try std.testing.expect(hasStringValue(msg, "type", "eval"));
    try std.testing.expectEqualStrings("7", getString(msg, "id").?);
    var buf: [64]u8 = undefined;
    try std.testing.expectEqualStrings("getArea() + \"x\"", decodeString(getString(msg, "code").?, &buf).?);
}
