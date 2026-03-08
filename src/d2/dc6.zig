const std = @import("std");

const DWORD = u32;

// Win32 for allocation
extern "kernel32" fn VirtualAlloc(addr: ?*anyopaque, size: usize, alloc_type: DWORD, protect: DWORD) callconv(.winapi) ?[*]u8;
const MEM_COMMIT: DWORD = 0x1000;
const MEM_RESERVE: DWORD = 0x2000;
const PAGE_READWRITE: DWORD = 0x04;

pub const DC6Header = extern struct {
    nVersion: u32, // 6
    dwFlags: u32, // 1
    dwEncoding: u32, // 0
    dwTermination: u32, // 0xEEEEEEEE
    dwDirections: u32, // 1
    dwFramesPerDir: u32,
};

pub const DC6FrameHeader = extern struct {
    dwFlip: u32,
    dwWidth: u32,
    dwHeight: u32,
    nOffsetX: i32,
    nOffsetY: i32,
    dwUnknown: u32,
    dwNextBlock: u32,
    dwLength: u32,
};

pub const DecodedFrame = struct {
    pixels: []u8,
    width: u32,
    height: u32,
};

/// Decode a single frame from raw DC6 data in memory.
/// Returns pixel buffer in top-to-bottom row order, palette-indexed.
/// Caller does NOT free the returned pixels (VirtualAlloc'd, lives forever).
pub fn decodeFrame(dc6_data: [*]const u8, frame_idx: u32) ?DecodedFrame {
    const header: *const DC6Header = @ptrCast(@alignCast(dc6_data));
    if (header.nVersion != 6) return null;

    const total_frames = header.dwDirections * header.dwFramesPerDir;
    if (frame_idx >= total_frames) return null;

    // In-memory DC6: the "offset table" after the header contains absolute pointers
    // to frame data (NOT file-relative offsets). The game transforms them on load.
    const offsets_base = dc6_data + @sizeOf(DC6Header);
    const off_pos = offsets_base + frame_idx * 4;
    const frame_addr = readU32(off_pos);

    // Sanity check: must be a valid heap/data pointer (above 0x10000)
    if (frame_addr < 0x10000) return null;

    const frame_ptr: [*]const u8 = @ptrFromInt(frame_addr);
    // Read frame header fields byte-by-byte (may be unaligned)
    const w = readU32(frame_ptr + 4); // dwWidth
    const h = readU32(frame_ptr + 8); // dwHeight
    const rle_length = readU32(frame_ptr + 28); // dwLength

    if (w == 0 or h == 0 or w > 4096 or h > 4096) return null;

    const pixel_count = w * h;
    const pixels = VirtualAlloc(null, pixel_count, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE) orelse return null;

    // RLE data follows the 32-byte frame header
    const rle_data = frame_ptr + 32; // @sizeOf(DC6FrameHeader)

    // Decode bottom-to-top scanlines
    var y: u32 = h;
    var x: u32 = 0;
    var pos: u32 = 0;

    while (pos < rle_length) {
        const b = rle_data[pos];
        pos += 1;

        if (b == 0x80) {
            // End of scanline
            if (y == 0) break;
            y -= 1;
            x = 0;
        } else if (b < 0x80) {
            // b raw pixel bytes
            const count: u32 = b;
            const row = if (y > 0) y - 1 else 0;
            var i: u32 = 0;
            while (i < count and pos < rle_length) : (i += 1) {
                if (x + i < w and row < h) {
                    pixels[row * w + x + i] = rle_data[pos];
                }
                pos += 1;
            }
            x += count;
        } else {
            // (b & 0x7F) transparent pixels
            x += @as(u32, b & 0x7F);
        }
    }

    return DecodedFrame{
        .pixels = pixels[0..pixel_count],
        .width = w,
        .height = h,
    };
}

/// Encode a single pixel buffer as a complete DC6 file (1 direction, 1 frame).
/// Returns a slice of the encoded bytes (VirtualAlloc'd).
pub fn encodeSingleFrame(pixels: []const u8, w: u32, h: u32) ?[]u8 {
    return encodeMultiFrame(&[_]FrameInput{.{ .pixels = pixels, .width = w, .height = h }});
}

