const std = @import("std");
const win = std.os.windows;
const WINAPI = win.WINAPI;
const log = @import("../log.zig");
const patch = @import("../hook/patch.zig");

// D2CMP sprite cache — loads DC6 frames into pDC6Block
// __stdcall: all args on stack, callee cleans
const SPRITECACHE_GetOrLoadSprite: *const fn (pData: u32, nParam1: i32, nParam2: i32) callconv(WINAPI) i32 = @ptrFromInt(0x006001f0);

// Win32 types
const DWORD = u32;
const BYTE = u8;
const WORD = u16;
const BOOL = i32;
const HINSTANCE = *anyopaque;
const HWND = *anyopaque;
const HDC = *anyopaque;
const HGLRC = *anyopaque;
const RECT = extern struct { left: i32, top: i32, right: i32, bottom: i32 };
const POINT = extern struct { x: i32, y: i32 };
const LPPALETTEENTRY = *anyopaque;

// Calling convention — all renderer vtable entries are __fastcall
const CC = std.builtin.CallingConvention;
const fastcall = CC{ .x86_fastcall = .{} };

// Win32 GDI imports
extern "gdi32" fn SetPixelFormat(hdc: HDC, format: c_int, ppfd: *const PIXELFORMATDESCRIPTOR) callconv(WINAPI) BOOL;
extern "gdi32" fn ChoosePixelFormat(hdc: HDC, ppfd: *const PIXELFORMATDESCRIPTOR) callconv(WINAPI) c_int;
extern "gdi32" fn SwapBuffers(hdc: HDC) callconv(WINAPI) BOOL;

extern "user32" fn GetDC(hwnd: ?HWND) callconv(WINAPI) ?HDC;
extern "user32" fn ReleaseDC(hwnd: ?HWND, hdc: HDC) callconv(WINAPI) c_int;

extern "kernel32" fn GetCommandLineA() callconv(WINAPI) [*:0]const u8;

// WGL imports
extern "opengl32" fn wglCreateContext(hdc: HDC) callconv(WINAPI) ?HGLRC;
extern "opengl32" fn wglMakeCurrent(hdc: ?HDC, hglrc: ?HGLRC) callconv(WINAPI) BOOL;
extern "opengl32" fn wglDeleteContext(hglrc: HGLRC) callconv(WINAPI) BOOL;

// OpenGL imports
extern "opengl32" fn glViewport(x: c_int, y: c_int, width: c_int, height: c_int) callconv(WINAPI) void;
extern "opengl32" fn glMatrixMode(mode: c_uint) callconv(WINAPI) void;
extern "opengl32" fn glLoadIdentity() callconv(WINAPI) void;
extern "opengl32" fn glOrtho(left: f64, right: f64, bottom: f64, top: f64, near: f64, far: f64) callconv(WINAPI) void;
extern "opengl32" fn glClearColor(r: f32, g: f32, b: f32, a: f32) callconv(WINAPI) void;
extern "opengl32" fn glClear(mask: c_uint) callconv(WINAPI) void;
extern "opengl32" fn glEnable(cap: c_uint) callconv(WINAPI) void;
extern "opengl32" fn glDisable(cap: c_uint) callconv(WINAPI) void;
extern "opengl32" fn glBlendFunc(sfactor: c_uint, dfactor: c_uint) callconv(WINAPI) void;
extern "opengl32" fn glBegin(mode: c_uint) callconv(WINAPI) void;
extern "opengl32" fn glEnd() callconv(WINAPI) void;
extern "opengl32" fn glVertex2i(x: c_int, y: c_int) callconv(WINAPI) void;
extern "opengl32" fn glColor4f(r: f32, g: f32, b: f32, a: f32) callconv(WINAPI) void;
extern "opengl32" fn glColor4ub(r: u8, g: u8, b: u8, a: u8) callconv(WINAPI) void;
extern "opengl32" fn glLineWidth(width: f32) callconv(WINAPI) void;
extern "opengl32" fn glGenTextures(n: c_int, textures: *c_uint) callconv(WINAPI) void;
extern "opengl32" fn glDeleteTextures(n: c_int, textures: *const c_uint) callconv(WINAPI) void;
extern "opengl32" fn glBindTexture(target: c_uint, texture: c_uint) callconv(WINAPI) void;
extern "opengl32" fn glTexImage2D(target: c_uint, level: c_int, internalformat: c_int, width: c_int, height: c_int, border: c_int, format: c_uint, typ: c_uint, pixels: ?*const anyopaque) callconv(WINAPI) void;
extern "opengl32" fn glTexParameteri(target: c_uint, pname: c_uint, param: c_int) callconv(WINAPI) void;
extern "opengl32" fn glTexCoord2f(s: f32, t: f32) callconv(WINAPI) void;
extern "opengl32" fn glVertex2f(x: f32, y: f32) callconv(WINAPI) void;
extern "opengl32" fn glColor3f(r: f32, g: f32, b: f32) callconv(WINAPI) void;

