const std = @import("std");
const win = std.os.windows;
const WINAPI = win.WINAPI;
const log = @import("log.zig");
const symbols = @import("symbols.zig");

const DWORD = u32;
const LONG = i32;

const EXCEPTION_RECORD = extern struct {
    ExceptionCode: DWORD,
    ExceptionFlags: DWORD,
    ExceptionRecord: ?*EXCEPTION_RECORD,
    ExceptionAddress: ?*anyopaque,
    NumberParameters: DWORD,
    ExceptionInformation: [15]usize,
};

const FLOATING_SAVE_AREA = extern struct {
    ControlWord: DWORD,
    StatusWord: DWORD,
    TagWord: DWORD,
    ErrorOffset: DWORD,
    ErrorSelector: DWORD,
    DataOffset: DWORD,
    DataSelector: DWORD,
    RegisterArea: [80]u8,
    Cr0NpxState: DWORD,
};

const CONTEXT = extern struct {
    ContextFlags: DWORD,
    Dr0: DWORD,
    Dr1: DWORD,
    Dr2: DWORD,
    Dr3: DWORD,
    Dr6: DWORD,
    Dr7: DWORD,
    FloatSave: FLOATING_SAVE_AREA,
    SegGs: DWORD,
    SegFs: DWORD,
    SegEs: DWORD,
    SegDs: DWORD,
    Edi: DWORD,
    Esi: DWORD,
    Ebx: DWORD,
    Edx: DWORD,
    Ecx: DWORD,
    Eax: DWORD,
    Ebp: DWORD,
    Eip: DWORD,
    SegCs: DWORD,
    EFlags: DWORD,
    Esp: DWORD,
    SegSs: DWORD,
    ExtendedRegisters: [512]u8,
};

const EXCEPTION_POINTERS = extern struct {
    ExceptionRecord: *EXCEPTION_RECORD,
    ContextRecord: *CONTEXT,
};

const EXCEPTION_EXECUTE_HANDLER: LONG = 1;
const EXCEPTION_ACCESS_VIOLATION: DWORD = 0xC0000005;
const EXCEPTION_STACK_OVERFLOW: DWORD = 0xC00000FD;
const EXCEPTION_INT_DIVIDE_BY_ZERO: DWORD = 0xC0000094;
const EXCEPTION_ILLEGAL_INSTRUCTION: DWORD = 0xC000001D;
const EXCEPTION_PRIV_INSTRUCTION: DWORD = 0xC0000096;

const FilterFn = *const fn (*EXCEPTION_POINTERS) callconv(WINAPI) LONG;
extern "kernel32" fn SetUnhandledExceptionFilter(handler: ?FilterFn) callconv(WINAPI) ?FilterFn;
extern "kernel32" fn AddVectoredExceptionHandler(first: DWORD, handler: FilterFn) callconv(WINAPI) ?*anyopaque;
extern "kernel32" fn GetModuleHandleA(name: ?[*:0]const u8) callconv(WINAPI) ?*anyopaque;
extern "kernel32" fn ExitProcess(code: DWORD) callconv(WINAPI) noreturn;
extern "kernel32" fn ExitThread(code: DWORD) callconv(WINAPI) noreturn;
extern "kernel32" fn GetCurrentThreadId() callconv(WINAPI) DWORD;

const IMAGE_DOS_HEADER = extern struct {
    e_magic: u16,
    _pad: [29]u16,
    e_lfanew: i32,
};

const IMAGE_NT_HEADERS = extern struct {
    Signature: u32,
    FileHeader: IMAGE_FILE_HEADER,
    OptionalHeader: IMAGE_OPTIONAL_HEADER,
};

const IMAGE_FILE_HEADER = extern struct {
    Machine: u16,
    NumberOfSections: u16,
    TimeDateStamp: u32,
    PointerToSymbolTable: u32,
    NumberOfSymbols: u32,
    SizeOfOptionalHeader: u16,
    Characteristics: u16,
};

const IMAGE_OPTIONAL_HEADER = extern struct {
    Magic: u16,
    MajorLinkerVersion: u8,
    MinorLinkerVersion: u8,
    SizeOfCode: u32,
    SizeOfInitializedData: u32,
    SizeOfUninitializedData: u32,
    AddressOfEntryPoint: u32,
    BaseOfCode: u32,
    BaseOfData: u32,
    ImageBase: u32,
    SectionAlignment: u32,
    FileAlignment: u32,
    MajorOSVersion: u16,
    MinorOSVersion: u16,
    MajorImageVersion: u16,
    MinorImageVersion: u16,
    MajorSubsystemVersion: u16,
    MinorSubsystemVersion: u16,
    Win32VersionValue: u32,
    SizeOfImage: u32,
};