pub const FrameInput = struct {
    pixels: []const u8,
    width: u32,
    height: u32,
};

/// Encode multiple frames as a complete DC6 file (1 direction, N frames).
pub fn encodeMultiFrame(frames: []const FrameInput) ?[]u8 {
    const n_frames: u32 = @intCast(frames.len);
    if (n_frames == 0) return null;

    // Allocate generous output buffer
    const max_size: usize = 65536;
    const buf = VirtualAlloc(null, max_size, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE) orelse return null;

    var pos: usize = 0;

    // DC6 header (24 bytes)
    const header = DC6Header{
        .nVersion = 6,
        .dwFlags = 1,
        .dwEncoding = 0,
        .dwTermination = 0xEEEEEEEE,
        .dwDirections = 1,
        .dwFramesPerDir = n_frames,
    };
    writeAt(buf, &pos, std.mem.asBytes(&header));

    // Reserve space for frame offset table (n_frames × 4 bytes)
    const offsets_pos = pos;
    pos += n_frames * 4;

    // Encode each frame
    for (frames, 0..) |frame, fi| {
        // Write frame offset
        const frame_offset: u32 = @intCast(pos);
        const off_bytes = std.mem.asBytes(&frame_offset);
        @memcpy(buf[offsets_pos + fi * 4 ..][0..4], off_bytes);

        // Encode RLE data into a temp area to get length
        const rle_start = pos + @sizeOf(DC6FrameHeader);
        var rle_pos: usize = rle_start;

        // Encode bottom-to-top
        var y: u32 = frame.height;
        while (y > 0) {
            y -= 1;
            const row = frame.pixels[y * frame.width ..][0..frame.width];
            var x: u32 = 0;

            while (x < frame.width) {
                // Count transparent pixels
                var trans: u32 = 0;
                while (x + trans < frame.width and row[x + trans] == 0) : (trans += 1) {}

                if (trans > 0) {
                    // Emit transparent runs (max 127 per byte)
                    var remaining = trans;
                    while (remaining > 0) {
                        const chunk: u8 = @intCast(@min(remaining, 127));
                        if (rle_pos < max_size) {
                            buf[rle_pos] = 0x80 | chunk;
                            rle_pos += 1;
                        }
                        remaining -= chunk;
                    }
                    x += trans;
                    continue;
                }

                // Count opaque pixels (max 127)
                var solid: u32 = 0;
                while (x + solid < frame.width and row[x + solid] != 0 and solid < 127) : (solid += 1) {}

                if (solid > 0) {
                    if (rle_pos < max_size) {
                        buf[rle_pos] = @intCast(solid);
                        rle_pos += 1;
                    }
                    var i: u32 = 0;
                    while (i < solid) : (i += 1) {
                        if (rle_pos < max_size) {
                            buf[rle_pos] = row[x + i];
                            rle_pos += 1;
                        }
                    }
                    x += solid;
                }
            }

            // End of line
            if (rle_pos < max_size) {
                buf[rle_pos] = 0x80;
                rle_pos += 1;
            }
        }

        const rle_length: u32 = @intCast(rle_pos - rle_start);

        // Write frame header at pos
        const fh = DC6FrameHeader{
            .dwFlip = 0,
            .dwWidth = frame.width,
            .dwHeight = frame.height,
            .nOffsetX = 0,
            .nOffsetY = @intCast(frame.height),
            .dwUnknown = 0,
            .dwNextBlock = 0,
            .dwLength = rle_length,
        };
        writeAt(buf, &pos, std.mem.asBytes(&fh));

        // Advance past RLE data (already written)
        pos = rle_pos;
    }

    return buf[0..pos];
}

pub fn readU32Pub(ptr: [*]const u8) u32 {
    return readU32(ptr);
}

fn readU32(ptr: [*]const u8) u32 {
    return @as(u32, ptr[0]) |
        (@as(u32, ptr[1]) << 8) |
        (@as(u32, ptr[2]) << 16) |
        (@as(u32, ptr[3]) << 24);
}

fn writeAt(buf: [*]u8, pos: *usize, data: []const u8) void {
    @memcpy(buf[pos.*..][0..data.len], data);
    pos.* += data.len;
}
