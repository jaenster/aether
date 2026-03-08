const dc6 = @import("dc6.zig");
const log = @import("../log.zig");

const DWORD = u32;

extern "kernel32" fn VirtualAlloc(addr: ?*anyopaque, size: usize, alloc_type: DWORD, protect: DWORD) callconv(.winapi) ?[*]u8;
const MEM_COMMIT: DWORD = 0x1000;
const MEM_RESERVE: DWORD = 0x2000;
const PAGE_READWRITE: DWORD = 0x04;

// Font cache: 14 entries × 20 bytes, starting at 0x841DA8
const FONT_CACHE_ADDR: usize = 0x841DA8;
const FONT_CACHE_ENTRY_SIZE: usize = 20;
const GLYPH_ENTRY_SIZE: usize = 14; // 0xE

/// Result of rendering a text string to a pixel buffer.
pub const TextBitmap = struct {
    pixels: []u8, // palette-indexed, width * height
    width: u32,
    height: u32,
};

/// Font cache entry layout (20 bytes):
///   +0x00: DC6*           pFontDC6
///   +0x04: void*          pFontTable (raw TBL malloc)
///   +0x08: D2ArchiveStrc* pFontArchive
///   +0x0C: u8*            szFontTablePath (glyph array base)
///   +0x10: u32            dwLRUTimestamp
const FontCacheEntry = struct {
    dc6_data: ?[*]const u8,
    glyph_base: ?[*]const u8,
    glyph_count: u16,

    fn read(font_index: u32) ?FontCacheEntry {
        if (font_index >= 14) return null;

        const entry_addr = FONT_CACHE_ADDR + font_index * FONT_CACHE_ENTRY_SIZE;

        const dc6_ptr: *const ?[*]const u8 = @ptrFromInt(entry_addr + 0x00);
        const archive_ptr: *const ?usize = @ptrFromInt(entry_addr + 0x08);
        const glyph_base_ptr: *const ?[*]const u8 = @ptrFromInt(entry_addr + 0x0C);

        const dc6_data = dc6_ptr.* orelse return null;
        const archive = archive_ptr.* orelse return null;
        const glyph_base = glyph_base_ptr.* orelse return null;

        // Glyph count at pFontArchive + 8 (u16)
        const count_ptr: *const u16 = @ptrFromInt(archive + 8);
        const count = count_ptr.*;

        if (count == 0) return null;

        // Validate DC6 header (only check version, termination varies)
        const dc6_header: *const dc6.DC6Header = @ptrCast(@alignCast(dc6_data));
        if (dc6_header.nVersion != 6) return null;

        return FontCacheEntry{
            .dc6_data = dc6_data,
            .glyph_base = glyph_base,
            .glyph_count = count,
        };
    }
};

/// Glyph entry layout (14 bytes):
///   +0x00: u16 charCode (binary search key)
///   +0x03: u8  advanceWidth
///   +0x08: u16 frameIndex
const GlyphInfo = struct {
    advance_width: u32,
    frame_index: u32,
};