const GL_PROJECTION: c_uint = 0x1701;
const GL_MODELVIEW: c_uint = 0x1700;
const GL_COLOR_BUFFER_BIT: c_uint = 0x4000;
const GL_BLEND: c_uint = 0x0BE2;
const GL_SRC_ALPHA: c_uint = 0x0302;
const GL_ONE_MINUS_SRC_ALPHA: c_uint = 0x0303;
const GL_LINES: c_uint = 0x0001;
const GL_QUADS: c_uint = 0x0007;
const GL_LINE_LOOP: c_uint = 0x0002;
const GL_TEXTURE_2D: c_uint = 0x0DE1;
const GL_RGBA: c_uint = 0x1908;
const GL_UNSIGNED_BYTE: c_uint = 0x1401;
const GL_TEXTURE_MIN_FILTER: c_uint = 0x2801;
const GL_TEXTURE_MAG_FILTER: c_uint = 0x2800;
const GL_NEAREST: c_int = 0x2600;
const GL_TEXTURE_WRAP_S: c_uint = 0x2802;
const GL_TEXTURE_WRAP_T: c_uint = 0x2803;
const GL_CLAMP_TO_EDGE: c_int = 0x812F;

const PFD_DRAW_TO_WINDOW: DWORD = 0x00000004;
const PFD_SUPPORT_OPENGL: DWORD = 0x00000020;
const PFD_DOUBLEBUFFER: DWORD = 0x00000001;
const PFD_TYPE_RGBA: BYTE = 0;
const PFD_MAIN_PLANE: BYTE = 0;

const PIXELFORMATDESCRIPTOR = extern struct {
    nSize: WORD = @sizeOf(PIXELFORMATDESCRIPTOR),
    nVersion: WORD = 1,
    dwFlags: DWORD = 0,
    iPixelType: BYTE = 0,
    cColorBits: BYTE = 0,
    cRedBits: BYTE = 0,
    cRedShift: BYTE = 0,
    cGreenBits: BYTE = 0,
    cGreenShift: BYTE = 0,
    cBlueBits: BYTE = 0,
    cBlueShift: BYTE = 0,
    cAlphaBits: BYTE = 0,
    cAlphaShift: BYTE = 0,
    cAccumBits: BYTE = 0,
    cAccumRedBits: BYTE = 0,
    cAccumGreenBits: BYTE = 0,
    cAccumBlueBits: BYTE = 0,
    cAccumAlphaBits: BYTE = 0,
    cDepthBits: BYTE = 0,
    cStencilBits: BYTE = 0,
    cAuxBuffers: BYTE = 0,
    iLayerType: BYTE = 0,
    bReserved: BYTE = 0,
    dwLayerMask: DWORD = 0,
    dwVisibleMask: DWORD = 0,
    dwDamageMask: DWORD = 0,
};

// Game addresses
const ADDR_RENDERER_SELECTOR: usize = 0x0072DA80; // D2RendererFunctionsStrc*[7]

// State
var hdc_global: ?HDC = null;
var hglrc_global: ?HGLRC = null;
var hwnd_stored: ?HWND = null;
var screen_width: c_int = 800;
var screen_height: c_int = 600;
pub var ogl_enabled: bool = false;


// ============================================================================
// Renderer callbacks — all __fastcall (ECX=arg1, EDX=arg2, stack=rest)
// ============================================================================

const FnPtr = *const anyopaque;

// Naked stubs — guaranteed not to clobber ANY register except EAX (return value).
// Exact stack cleanup for __fastcall: ret N where N = (params - 2) * 4, min 0.
fn stubRet0_s0() callconv(.Naked) void { asm volatile ("xor %%eax,%%eax\nret" ::: "eax"); }
fn stubRet1_s0() callconv(.Naked) void { asm volatile ("mov $1,%%eax\nret" ::: "eax"); }
fn stubVoid_s0() callconv(.Naked) void { asm volatile ("ret"); }
fn stubVoid_s1() callconv(.Naked) void { asm volatile ("ret $4"); }
fn stubVoid_s2() callconv(.Naked) void { asm volatile ("ret $8"); }
fn stubVoid_s3() callconv(.Naked) void { asm volatile ("ret $12"); }
fn stubVoid_s4() callconv(.Naked) void { asm volatile ("ret $16"); }
fn stubVoid_s5() callconv(.Naked) void { asm volatile ("ret $20"); }
fn stubRet1_s2() callconv(.Naked) void { asm volatile ("mov $1,%%eax\nret $8" ::: "eax"); }
fn stubRet1_s7() callconv(.Naked) void { asm volatile ("mov $1,%%eax\nret $28" ::: "eax"); }
fn stubNullPtr_s0() callconv(.Naked) void { asm volatile ("xor %%eax,%%eax\nret" ::: "eax"); }

// ============================================================================
// Naked-to-cdecl wrapper pattern:
//   1. Save callee-saved regs (EBX, ESI, EDI, EBP)
//   2. Push fastcall args (ECX, EDX) + stack args onto stack for cdecl call
//   3. Call cdecl impl function
//   4. Restore callee-saved regs
//   5. ret $N (fastcall stack cleanup)
// ============================================================================

// Impl functions — exported so naked wrappers can reference them by symbol name.
// This avoids "m" constraints which resolve to EBP-relative in naked functions.

export fn ogl_implInitialize(_: u32) callconv(.C) u32 {
    return 1;
}