// Module memory ranges
var dll_base: usize = 0;
var dll_end: usize = 0;
var game_base: usize = 0;
var game_end: usize = 0;
var main_thread_id: DWORD = 0;

fn getModuleSize(base: usize) usize {
    const dos: *const IMAGE_DOS_HEADER = @ptrFromInt(base);
    if (dos.e_magic != 0x5A4D) return 0; // MZ
    const nt: *const IMAGE_NT_HEADERS = @ptrFromInt(base + @as(usize, @intCast(dos.e_lfanew)));
    return nt.OptionalHeader.SizeOfImage;
}

fn exceptionCodeName(code: DWORD) []const u8 {
    return switch (code) {
        EXCEPTION_ACCESS_VIOLATION => "ACCESS_VIOLATION",
        EXCEPTION_STACK_OVERFLOW => "STACK_OVERFLOW",
        EXCEPTION_INT_DIVIDE_BY_ZERO => "INT_DIVIDE_BY_ZERO",
        EXCEPTION_ILLEGAL_INSTRUCTION => "ILLEGAL_INSTRUCTION",
        EXCEPTION_PRIV_INSTRUCTION => "PRIV_INSTRUCTION",
        else => "UNKNOWN",
    };
}

// Format a hex u32 into buf, returns slice
fn fmtHex(val: usize, buf: *[8]u8) []const u8 {
    const digits = "0123456789ABCDEF";
    var v = val;
    var i: usize = 8;
    while (i > 0) {
        i -= 1;
        buf[i] = digits[v & 0xF];
        v >>= 4;
    }
    // Skip leading zeros
    var start: usize = 0;
    while (start < 7 and buf[start] == '0') start += 1;
    return buf[start..8];
}

// Classify an address as "FuncName+0xNN", "Aether+0xRVA", "Game+0xRVA", or raw hex
fn fmtAddr(addr: usize, out: []u8) []const u8 {
    var pos: usize = 0;
    var hexbuf: [8]u8 = undefined;

    if (dll_base != 0 and addr >= dll_base and addr < dll_end) {
        const label = "Aether+0x";
        @memcpy(out[pos..][0..label.len], label);
        pos += label.len;
        const h = fmtHex(addr - dll_base, &hexbuf);
        @memcpy(out[pos..][0..h.len], h);
        pos += h.len;
    } else if (game_base != 0 and addr >= game_base and addr < game_end) {
        // Try symbolic lookup first (symbols use absolute VA, same as Game.exe loaded at 0x400000)
        if (symbols.lookup(@intCast(addr))) |sym| {
            @memcpy(out[pos..][0..sym.name.len], sym.name);
            pos += sym.name.len;
            if (sym.offset != 0) {
                const plus = "+0x";
                @memcpy(out[pos..][0..plus.len], plus);
                pos += plus.len;
                const h = fmtHex(sym.offset, &hexbuf);
                @memcpy(out[pos..][0..h.len], h);
                pos += h.len;
            }
        } else {
            const label = "Game+0x";
            @memcpy(out[pos..][0..label.len], label);
            pos += label.len;
            const h = fmtHex(addr, &hexbuf);
            @memcpy(out[pos..][0..h.len], h);
            pos += h.len;
        }
    } else {
        const label = "0x";
        @memcpy(out[pos..][0..label.len], label);
        pos += label.len;
        const h = fmtHex(addr, &hexbuf);
        @memcpy(out[pos..][0..h.len], h);
        pos += h.len;
    }

    return out[0..pos];
}