/// Binary search for a glyph entry by char code.
fn lookupGlyph(glyph_base: [*]const u8, count: u16, char_code: u16) ?GlyphInfo {
    var lo: u16 = 0;
    var hi: u16 = count;

    while (lo < hi) {
        const mid = lo + (hi - lo) / 2;
        const entry = glyph_base + @as(usize, mid) * GLYPH_ENTRY_SIZE;
        const entry_code = @as(u16, entry[0]) | (@as(u16, entry[1]) << 8);

        if (entry_code == char_code) {
            return GlyphInfo{
                .advance_width = entry[3],
                .frame_index = @as(u16, entry[8]) | (@as(u16, entry[9]) << 8),
            };
        } else if (entry_code < char_code) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return null;
}

/// Quick check: get height of first glyph 'A' for a given font.
pub fn getGlyphHeight(font_index: u32) ?u32 {
    const cache = FontCacheEntry.read(font_index) orelse return null;
    const dc6_data = cache.dc6_data orelse return null;
    const glyph_base = cache.glyph_base orelse return null;
    const gi = lookupGlyph(glyph_base, cache.glyph_count, 'A') orelse return null;
    const frame = dc6.decodeFrame(dc6_data, gi.frame_index) orelse return null;
    return frame.height;
}

/// Read font cache and render ASCII text into a pixel buffer.
/// Font must have been loaded (via SetFont) before calling this.
pub fn renderText(font_index: u32, text: []const u8) ?TextBitmap {
    if (text.len == 0) return null;

    const cache = FontCacheEntry.read(font_index) orelse {
        log.print("font: cache entry null");
        return null;
    };

    const dc6_data = cache.dc6_data orelse return null;
    const glyph_base = cache.glyph_base orelse return null;

    log.hex("font: dc6_data=", @intFromPtr(dc6_data));
    log.hex("font: glyph_base=", @intFromPtr(glyph_base));
    log.hex("font: glyph_count=", cache.glyph_count);

    // Dump first 24 bytes of dc6_data to verify if it's raw DC6
    log.hex("font: dc6[0..3]=", @as(u32, @bitCast(dc6_data[0..4].*)));
    log.hex("font: dc6[4..7]=", @as(u32, @bitCast(dc6_data[4..8].*)));
    log.hex("font: dc6[8..11]=", @as(u32, @bitCast(dc6_data[8..12].*)));
    log.hex("font: dc6[12..15]=", @as(u32, @bitCast(dc6_data[12..16].*)));
    log.hex("font: dc6[16..19]=", @as(u32, @bitCast(dc6_data[16..20].*)));
    log.hex("font: dc6[20..23]=", @as(u32, @bitCast(dc6_data[20..24].*)));

    // Log first glyph entry char code for sanity
    if (cache.glyph_count > 0) {
        const first = @as(u16, glyph_base[0]) | (@as(u16, glyph_base[1]) << 8);
        log.hex("font: first_glyph_charcode=", first);
    }

    // First pass: measure total width and max height
    var total_width: u32 = 0;
    var max_height: u32 = 0;
    var found_count: u32 = 0;

    for (text) |ch| {
        const gi = lookupGlyph(glyph_base, cache.glyph_count, @as(u16, ch)) orelse continue;
        total_width += gi.advance_width;
        found_count += 1;

        if (max_height == 0) {
            if (dc6.decodeFrame(dc6_data, gi.frame_index)) |frame| {
                max_height = frame.height;
            }
        }
    }

    log.hex("font: found_glyphs=", found_count);
    log.hex("font: total_width=", total_width);
    log.hex("font: max_height=", max_height);

    if (total_width == 0 or max_height == 0) {
        log.print("font: zero dimensions");
        return null;
    }

    // Allocate pixel buffer (zeroed = transparent)
    const pixel_count = total_width * max_height;
    const pixels = VirtualAlloc(null, pixel_count, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE) orelse return null;

    // Second pass: blit each glyph
    var cursor_x: u32 = 0;
    for (text) |ch| {
        const gi = lookupGlyph(glyph_base, cache.glyph_count, @as(u16, ch)) orelse continue;

        if (dc6.decodeFrame(dc6_data, gi.frame_index)) |frame| {
            const blit_h = @min(frame.height, max_height);
            const blit_w = @min(frame.width, total_width -| cursor_x);

            var y: u32 = 0;
            while (y < blit_h) : (y += 1) {
                var x: u32 = 0;
                while (x < blit_w) : (x += 1) {
                    const src = frame.pixels[y * frame.width + x];
                    if (src != 0) {
                        pixels[(y * total_width) + cursor_x + x] = src;
                    }
                }
            }
        }

        cursor_x += gi.advance_width;
    }

    return TextBitmap{
        .pixels = pixels[0..pixel_count],
        .width = total_width,
        .height = max_height,
    };
}