export fn ogl_implCreateWindow(hwnd_val: u32, mode: u32) callconv(.C) u32 {
    log.print("ogl: fpCreateWindow");
    log.hex("ogl:   hwnd=0x", hwnd_val);
    log.hex("ogl:   mode=0x", mode);

    const hwnd: HWND = @ptrFromInt(hwnd_val);
    hwnd_stored = hwnd;

    const hdc = GetDC(hwnd) orelse {
        log.print("ogl: GetDC failed!");
        return 0;
    };
    hdc_global = hdc;

    var pfd = PIXELFORMATDESCRIPTOR{
        .dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER,
        .iPixelType = PFD_TYPE_RGBA,
        .cColorBits = 32,
        .cDepthBits = 24,
        .iLayerType = PFD_MAIN_PLANE,
    };
    const fmt = ChoosePixelFormat(hdc, &pfd);
    if (fmt == 0) {
        log.print("ogl: ChoosePixelFormat failed!");
        return 0;
    }
    _ = SetPixelFormat(hdc, fmt, &pfd);

    const hglrc = wglCreateContext(hdc) orelse {
        log.print("ogl: wglCreateContext failed!");
        return 0;
    };
    hglrc_global = hglrc;
    _ = wglMakeCurrent(hdc, hglrc);

    glViewport(0, 0, screen_width, screen_height);
    glMatrixMode(GL_PROJECTION);
    glLoadIdentity();
    glOrtho(0, @floatFromInt(screen_width), @floatFromInt(screen_height), 0, -1, 1);
    glMatrixMode(GL_MODELVIEW);
    glLoadIdentity();

    glClearColor(0.0, 0.0, 0.2, 1.0);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);

    log.print("ogl: WGL context created");
    return 1;
}

export fn ogl_implRelease() callconv(.C) u32 {
    log.print("ogl: fpRelease");
    if (hglrc_global) |hglrc| {
        _ = wglMakeCurrent(null, null);
        _ = wglDeleteContext(hglrc);
        hglrc_global = null;
    }
    if (hdc_global) |hdc| {
        _ = ReleaseDC(hwnd_stored, hdc);
        hdc_global = null;
    }
    return 1;
}

export fn ogl_implBeginScene(clear: u32, _: u32, _: u32, _: u32) callconv(.C) u32 {
    if (clear != 0) {
        glClear(GL_COLOR_BUFFER_BIT);
    }
    return 1;
}

export fn ogl_implEndScene1() callconv(.C) u32 {
    if (hdc_global) |hdc| {
        _ = SwapBuffers(hdc);
    }
    return 1;
}

export fn ogl_implGetScreenSize(pWidth: u32, pHeight: u32) callconv(.C) u32 {
    const w: *i32 = @ptrFromInt(pWidth);
    const h: *i32 = @ptrFromInt(pHeight);
    w.* = screen_width;
    h.* = screen_height;
    return 0;
}

export fn ogl_implSetOption(opt: u32, val: u32) callconv(.C) u32 {
    _ = opt;
    _ = val;
    return 1;
}

// Naked wrappers: fastcall -> cdecl via direct symbol call.
// Uses exported symbol names in asm to avoid broken "m" constraints in naked functions.

// 0-stack-arg wrappers (all args in ECX/EDX)
fn oglInitialize() callconv(.Naked) void {
    asm volatile (
        \\push %%ebp
        \\mov %%esp, %%ebp
        \\push %%ebx
        \\push %%esi
        \\push %%edi
        \\push %%ecx
        \\call _ogl_implInitialize
        \\add $4, %%esp
        \\pop %%edi
        \\pop %%esi
        \\pop %%ebx
        \\pop %%ebp
        \\ret
    );
}

fn oglCreateWindow() callconv(.Naked) void {
    asm volatile (
        \\push %%ebp
        \\mov %%esp, %%ebp
        \\push %%ebx
        \\push %%esi
        \\push %%edi
        \\push %%edx
        \\push %%ecx
        \\call _ogl_implCreateWindow
        \\add $8, %%esp
        \\pop %%edi
        \\pop %%esi
        \\pop %%ebx
        \\pop %%ebp
        \\ret
    );
}

fn oglRelease() callconv(.Naked) void {
    asm volatile (
        \\push %%ebp
        \\mov %%esp, %%ebp
        \\push %%ebx
        \\push %%esi
        \\push %%edi
        \\call _ogl_implRelease
        \\pop %%edi
        \\pop %%esi
        \\pop %%ebx
        \\pop %%ebp
        \\ret
    );
}

fn oglBeginScene() callconv(.Naked) void {
    asm volatile (
        \\push %%ebp
        \\mov %%esp, %%ebp
        \\push %%ebx
        \\push %%esi
        \\push %%edi
        \\pushl 12(%%ebp)
        \\pushl 8(%%ebp)
        \\push %%edx
        \\push %%ecx
        \\call _ogl_implBeginScene
        \\add $16, %%esp
        \\pop %%edi
        \\pop %%esi
        \\pop %%ebx
        \\pop %%ebp
        \\ret $8
    );
}

fn oglEndScene1() callconv(.Naked) void {
    asm volatile (
        \\push %%ebp
        \\mov %%esp, %%ebp
        \\push %%ebx
        \\push %%esi
        \\push %%edi
        \\call _ogl_implEndScene1
        \\pop %%edi
        \\pop %%esi
        \\pop %%ebx
        \\pop %%ebp
        \\ret
    );
}

fn oglGetScreenSize() callconv(.Naked) void {
    asm volatile (
        \\push %%ebp
        \\mov %%esp, %%ebp
        \\push %%ebx
        \\push %%esi
        \\push %%edi
        \\push %%edx
        \\push %%ecx
        \\call _ogl_implGetScreenSize
        \\add $8, %%esp
        \\pop %%edi
        \\pop %%esi
        \\pop %%ebx
        \\pop %%ebp
        \\ret
    );
}

fn oglSetOption() callconv(.Naked) void {
    asm volatile (
        \\push %%ebp
        \\mov %%esp, %%ebp
        \\push %%ebx
        \\push %%esi
        \\push %%edi
        \\push %%edx
        \\push %%ecx
        \\call _ogl_implSetOption
        \\add $8, %%esp
        \\pop %%edi
        \\pop %%esi
        \\pop %%ebx
        \\pop %%ebp
        \\ret
    );
}

