/// Binary symbol table — zero comptime parsing.
///
/// Format (little-endian):
///   u32  entry_count
///   entry_count × { u32 addr, u32 string_offset }
///   string_table: null-terminated names
const raw = @embedFile("data/game_symbols.bin");

const header_size = 4;
const entry_size = 8;

fn readU32(offset: usize) u32 {
    return @as(*align(1) const u32, @ptrCast(raw.ptr + offset)).*;
}

const entry_count: usize = readU32(0);
const entries_start: usize = header_size;
const strings_start: usize = header_size + entry_count * entry_size;

fn entryAddr(i: usize) u32 {
    return readU32(entries_start + i * entry_size);
}

fn entryName(i: usize) []const u8 {
    const str_off = readU32(entries_start + i * entry_size + 4);
    const start = strings_start + str_off;
    var end = start;
    while (end < raw.len and raw[end] != 0) : (end += 1) {}
    return raw[start..end];
}

pub const LookupResult = struct {
    name: []const u8,
    offset: u32,
};

pub fn lookup(addr: u32) ?LookupResult {
    if (entry_count == 0) return null;
    if (addr < entryAddr(0)) return null;

    var lo: usize = 0;
    var hi: usize = entry_count;
    while (lo < hi) {
        const mid = lo + (hi - lo) / 2;
        if (entryAddr(mid) <= addr) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    const idx = lo - 1;
    return .{
        .name = entryName(idx),
        .offset = addr - entryAddr(idx),
    };
}

pub fn symbolCount() usize {
    return entry_count;
}