// Build the full crash message into a buffer for both log and MessageBox
fn buildCrashMessage(info: *EXCEPTION_POINTERS, buf: []u8) []const u8 {
    var pos: usize = 0;

    const rec = info.ExceptionRecord;
    const ctx = info.ContextRecord;
    const code = rec.ExceptionCode;

    pos = appendStr(buf, pos, "=== AETHER CRASH ===\r\n");
    pos = appendStr(buf, pos, "Thread: 0x");
    pos = appendHex(buf, pos, GetCurrentThreadId());
    pos = appendStr(buf, pos, "\r\n");
    pos = appendStr(buf, pos, "Exception: ");
    pos = appendStr(buf, pos, exceptionCodeName(code));
    pos = appendStr(buf, pos, " (0x");
    pos = appendHex(buf, pos, code);
    pos = appendStr(buf, pos, ")\r\n");

    // EIP with symbol
    pos = appendStr(buf, pos, "EIP: ");
    var addr_buf: [64]u8 = undefined;
    pos = appendStr(buf, pos, fmtAddr(ctx.Eip, &addr_buf));
    pos = appendStr(buf, pos, "\r\n");

    if (code == EXCEPTION_ACCESS_VIOLATION and rec.NumberParameters >= 2) {
        const rw = rec.ExceptionInformation[0];
        const addr = rec.ExceptionInformation[1];
        pos = appendStr(buf, pos, if (rw == 0) "Read from: 0x" else "Write to: 0x");
        pos = appendHex(buf, pos, addr);
        pos = appendStr(buf, pos, "\r\n");
    }

    pos = appendStr(buf, pos, "\r\nRegisters:\r\n");
    pos = appendReg(buf, pos, "EAX=", ctx.Eax);
    pos = appendReg(buf, pos, " EBX=", ctx.Ebx);
    pos = appendReg(buf, pos, " ECX=", ctx.Ecx);
    pos = appendReg(buf, pos, " EDX=", ctx.Edx);
    pos = appendStr(buf, pos, "\r\n");
    pos = appendReg(buf, pos, "ESI=", ctx.Esi);
    pos = appendReg(buf, pos, " EDI=", ctx.Edi);
    pos = appendReg(buf, pos, " EBP=", ctx.Ebp);
    pos = appendReg(buf, pos, " ESP=", ctx.Esp);
    pos = appendStr(buf, pos, "\r\n");

    // Aether DLL range for reference
    pos = appendStr(buf, pos, "\r\nAether: 0x");
    pos = appendHex(buf, pos, dll_base);
    pos = appendStr(buf, pos, " - 0x");
    pos = appendHex(buf, pos, dll_end);
    pos = appendStr(buf, pos, "\r\n");

    // Stack trace
    pos = appendStr(buf, pos, "\r\nStack trace:\r\n");
    var ebp: usize = ctx.Ebp;
    var depth: usize = 0;
    while (ebp != 0 and depth < 16) : (depth += 1) {
        if (ebp < 0x10000 or ebp > 0x7FFFFFFF) break;
        const frame: [*]const usize = @ptrFromInt(ebp);
        const ret_addr = frame[1];
        if (ret_addr == 0) break;
        pos = appendStr(buf, pos, "  ");
        var frame_buf: [64]u8 = undefined;
        pos = appendStr(buf, pos, fmtAddr(ret_addr, &frame_buf));
        pos = appendStr(buf, pos, "\r\n");
        ebp = frame[0];
    }

    // Null terminate for MessageBox
    if (pos < buf.len) buf[pos] = 0;

    return buf[0..pos];
}

fn appendStr(buf: []u8, pos: usize, s: []const u8) usize {
    const end = @min(pos + s.len, buf.len);
    const n = end - pos;
    @memcpy(buf[pos..][0..n], s[0..n]);
    return end;
}

fn appendHex(buf: []u8, pos: usize, val: usize) usize {
    var hexbuf: [8]u8 = undefined;
    const h = fmtHex(val, &hexbuf);
    return appendStr(buf, pos, h);
}

fn appendReg(buf: []u8, pos: usize, label: []const u8, val: u32) usize {
    var p = appendStr(buf, pos, label);
    p = appendHex(buf, p, val);
    return p;
}

extern "user32" fn MessageBoxA(
    hwnd: ?*anyopaque,
    text: [*:0]const u8,
    caption: [*:0]const u8,
    typ: DWORD,
) callconv(WINAPI) c_int;

const MB_ICONERROR: DWORD = 0x10;
const MB_OK: DWORD = 0x0;

const EXCEPTION_CONTINUE_SEARCH: LONG = 0;

// Exceptions to ignore (not real crashes)
const EXCEPTION_BREAKPOINT: DWORD = 0x80000003;
const EXCEPTION_SINGLE_STEP: DWORD = 0x80000004;
const CPP_EXCEPTION: DWORD = 0xE06D7363; // MSVC C++ exception
const CLR_EXCEPTION: DWORD = 0xE0434352; // .NET CLR exception