// ============================================================================
// D2 structures for sprite rendering
// ============================================================================

const DC6Block = extern struct {
    nFlip: i32, // 0x00
    nWidth: i32, // 0x04
    nHeight: i32, // 0x08
    nOffsetX: i32, // 0x0C
    nOffsetY: i32, // 0x10
    nAllocSize: i32, // 0x14
    nNextBlock: i32, // 0x18
    nLength: i32, // 0x1C
    // data[] follows at 0x20
};

const D2GfxDataStrc = extern struct {
    nFrameNumber: i32, // 0x00
    dwFlags: u8, // 0x04
    nComponentType: u8, // 0x05
    pad_0x6: [2]u8, // 0x06
    eUnitType: i32, // 0x08
    nClassId: i32, // 0x0C
    nMode: i32, // 0x10
    nOverlayId: i32, // 0x14
    pToken: u32, // 0x18
    nCompositToken: i32, // 0x1C
    nArmorToken: i32, // 0x20
    nModeToken: i32, // 0x24
    nWeaponClass: i32, // 0x28
    szFilename: u32, // 0x2C
    _pad_0x30: [4]u8, // 0x30
    pDC6: u32, // 0x34
    bLoaded: i32, // 0x38
    pDC6Block: u32, // 0x3C - pointer to DC6Block
    nPaletteShift: i32, // 0x40
    dwRenderFlags: u32, // 0x44
};

// Texture for sprites — single reusable texture, re-uploaded each frame.
// This is slow but simple. A proper texture cache comes later.
var sprite_tex: c_uint = 0;
var sprite_tex_created: bool = false;

// Static pixel buffer for decoding sprites (max 256x256 for now)
const MAX_SPRITE_DIM = 256;
var rgba_buf: [MAX_SPRITE_DIM * MAX_SPRITE_DIM * 4]u8 = undefined;

fn decodeDC6ToRGBA(block: *const DC6Block, width: u32, height: u32) bool {
    if (width == 0 or height == 0 or width > MAX_SPRITE_DIM or height > MAX_SPRITE_DIM) return false;

    // Clear buffer to transparent
    @memset(&rgba_buf, 0);

    const data_ptr: [*]const u8 = @ptrFromInt(@intFromPtr(block) + 0x20);
    const data_len: u32 = @bitCast(block.nLength);
    if (data_len == 0) return false;

    var src: u32 = 0;
    var y: u32 = height; // DC6 is bottom-up
    if (y == 0) return false;
    y -= 1;
    var x: u32 = 0;

    while (src < data_len) {
        const b = data_ptr[src];
        src += 1;

        if (b == 0x80) {
            // End of scanline
            if (y == 0) break;
            y -= 1;
            x = 0;
        } else if (b & 0x80 != 0) {
            // Transparent run
            x += b & 0x7F;
        } else {
            // Literal run
            const count: u32 = b;
            var i: u32 = 0;
            while (i < count and src < data_len) : (i += 1) {
                if (x < width and y < height) {
                    const idx = data_ptr[src];
                    const pixel_off = (y * width + x) * 4;
                    if (palette_valid) {
                        rgba_buf[pixel_off + 0] = palette_table[idx][0];
                        rgba_buf[pixel_off + 1] = palette_table[idx][1];
                        rgba_buf[pixel_off + 2] = palette_table[idx][2];
                    } else {
                        rgba_buf[pixel_off + 0] = idx;
                        rgba_buf[pixel_off + 1] = idx;
                        rgba_buf[pixel_off + 2] = idx;
                    }
                    rgba_buf[pixel_off + 3] = if (idx == 0) 0 else 255; // index 0 = transparent
                }
                src += 1;
                x += 1;
            }
        }
    }
    return true;
}

// ============================================================================
// Primitive drawing impls
// ============================================================================

// Palette for converting palette indices to RGBA
var palette_table: [256][4]u8 = undefined;
var palette_valid: bool = false;

fn paletteColor(idx: u8) struct { r: u8, g: u8, b: u8 } {
    if (palette_valid) {
        return .{ .r = palette_table[idx][0], .g = palette_table[idx][1], .b = palette_table[idx][2] };
    }
    // Fallback: grayscale
    return .{ .r = idx, .g = idx, .b = idx };
}

// fpSetPalette(LPPALETTEENTRY pPalette) — palette is 256 RGBQUAD entries (4 bytes each: R,G,B,flags)
export fn ogl_implSetPalette(pPalette: u32) callconv(.C) void {
    if (pPalette == 0) return;
    const entries: [*]const [4]u8 = @ptrFromInt(pPalette);
    for (0..256) |i| {
        palette_table[i] = entries[i];
    }
    palette_valid = true;
}

// fpDrawSolidRect(RECT* pRect, BYTE paletteIdx) — fastcall(ECX=pRect, EDX=paletteIdx)
export fn ogl_implDrawSolidRect(pRect_val: u32, palIdx_val: u32) callconv(.C) void {
    if (pRect_val == 0) return;
    const rect: *const RECT = @ptrFromInt(pRect_val);
    const palIdx: u8 = @truncate(palIdx_val);
    const c = paletteColor(palIdx);

    glDisable(GL_TEXTURE_2D);
    glColor4ub(c.r, c.g, c.b, 255);
    glBegin(GL_QUADS);
    glVertex2i(rect.left, rect.top);
    glVertex2i(rect.right, rect.top);
    glVertex2i(rect.right, rect.bottom);
    glVertex2i(rect.left, rect.bottom);
    glEnd();
}

