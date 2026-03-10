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