fn isFatalException(code: DWORD) bool {
    return switch (code) {
        EXCEPTION_ACCESS_VIOLATION,
        EXCEPTION_STACK_OVERFLOW,
        EXCEPTION_INT_DIVIDE_BY_ZERO,
        EXCEPTION_ILLEGAL_INSTRUCTION,
        EXCEPTION_PRIV_INSTRUCTION,
        => true,
        else => false,
    };
}

fn handler(info: *EXCEPTION_POINTERS) callconv(WINAPI) LONG {
    const code = info.ExceptionRecord.ExceptionCode;

    // Let non-fatal exceptions pass through (breakpoints, C++ exceptions, etc)
    if (!isFatalException(code)) return EXCEPTION_CONTINUE_SEARCH;

    const tid = GetCurrentThreadId();

    // Non-main thread crash — log full details then kill the thread.
    if (tid != main_thread_id) {
        if (log.openLogHandle()) |handle| {
            var buf: [8]u8 = undefined;
            log.writeRawHandle(handle, "non-main thread crash (tid=0x");
            log.writeRawHandle(handle, fmtHex(tid, &buf));
            log.writeRawHandle(handle, " eip=0x");
            log.writeRawHandle(handle, fmtHex(info.ContextRecord.Eip, &buf));
            log.writeRawHandle(handle, " code=0x");
            log.writeRawHandle(handle, fmtHex(info.ExceptionRecord.ExceptionCode, &buf));
            if (info.ExceptionRecord.ExceptionCode == EXCEPTION_ACCESS_VIOLATION and info.ExceptionRecord.NumberParameters >= 2) {
                const rw = info.ExceptionRecord.ExceptionInformation[0];
                const addr = info.ExceptionRecord.ExceptionInformation[1];
                log.writeRawHandle(handle, if (rw == 0) " read=0x" else " write=0x");
                log.writeRawHandle(handle, fmtHex(addr, &buf));
            }
            log.writeRawHandle(handle, "), killing thread\r\n");
            log.closeHandle(handle);
        }
        ExitThread(1);
    }

    // Build crash message
    var msg_buf: [2048]u8 = undefined;
    const msg = buildCrashMessage(info, &msg_buf);

    // Log to file
    if (log.openLogHandle()) |handle| {
        log.writeRawHandle(handle, msg);
        log.closeHandle(handle);
    }

    // Kill the process — don't let the game's own crash handler run
    ExitProcess(1);
}

/// Walk the EBP chain from current frame and log a stack trace.
/// label: prefix string for the log line.
pub fn logStackTrace(label: []const u8) void {
    const h = log.openLogHandle() orelse return;
    defer log.closeHandle(h);

    log.writeRawHandle(h, label);
    log.writeRawHandle(h, " stack trace:\r\n");

    // Get current EBP
    var ebp: usize = @frameAddress();
    var depth: usize = 0;
    while (ebp != 0 and depth < 20) : (depth += 1) {
        if (ebp < 0x10000 or ebp > 0x7FFFFFFF) break;
        const frame: [*]const usize = @ptrFromInt(ebp);
        const ret_addr = frame[1];
        if (ret_addr == 0) break;
        log.writeRawHandle(h, "  ");
        var addr_buf: [64]u8 = undefined;
        log.writeRawHandle(h, fmtAddr(ret_addr, &addr_buf));
        log.writeRawHandle(h, "\r\n");
        ebp = frame[0];
    }
}

pub fn install() void {
    main_thread_id = GetCurrentThreadId();

    // Discover module ranges
    if (GetModuleHandleA("Aether")) |h| {
        dll_base = @intFromPtr(h);
        dll_end = dll_base + getModuleSize(dll_base);
    }
    if (GetModuleHandleA(null)) |h| {
        game_base = @intFromPtr(h);
        game_end = game_base + getModuleSize(game_base);
    }

    // Vectored handler runs BEFORE game's SEH — we get first crack at exceptions
    _ = AddVectoredExceptionHandler(1, &handler);
    log.print("crash handler: installed");
    log.hex("  Aether base: 0x", dll_base);
    log.hex("  Aether end:  0x", dll_end);
    log.hex("  Game base:   0x", game_base);
    log.hex("  Game end:    0x", game_end);
    log.hex("  Game symbols: ", symbols.symbolCount());
}