// fpDrawRect(RECT* pRect, BYTE paletteIdx) — outline
export fn ogl_implDrawRect(pRect_val: u32, palIdx_val: u32) callconv(.C) void {
    if (pRect_val == 0) return;
    const rect: *const RECT = @ptrFromInt(pRect_val);
    const palIdx: u8 = @truncate(palIdx_val);
    const c = paletteColor(palIdx);

    glDisable(GL_TEXTURE_2D);
    glColor4ub(c.r, c.g, c.b, 255);
    glBegin(GL_LINE_LOOP);
    glVertex2i(rect.left, rect.top);
    glVertex2i(rect.right, rect.top);
    glVertex2i(rect.right, rect.bottom);
    glVertex2i(rect.left, rect.bottom);
    glEnd();
}

// fpDrawSolidRectAlpha(x0, y0, x1, y1, color, alpha) — 6p: ECX=x0, EDX=y0, stack=[x1,y1,color,alpha]
export fn ogl_implDrawSolidRectAlpha(x0: u32, y0: u32, x1: u32, y1: u32, color: u32, alpha_val: u32) callconv(.C) void {
    const r: u8 = @truncate(color & 0xFF);
    const g: u8 = @truncate((color >> 8) & 0xFF);
    const b: u8 = @truncate((color >> 16) & 0xFF);
    const a: u8 = @truncate(alpha_val);

    glDisable(GL_TEXTURE_2D);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glColor4ub(r, g, b, a);
    glBegin(GL_QUADS);
    glVertex2i(@bitCast(x0), @bitCast(y0));
    glVertex2i(@bitCast(x1), @bitCast(y0));
    glVertex2i(@bitCast(x1), @bitCast(y1));
    glVertex2i(@bitCast(x0), @bitCast(y1));
    glEnd();
}

// fpDrawLine(x0, y0, x1, y1, color, alpha) — 6p: ECX=x0, EDX=y0, stack=[x1,y1,color,alpha]
export fn ogl_implDrawLine(x0: u32, y0: u32, x1: u32, y1: u32, color: u32, alpha_val: u32) callconv(.C) void {
    const r: u8 = @truncate(color & 0xFF);
    const g: u8 = @truncate((color >> 8) & 0xFF);
    const b: u8 = @truncate((color >> 16) & 0xFF);
    const a: u8 = @truncate(alpha_val);

    glDisable(GL_TEXTURE_2D);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glColor4ub(r, g, b, a);
    glLineWidth(1.0);
    glBegin(GL_LINES);
    glVertex2i(@bitCast(x0), @bitCast(y0));
    glVertex2i(@bitCast(x1), @bitCast(y1));
    glEnd();
}

// fpDrawImage(D2GfxDataStrc* pData, int x, int y, DWORD gamma, int mode, BYTE* palette)
// 6 params: ECX=pData, EDX=x, stack=[y, gamma, mode, palette]
export fn ogl_implDrawImage(pData_val: u32, x_val: u32, y_val: u32, gamma: u32, mode: u32, palette: u32) callconv(.C) void {
    _ = gamma;
    _ = mode;
    _ = palette;
    if (pData_val == 0) return;

    // Load sprite via D2CMP sprite cache — fills pDC6Block
    if (SPRITECACHE_GetOrLoadSprite(pData_val, 0, 1) == 0) return;

    const pData: *const D2GfxDataStrc = @ptrFromInt(pData_val);
    if (pData.pDC6Block == 0) return;

    const block: *const DC6Block = @ptrFromInt(pData.pDC6Block);
    const w: u32 = @bitCast(block.nWidth);
    const h: u32 = @bitCast(block.nHeight);
    if (w == 0 or h == 0 or w > MAX_SPRITE_DIM or h > MAX_SPRITE_DIM) return;

    if (!decodeDC6ToRGBA(block, w, h)) return;

    // Create texture on first use
    if (!sprite_tex_created) {
        glGenTextures(1, &sprite_tex);
        sprite_tex_created = true;
    }

    glEnable(GL_TEXTURE_2D);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glBindTexture(GL_TEXTURE_2D, sprite_tex);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);

    glTexImage2D(GL_TEXTURE_2D, 0, @intCast(GL_RGBA), @bitCast(w), @bitCast(h), 0, GL_RGBA, GL_UNSIGNED_BYTE, &rgba_buf);

    const x: i32 = @bitCast(x_val);
    const y: i32 = @bitCast(y_val);
    const draw_x = x + block.nOffsetX;
    const draw_y = y + block.nOffsetY - block.nHeight;

    glColor4f(1.0, 1.0, 1.0, 1.0);
    glBegin(GL_QUADS);
    glTexCoord2f(0.0, 0.0);
    glVertex2i(draw_x, draw_y);
    glTexCoord2f(1.0, 0.0);
    glVertex2i(draw_x + block.nWidth, draw_y);
    glTexCoord2f(1.0, 1.0);
    glVertex2i(draw_x + block.nWidth, draw_y + block.nHeight);
    glTexCoord2f(0.0, 1.0);
    glVertex2i(draw_x, draw_y + block.nHeight);
    glEnd();

    glDisable(GL_TEXTURE_2D);
}

// fpDrawShiftedImage — same as DrawImage but with shift param instead of palette
export fn ogl_implDrawShiftedImage(pData_val: u32, x_val: u32, y_val: u32, gamma: u32, mode: u32, shift: u32) callconv(.C) void {
    _ = shift;
    ogl_implDrawImage(pData_val, x_val, y_val, gamma, mode, 0);
}

