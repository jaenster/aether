const std = @import("std");
const dc6 = @import("dc6.zig");
const font = @import("font.zig");
const log = @import("../log.zig");

const DWORD = u32;

extern "kernel32" fn VirtualAlloc(addr: ?*anyopaque, size: usize, alloc_type: DWORD, protect: DWORD) callconv(.winapi) ?[*]u8;
const MEM_COMMIT: DWORD = 0x1000;
const MEM_RESERVE: DWORD = 0x2000;
const PAGE_READWRITE: DWORD = 0x04;

/// Generate a CellFile (in-memory DC6) from text rendered with the given font.
/// Returns a pointer that can be stored in EscMenuItem.pMainDC6 / pSubDC6.
pub fn generateTextDC6(font_idx: u32, text: []const u8, name: []const u8) ?*anyopaque {
    _ = name;

    const bitmap = font.renderText(font_idx, text) orelse {
        log.print("dc6_gen: renderText failed");
        return null;
    };

    return buildCellFile(&[_]dc6.FrameInput{
        .{ .pixels = bitmap.pixels, .width = bitmap.width, .height = bitmap.height },
    });
}

/// Generate a 2-frame CellFile (for On/Off toggle display).
pub fn generateToggleDC6(font_idx: u32, off_text: []const u8, on_text: []const u8, name: []const u8) ?*anyopaque {
    _ = name;

    const off_bmp = font.renderText(font_idx, off_text) orelse return null;
    const on_bmp = font.renderText(font_idx, on_text) orelse return null;

    return buildCellFile(&[_]dc6.FrameInput{
        .{ .pixels = off_bmp.pixels, .width = off_bmp.width, .height = off_bmp.height },
        .{ .pixels = on_bmp.pixels, .width = on_bmp.width, .height = on_bmp.height },
    });
}

/// Build an in-memory CellFile matching D2's runtime format:
///   DC6Header (24 bytes) + u32[N] absolute pointers to frame data
///   Each frame: DC6FrameHeader (32 bytes) + RLE pixel data
pub fn buildCellFile(frames: []const dc6.FrameInput) ?*anyopaque {
    const n: u32 = @intCast(frames.len);
    if (n == 0) return null;

    // First, encode each frame's RLE data into separate buffers
    const max_frame_size: usize = 65536;

    var frame_bufs: [8]?[*]u8 = .{null} ** 8;
    var frame_sizes: [8]usize = .{0} ** 8;

    for (frames, 0..) |frame, fi| {
        const buf = VirtualAlloc(null, max_frame_size, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE) orelse return null;

        // Write frame header
        var pos: usize = 0;
        writeU32(buf, &pos, 0); // dwFlip
        writeU32(buf, &pos, frame.width); // dwWidth
        writeU32(buf, &pos, frame.height); // dwHeight
        writeU32(buf, &pos, 0); // nOffsetX
        writeU32(buf, &pos, @as(u32, @intCast(@as(i32, @intCast(frame.height))))); // nOffsetY
        writeU32(buf, &pos, 0); // dwUnknown
        writeU32(buf, &pos, 0); // dwNextBlock

        // Reserve dwLength slot, fill after encoding
        const len_pos = pos;
        pos += 4;

        // Encode RLE data bottom-to-top
        const rle_start = pos;
        var y: u32 = frame.height;
        while (y > 0) {
            y -= 1;
            const row = frame.pixels[y * frame.width ..][0..frame.width];
            var x: u32 = 0;

            while (x < frame.width) {
                var trans: u32 = 0;
                while (x + trans < frame.width and row[x + trans] == 0) : (trans += 1) {}

                if (trans > 0) {
                    var remaining = trans;
                    while (remaining > 0) {
                        const chunk: u8 = @intCast(@min(remaining, 127));
                        buf[pos] = 0x80 | chunk;
                        pos += 1;
                        remaining -= chunk;
                    }
                    x += trans;
                    continue;
                }

                var solid: u32 = 0;
                while (x + solid < frame.width and row[x + solid] != 0 and solid < 127) : (solid += 1) {}

                if (solid > 0) {
                    buf[pos] = @intCast(solid);
                    pos += 1;
                    var i: u32 = 0;
                    while (i < solid) : (i += 1) {
                        buf[pos] = row[x + i];
                        pos += 1;
                    }
                    x += solid;
                }
            }

            buf[pos] = 0x80; // EOL
            pos += 1;
        }

        // Fill in dwLength
        const rle_length: u32 = @intCast(pos - rle_start);
        writeU32At(buf, len_pos, rle_length);

        frame_bufs[fi] = buf;
        frame_sizes[fi] = pos;
    }

    // Now build the CellFile: header (24 bytes) + offset table (N × 4 bytes)
    const cellfile_size = @sizeOf(dc6.DC6Header) + n * 4;
    const cellfile = VirtualAlloc(null, cellfile_size, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE) orelse return null;

    // Write DC6 header
    var hpos: usize = 0;
    writeU32(cellfile, &hpos, 6); // nVersion
    writeU32(cellfile, &hpos, 1); // dwFlags
    writeU32(cellfile, &hpos, 0); // dwEncoding
    writeU32(cellfile, &hpos, 0xEEEEEEEE); // dwTermination
    writeU32(cellfile, &hpos, 1); // dwDirections
    writeU32(cellfile, &hpos, n); // dwFramesPerDir

    // Write absolute pointers to frame data
    for (0..n) |fi| {
        const ptr_val: u32 = @intFromPtr(frame_bufs[fi].?);
        writeU32(cellfile, &hpos, ptr_val);
    }

    log.hex("dc6_gen: cellfile at ", @intFromPtr(cellfile));
    for (0..n) |fi| {
        log.hex("dc6_gen: frame ptr=", @intFromPtr(frame_bufs[fi].?));
    }

    return @ptrCast(cellfile);
}

fn writeU32(buf: [*]u8, pos: *usize, val: u32) void {
    buf[pos.*] = @truncate(val);
    buf[pos.* + 1] = @truncate(val >> 8);
    buf[pos.* + 2] = @truncate(val >> 16);
    buf[pos.* + 3] = @truncate(val >> 24);
    pos.* += 4;
}

fn writeU32At(buf: [*]u8, pos: usize, val: u32) void {
    buf[pos] = @truncate(val);
    buf[pos + 1] = @truncate(val >> 8);
    buf[pos + 2] = @truncate(val >> 16);
    buf[pos + 3] = @truncate(val >> 24);
}