// fpDrawShadow(D2GfxDataStrc* pData, int x, int y) — 3 params: ECX=pData, EDX=x, stack=[y]
export fn ogl_implDrawShadow(pData_val: u32, x_val: u32, y_val: u32) callconv(.C) void {
    if (pData_val == 0) return;
    if (SPRITECACHE_GetOrLoadSprite(pData_val, 0, 1) == 0) return;
    const pData: *const D2GfxDataStrc = @ptrFromInt(pData_val);
    if (pData.pDC6Block == 0) return;

    const block: *const DC6Block = @ptrFromInt(pData.pDC6Block);
    const x: i32 = @bitCast(x_val);
    const y: i32 = @bitCast(y_val);
    const draw_x = x + block.nOffsetX;
    const draw_y = y + block.nOffsetY - block.nHeight;

    // Draw shadow as semi-transparent dark rectangle
    glDisable(GL_TEXTURE_2D);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glColor4ub(0, 0, 0, 80);
    glBegin(GL_QUADS);
    glVertex2i(draw_x, draw_y);
    glVertex2i(draw_x + block.nWidth, draw_y);
    glVertex2i(draw_x + block.nWidth, draw_y + block.nHeight);
    glVertex2i(draw_x, draw_y + block.nHeight);
    glEnd();
}

// fpClearScreen(BOOL partial) — ECX=partial
export fn ogl_implClearScreen(_: u32) callconv(.C) void {
    glClear(GL_COLOR_BUFFER_BIT);
}

// Naked wrappers for primitives

// 0-stack-arg wrappers (2 params in ECX, EDX)
fn oglDrawSolidRect() callconv(.Naked) void {
    asm volatile (
        \\push %%ebp
        \\mov %%esp, %%ebp
        \\push %%ebx
        \\push %%esi
        \\push %%edi
        \\push %%edx
        \\push %%ecx
        \\call _ogl_implDrawSolidRect
        \\add $8, %%esp
        \\pop %%edi
        \\pop %%esi
        \\pop %%ebx
        \\pop %%ebp
        \\ret
    );
}

fn oglDrawRect() callconv(.Naked) void {
    asm volatile (
        \\push %%ebp
        \\mov %%esp, %%ebp
        \\push %%ebx
        \\push %%esi
        \\push %%edi
        \\push %%edx
        \\push %%ecx
        \\call _ogl_implDrawRect
        \\add $8, %%esp
        \\pop %%edi
        \\pop %%esi
        \\pop %%ebx
        \\pop %%ebp
        \\ret
    );
}

// 4-stack-arg wrappers (ECX, EDX + 4 on stack)
fn oglDrawSolidRectAlpha() callconv(.Naked) void {
    asm volatile (
        \\push %%ebp
        \\mov %%esp, %%ebp
        \\push %%ebx
        \\push %%esi
        \\push %%edi
        \\pushl 20(%%ebp)
        \\pushl 16(%%ebp)
        \\pushl 12(%%ebp)
        \\pushl 8(%%ebp)
        \\push %%edx
        \\push %%ecx
        \\call _ogl_implDrawSolidRectAlpha
        \\add $24, %%esp
        \\pop %%edi
        \\pop %%esi
        \\pop %%ebx
        \\pop %%ebp
        \\ret $16
    );
}

fn oglDrawLine() callconv(.Naked) void {
    asm volatile (
        \\push %%ebp
        \\mov %%esp, %%ebp
        \\push %%ebx
        \\push %%esi
        \\push %%edi
        \\pushl 20(%%ebp)
        \\pushl 16(%%ebp)
        \\pushl 12(%%ebp)
        \\pushl 8(%%ebp)
        \\push %%edx
        \\push %%ecx
        \\call _ogl_implDrawLine
        \\add $24, %%esp
        \\pop %%edi
        \\pop %%esi
        \\pop %%ebx
        \\pop %%ebp
        \\ret $16
    );
}

fn oglClearScreenWrapped() callconv(.Naked) void {
    asm volatile (
        \\push %%ebp
        \\mov %%esp, %%ebp
        \\push %%ebx
        \\push %%esi
        \\push %%edi
        \\push %%ecx
        \\call _ogl_implClearScreen
        \\add $4, %%esp
        \\pop %%edi
        \\pop %%esi
        \\pop %%ebx
        \\pop %%ebp
        \\ret
    );
}

fn oglSetPaletteWrapped() callconv(.Naked) void {
    asm volatile (
        \\push %%ebp
        \\mov %%esp, %%ebp
        \\push %%ebx
        \\push %%esi
        \\push %%edi
        \\push %%ecx
        \\call _ogl_implSetPalette
        \\add $4, %%esp
        \\pop %%edi
        \\pop %%esi
        \\pop %%ebx
        \\pop %%ebp
        \\ret
    );
}

// Sprite naked wrappers

// fpDrawImage: 6p (ECX, EDX + 4 on stack) — same wrapper pattern as DrawSolidRectAlpha
fn oglDrawImage() callconv(.Naked) void {
    asm volatile (
        \\push %%ebp
        \\mov %%esp, %%ebp
        \\push %%ebx
        \\push %%esi
        \\push %%edi
        \\pushl 20(%%ebp)
        \\pushl 16(%%ebp)
        \\pushl 12(%%ebp)
        \\pushl 8(%%ebp)
        \\push %%edx
        \\push %%ecx
        \\call _ogl_implDrawImage
        \\add $24, %%esp
        \\pop %%edi
        \\pop %%esi
        \\pop %%ebx
        \\pop %%ebp
        \\ret $16
    );
}

fn oglDrawShiftedImage() callconv(.Naked) void {
    asm volatile (
        \\push %%ebp
        \\mov %%esp, %%ebp
        \\push %%ebx
        \\push %%esi
        \\push %%edi
        \\pushl 20(%%ebp)
        \\pushl 16(%%ebp)
        \\pushl 12(%%ebp)
        \\pushl 8(%%ebp)
        \\push %%edx
        \\push %%ecx
        \\call _ogl_implDrawShiftedImage
        \\add $24, %%esp
        \\pop %%edi
        \\pop %%esi
        \\pop %%ebx
        \\pop %%ebp
        \\ret $16
    );
}

// fpDrawShadow: 3p (ECX, EDX + 1 on stack)
fn oglDrawShadow() callconv(.Naked) void {
    asm volatile (
        \\push %%ebp
        \\mov %%esp, %%ebp
        \\push %%ebx
        \\push %%esi
        \\push %%edi
        \\pushl 8(%%ebp)
        \\push %%edx
        \\push %%ecx
        \\call _ogl_implDrawShadow
        \\add $12, %%esp
        \\pop %%edi
        \\pop %%esi
        \\pop %%ebx
        \\pop %%ebp
        \\ret $4
    );
}

// Simple naked stubs for functions that don't need logic yet
fn oglInitPerspective() callconv(.Naked) void { asm volatile ("mov $1,%%eax\nret" ::: "eax"); }
fn oglDestroyWindow() callconv(.Naked) void { asm volatile ("mov $1,%%eax\nret" ::: "eax"); }
fn oglEndScene2() callconv(.Naked) void { asm volatile ("mov $1,%%eax\nret" ::: "eax"); }
fn oglSetGamma() callconv(.Naked) void { asm volatile ("mov $1,%%eax\nret" ::: "eax"); }
fn oglCheckGamma() callconv(.Naked) void { asm volatile ("xor %%eax,%%eax\nret" ::: "eax"); }
fn oglSetPaletteTable() callconv(.Naked) void { asm volatile ("ret"); }

// The complete function table — 54 entries, 0xD8 bytes
// All __fastcall. Stubs use exact arity to ensure correct stack cleanup.
// sN suffix = N stack args (params - 2, min 0)
pub const ogl_function_table = [54]FnPtr{
    @ptrCast(&oglInitialize), //       0x00 fpInitialize(1p, 0s)
    @ptrCast(&oglInitPerspective), //  0x04 fpInitPerspective(2p, 0s)
    @ptrCast(&oglRelease), //          0x08 fpRelease(0p, 0s)
    @ptrCast(&oglCreateWindow), //     0x0C fpCreateWindow(2p, 0s)
    @ptrCast(&oglDestroyWindow), //    0x10 fpDestroyWindow(0p, 0s)
    @ptrCast(&stubVoid_s1), //         0x14 fpEndCutScene(3p, 1s)
    @ptrCast(&oglBeginScene), //       0x18 fpBeginScene(4p, 2s)
    @ptrCast(&oglEndScene1), //        0x1C fpEndScene1(0p, 0s)
    @ptrCast(&oglEndScene2), //        0x20 fpEndScene2(0p, 0s)
    @ptrCast(&stubRet1_s0), //         0x24 fpResizeWindow(2p, 0s)
    @ptrCast(&stubRet0_s0), //         0x28 fpGetBackBuffer(1p, 0s)
    @ptrCast(&stubRet1_s0), //         0x2C fpActivateWindow(0p, 0s)
    @ptrCast(&oglSetOption), //        0x30 fpSetOption(2p, 0s)
    @ptrCast(&stubRet0_s0), //         0x34 fpBeginCutScene(0p, 0s)
    @ptrCast(&stubVoid_s1), //         0x38 fpPlayCutScene(3p, 1s)
    @ptrCast(&stubRet0_s0), //         0x3C fpCheckCutScene(0p, 0s)
    @ptrCast(&stubVoid_s1), //         0x40 fpDecodeSmacker(3p, 1s)
    @ptrCast(&stubVoid_s0), //         0x44 fpPlayerSmacker(1p, 0s)
    @ptrCast(&stubVoid_s0), //         0x48 fpCloseSmacker(1p, 0s)
    @ptrCast(&stubNullPtr_s0), //      0x4C fpGetRenderStatistics(0p, 0s)
    @ptrCast(&oglGetScreenSize), //    0x50 fpGetScreenSize(2p, 0s)
    @ptrCast(&stubVoid_s0), //         0x54 fpUpdateScaleFactor(1p, 0s)
    @ptrCast(&oglSetGamma), //         0x58 fpSetGamma(1p, 0s)
    @ptrCast(&oglCheckGamma), //       0x5C fpCheckGamma(0p, 0s)
    @ptrCast(&stubVoid_s0), //         0x60 fpSetPerspectiveScale(2p, 0s)
    @ptrCast(&stubVoid_s3), //         0x64 fpAdjustPerspectivePos(5p, 3s)
    @ptrCast(&stubVoid_s4), //         0x68 fpPerspectiveScalePos(6p, 4s)
    @ptrCast(&stubVoid_s0), //         0x6C fpSetDefaultPerspectiveFactor(0p, 0s)
    @ptrCast(&oglSetPaletteWrapped), // 0x70 fpSetPalette(1p, 0s)
    @ptrCast(&oglSetPaletteTable), //  0x74 fpSetPaletteTable(1p, 0s)
    @ptrCast(&stubVoid_s1), //         0x78 fpSetGlobalLight(3p, 1s)
    @ptrCast(&stubRet1_s7), //         0x7C fpDrawGroundTile(9p, 7s)
    @ptrCast(&stubVoid_s5), //         0x80 fpDrawPerspectiveImage(7p, 5s)
    @ptrCast(&oglDrawImage), //         0x84 fpDrawImage(6p, 4s)
    @ptrCast(&oglDrawShiftedImage), //  0x88 fpDrawShiftedImage(6p, 4s)
    @ptrCast(&oglDrawImage), //         0x8C fpDrawVerticalCropImage(6p, 4s)
    @ptrCast(&oglDrawShadow), //        0x90 fpDrawShadow(3p, 1s)
    @ptrCast(&stubVoid_s2), //         0x94 fpDrawImageFast(4p, 2s)
    @ptrCast(&stubVoid_s3), //         0x98 fpDrawClippedImage(5p, 3s)
    @ptrCast(&stubVoid_s3), //         0x9C fpDrawWallTile(5p, 3s)
    @ptrCast(&stubVoid_s4), //         0xA0 fpDrawTransWallTile(6p, 4s)
    @ptrCast(&stubVoid_s3), //         0xA4 fpDrawShadowTile(5p, 3s)
    @ptrCast(&oglDrawRect), //          0xA8 fpDrawRect(2p, 0s)
    @ptrCast(&oglDrawRect), //          0xAC fpDrawRectEx(2p, 0s)
    @ptrCast(&oglDrawSolidRect), //     0xB0 fpDrawSolidRect(2p, 0s)
    @ptrCast(&stubVoid_s1), //         0xB4 fpDrawSolidSquare(3p, 1s)
    @ptrCast(&oglDrawSolidRectAlpha), // 0xB8 fpDrawSolidRectEx(6p, 4s)
    @ptrCast(&oglDrawSolidRectAlpha), // 0xBC fpDrawSolidRectAlpha(6p, 4s)
    @ptrCast(&oglDrawLine), //          0xC0 fpDrawLine(6p, 4s)
    @ptrCast(&oglClearScreenWrapped), // 0xC4 fpClearScreen(1p, 0s)
    @ptrCast(&stubVoid_s2), //         0xC8 fpDrawString(4p, 2s)
    @ptrCast(&stubVoid_s2), //         0xCC fpDrawLight(4p, 2s)
    @ptrCast(&stubVoid_s0), //         0xD0 fpDebugFillBackBuffer(2p, 0s)
    @ptrCast(&stubVoid_s0), //         0xD4 fpClearCaches(0p, 0s)
};

comptime {
    std.debug.assert(ogl_function_table.len == 54);
    std.debug.assert(@sizeOf(@TypeOf(ogl_function_table)) == 0xD8);
}

// ============================================================================
// Command line parsing
// ============================================================================

fn hasOglFlag() bool {
    const cmdline: [*:0]const u8 = GetCommandLineA();
    var i: usize = 0;
    while (cmdline[i] != 0) : (i += 1) {
        if (cmdline[i] == '-' and cmdline[i + 1] == 'o' and cmdline[i + 2] == 'g' and cmdline[i + 3] == 'l') {
            const next = cmdline[i + 4];
            if (next == 0 or next == ' ' or next == '\t') return true;
        }
    }
    return false;
}

// ============================================================================
// Public API — called from aether.zig DllMain
// ============================================================================

pub fn earlyInit() void {
    if (!hasOglFlag()) return;

    ogl_enabled = true;
    log.print("ogl: -ogl flag detected, activating OpenGL renderer");

    // We inject early (DLL_PROCESS_ATTACH), before D2GFX_Initialize runs.
    // With -w, game uses mode 1 (Windowed). Without -w, mode 3 (DirectDraw).
    // Overwrite both slots to cover both cases.
    const table_ptr: u32 = @intFromPtr(&ogl_function_table);
    const ptr_bytes: [4]u8 = @bitCast(table_ptr);

    const SLOT_WINDOWED: usize = 1;
    const SLOT_DIRECTDRAW: usize = 3;
    _ = patch.writeBytes(ADDR_RENDERER_SELECTOR + SLOT_WINDOWED * 4, &ptr_bytes);
    _ = patch.writeBytes(ADDR_RENDERER_SELECTOR + SLOT_DIRECTDRAW * 4, &ptr_bytes);
    log.hex("ogl: table at 0x", table_ptr);

    // Verify: read back selector slot 1
    const readback = @as(*const u32, @ptrFromInt(ADDR_RENDERER_SELECTOR + SLOT_WINDOWED * 4)).*;
    log.hex("ogl: selector[1] readback=0x", readback);

    // Dump first few table entries to verify layout
    const tbl = @as([*]const u32, @ptrCast(&ogl_function_table));
    log.hex("ogl: tbl[0]  fpInitialize=0x", tbl[0]);
    log.hex("ogl: tbl[3]  fpCreateWindow=0x", tbl[3]);
    log.hex("ogl: tbl[12] fpSetOption=0x", tbl[12]);
    log.print("ogl: patched selector slots 1 and 3");
}

pub fn cleanup() void {
    if (!ogl_enabled) return;
    const SLOT_WINDOWED: usize = 1;
    const SLOT_DIRECTDRAW: usize = 3;
    patch.revertRange(ADDR_RENDERER_SELECTOR + SLOT_WINDOWED * 4, 4);
    patch.revertRange(ADDR_RENDERER_SELECTOR + SLOT_DIRECTDRAW * 4, 4);
}
