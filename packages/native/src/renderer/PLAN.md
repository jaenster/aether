<!-- IMPORTANT: After context compaction, ALWAYS re-read this file (dllinject/src/renderer/PLAN.md) to recover accumulated knowledge. -->

# OpenGL Renderer — Line-by-Line Translation from Mac OGL

## Context
We're building an OpenGL renderer for D2 1.14d on Windows. The Mac binary has a complete OGL renderer at `reconstructed/diablo2/src/D2OpenGL/` (~3600 lines of reconstructed C++). Instead of reverse-engineering from scratch, we translate each Mac OGL source file line-by-line to Zig. This is more robust — the decompiled Mac code is the ground truth for how D2's OGL renderer works.

We already have a working skeleton with ground tiles, sprites, and scene management. The translation replaces our ad-hoc implementations with faithful ports of the Mac code.

## Mac OGL Source Files (reconstructed C++ → Zig translation)

| Mac source | Lines | Zig target | Priority | What it does |
|-|-|-|-|-|
| `D2OpenGL.cpp` | 1443 | `ogl.zig` (update) | 1 | Init, teardown, vtable stubs, palette, gamma, rects, scene mgmt |
| `oglSprite.cpp` | 222 | `sprite.zig` (new) | 2 | `OPENGL_DrawTexturedQuad` — DC6 decode + palette expand + draw |
| `oglVertex.cpp` | 712 | `vertex.zig` (new) | 3 | Floor mesh + wall tile rendering |
| `COGLAGPTextures.cpp` | 419 | `texture_cache.zig` (new) | 4 | AGP texture pool — alloc/free/cache GL textures |
| `oglBlocks.cpp` | 34 | inline in ogl.zig | 5 | Block memory allocators (trivial) |
| `oglPerspective.cpp` | 33 | `perspective.zig` (new) | 6 | Perspective transform (can stub initially) |
| `oglSmack.cpp` | 390 | skip | — | Smacker/cutscene video (defer) |
| `D2OpenGL.h` | 230 | types in each .zig file | — | Struct defs, globals, constants |

**Total to translate**: ~2860 lines (excluding Smacker which we defer)

## Translation Approach

For each Mac source file:
1. Read the reconstructed C++ carefully
2. Create corresponding `.zig` file in `dllinject/src/renderer/`
3. Translate line-by-line: C globals → Zig module-level vars, C functions → Zig functions, C structs → Zig extern structs
4. Replace Mac-specific APIs: AGL → WGL, Carbon WindowRef → Win32 HWND
5. Keep the same function names where possible (just change prefix: `OPENGL_` → `ogl_`)
6. Hook into our existing naked wrapper vtable dispatch

### Key API Differences (Mac → Windows)
| Mac (AGL/Carbon) | Windows (WGL/Win32) |
|-|-|
| `aglCreateContext` | `wglCreateContext` |
| `aglSetCurrentContext` | `wglMakeCurrent` |
| `aglSwapBuffers` | `SwapBuffers` |
| `aglSetFullScreen` | N/A (use SetPixelFormat) |
| `WindowRef` (Carbon) | `HWND` (Win32) |
| `GetWindowPort` | `GetDC` |

OpenGL calls (`glBegin`, `glTexImage2D`, etc.) are identical — no translation needed.

## File-by-File Plan

### File 1: `ogl.zig` — Update existing (priority 1)
Source: `D2OpenGL.cpp` (1443 lines)

Translate:
- `OPENGL_BeginFrame` → our `fpBeginScene` (already have, verify against Mac)
- `OPENGL_PresentFrame` → our `fpEndScene2` (already have, verify)
- `OPENGL_BuildPaletteLookupTables` → update our SetPalette to match Mac's palette table building
- `OPENGL_DrawFilledRect` → update our DrawSolidRect/DrawSolidRectAlpha
- `OPENGL_SetCurrentColor` → SetGlobalLight implementation
- `OPENGL_ClearDepthBuffer` → ClearScreen
- `OPENGL_SetGammaLevel` → SetGamma
- All stub functions (ReturnTrue, ReturnFalse, ReturnVoid)
- Replace `buildHybridTable` concept with full standalone vtable (what we already have)

Keep: WGL context init (already working, just Mac→Win API swap)
Remove: hybrid table approach, unused framebuffer compositing code

### File 2: `sprite.zig` — New file (priority 2)
Source: `oglSprite.cpp` (222 lines)

Translate `OPENGL_DrawTexturedQuad`:
- DC6 RLE decode → indexed pixel buffer
- Palette expansion (indexed → RGBA)
- Upload to GL texture (via texture cache)
- Draw textured quad with correct blend mode based on `mode` parameter
- This fixes our transparency bug — Mac code handles blend modes

Also translate: `OPENGL_RenderSprites` (the outer dispatcher)

### File 3: `vertex.zig` — New file (priority 3)
Source: `oglVertex.cpp` (712 lines)

Translate:
- `OPENGL_RenderFloorMesh` → ground tile rendering (replace our current ad-hoc decoder)
- `OPENGL_DrawFloorTilesOpaque` → wall tile rendering (fixes our broken wall decoder)
- `OPENGL_DrawAutomap` → automap overlay rendering
- Floor/wall vertex building and texture upload

### File 4: `texture_cache.zig` — New file (priority 4)
Source: `COGLAGPTextures.cpp` (419 lines)

Translate `CD2AGPTexturesStrc` class:
- GL texture pool with LRU eviction
- Alloc/free texture slots
- Cache lookup by (sprite ptr + frame)
- Avoids re-uploading unchanged textures each frame

### File 5: `perspective.zig` — New file (priority 6, can stub)
Source: `oglPerspective.cpp` (33 lines — mostly stubs)

Small file, mostly perspective transform math. Can stub initially and implement later for Act 5.

## Implementation Order

1. **sprite.zig** — Translate `oglSprite.cpp`. Biggest visual impact: fixes sprite transparency/blending. Connect to existing naked wrappers for DrawImage/DrawShiftedImage/etc.

2. **vertex.zig** — Translate `oglVertex.cpp`. Fixes wall tiles, improves ground tiles to match Mac's exact logic.

3. **texture_cache.zig** — Translate `COGLAGPTextures.cpp`. Performance improvement — stop re-uploading textures every frame.

4. **ogl.zig updates** — Align init/palette/rect/scene code with Mac source. Clean up dead code.

5. **perspective.zig** — Stub or translate last.

## Key Addresses
| Symbol | Address | Notes |
|-|-|-|
| `RENDERER_RenderedFunctionsSelector[7]` | `0x0072DA80` | Slot 1=Windowed, 3=DDraw, 5=OGL(nullptr) |
| `WindowedFunctionTable` | `0x0074C4A8` | 54 fn ptrs, 216 bytes |
| `RENDERER_CurrentRenderedFunctions` | `0x007C8CC0` | Active vtable |
| `eRendererMode` | `0x007C8CB0` | Mode enum |
| `ppvBits` (framebuffer) | `0x007C9154` | `void**` — Windowed DIB pixel data |
| `RENDERER_nWindowWidth` | `0x007C9138` | 800 (or 640) |
| `RENDERER_nWindowHeight` | `0x007C913C` | 600 (or 480) |
| `prgbq` (RGBQUAD palette) | `0x00989C40` | 256 RGBQUAD, used by Windowed SetPalette |
| `D2GFX_Initialize` | `0x004F52E0` | |
| `SPRITECACHE_GetOrLoadSprite` | `0x006001F0` | __stdcall, loads DC6 → pDC6Block |
| `SPRITECACHE_AllocEntry` | `0x005FDEA0` | __stdcall, loads tile pixel data |

## D2 Renderer Vtable Layout (54 entries, 0xD8 bytes)
| Offset | Index | Function | Mac OGL |
|-|-|-|-|
| 0x00 | 0 | fpInitialize | `OPENGL_StubCallInit` |
| 0x04 | 1 | fpInitPerspective | stub |
| 0x08 | 2 | fpRelease | `OGL_DestroyRendererIfSet` |
| 0x0C | 3 | fpCreateWindow | `OPENGL_StubReturnTrue` |
| 0x10 | 4 | fpDestroyWindow | stub |
| 0x14 | 5 | fpEndCutScene | `OPENGLMAC_StopCutscene` |
| 0x18 | 6 | fpBeginScene | `OPENGL_BeginFrame` |
| 0x1C | 7 | fpEndScene1 | `OPENGL_ClearFrameBusy` |
| 0x20 | 8 | fpEndScene2 | `OPENGL_PresentFrame` (SwapBuffers) |
| 0x24 | 9 | fpResizeWindow | `OPENGLMAC_SwapContext` |
| 0x28 | 10 | fpGetBackBuffer | `OPENGL_ReadPixelsToBuffer` |
| 0x2C | 11 | fpActivateWindow | stub |
| 0x30 | 12 | fpSetOption | `OPENGL_SetSomeGlobal` |
| 0x34 | 13 | fpBeginCutScene | cutscene gamma |
| 0x38 | 14 | fpPlayCutScene | cutscene play |
| 0x3C | 15 | fpCheckCutScene | cutscene check |
| 0x40 | 16 | fpDecodeSmacker | oglSmack |
| 0x44 | 17 | fpPlayerSmacker | oglSmack |
| 0x48 | 18 | fpCloseSmacker | oglSmack |
| 0x4C | 19 | fpGetRenderStatistics | stub (return false) |
| 0x50 | 20 | fpGetScreenSize | dimensions |
| 0x54 | 21 | fpUpdateScaleFactor | stub void |
| 0x58 | 22 | fpSetGamma | `OPENGL_SetGammaLevel` |
| 0x5C | 23 | fpCheckGamma | stub (return true) |
| 0x60 | 24 | fpSetPerspectiveScale | `OPENGL_SetPerspectiveDirty` |
| 0x64 | 25 | fpAdjustPerspectivePosition | `OPENGL_SetWorldOrigin` |
| 0x68 | 26 | fpPerspectiveScalePosition | `OPENGL_TransformIsometricToScreen` |
| 0x6C | 27 | fpSetDefaultPerspectiveFactor | `OPENGL_ResetIsometricDepth` |
| 0x70 | 28 | fpSetPalette | `OPENGL_BuildPaletteLookupTables` |
| 0x74 | 29 | fpSetPaletteTable | `OPENGL_SetPalette` |
| 0x78 | 30 | fpSetGlobalLight | `OPENGL_SetCurrentColor` |
| 0x7C | 31 | fpDrawGroundTile | `OPENGL_RenderFloorMesh` (oglVertex) |
| 0x80 | 32 | fpDrawPerspectiveImage | `OPENGL_DrawTexturedQuad` (oglSprite) |
| 0x84 | 33 | fpDrawImage | `OPENGL_DrawTexturedQuad` |
| 0x88 | 34 | fpDrawShiftedImage | `OPENGL_DrawTexturedQuad` |
| 0x8C | 35 | fpDrawVerticalCropImage | `OPENGL_DrawTexturedQuad` variant |
| 0x90 | 36 | fpDrawShadow | **STUB** (void) |
| 0x94 | 37 | fpDrawImageFast | `OPENGL_DrawTexturedQuad` |
| 0x98 | 38 | fpDrawClippedImage | `OPENGL_DrawTexturedQuad` |
| 0x9C | 39 | fpDrawWallTile | `OPENGL_DrawFloorTilesOpaque` (oglVertex) |
| 0xA0 | 40 | fpDrawTransWallTile | `OPENGL_DrawFloorTilesOpaque` variant |
| 0xA4 | 41 | fpDrawShadowTile | **STUB** |
| 0xA8 | 42 | fpDrawRect | `OPENGL_DrawFilledRect` |
| 0xAC | 43 | fpDrawRectEx | `OPENGL_DrawFilledRect` |
| 0xB0 | 44 | fpDrawSolidRect | `OPENGL_DrawFilledRect` |
| 0xB4 | 45 | fpDrawSolidSquare | `OPENGL_DrawSolidPoint` |
| 0xB8 | 46 | fpDrawSolidRectEx | `OPENGL_DrawFilledRect` |
| 0xBC | 47 | fpDrawSolidRectAlpha | `OPENGL_DrawFilledRect` |
| 0xC0 | 48 | fpDrawLine | **STUB** (void) |
| 0xC4 | 49 | fpClearScreen | `OPENGL_ClearDepthBuffer` |
| 0xC8 | 50 | fpDrawString | **STUB** |
| 0xCC | 51 | fpDrawLight | **STUB** (void) |
| 0xD0 | 52 | fpDebugFillBackBuffer | stub |
| 0xD4 | 53 | fpClearCaches | `OPENGL_AGPTexture_ResetUsageCounters` |

## D2 Data Structures
- `D2GfxDataStrc` (0x48 bytes): pDC6 at +0x34, pDC6Block at +0x3C
- `D2TileLibraryEntryStrc` (0x50 bytes, allocated as pairs): height +0x08, width +0x0C, nBlocks +0x34, nBlockDataSize +0x4C. Runtime cache: +0x50=blockCount, +0x54=blockDataPtr
- Ground tile: 160×80 diamond, 25 blocks, 15 scanlines/block, raw palette-indexed
- Wall tile: RLE (2-byte headers: skip,count + raw bytes), 32 scanlines/block
- DC6 sprite: RLE, bottom-up scanlines, 0x80=EOL, bit7=transparent run

## Key Reference
| File | Path |
|-|-|
| Mac OGL source | `reconstructed/diablo2/src/D2OpenGL/` |
| Mac OGL header | `reconstructed/diablo2/src/D2OpenGL/D2OpenGL.h` |
| Current Zig renderer | `dllinject/src/renderer/ogl.zig` |
| Win renderer reference | `reconstructed/diablo2/src/D2Client/Renderer/Windowed.cpp` |
| D2GFX vtable struct | `reconstructed/diablo2/src/D2Client/Renderer/D2GFX.h` |

## What We Already Know (from implementation sessions)

### Ground Tile Decoding (working)
Isometric diamond tiles: 160×80 pixels, 25 blocks per tile, 15 scanlines per block.
Block descriptors at stride 0x14 (20 bytes), pixel data pointer at block+0x10.
Pixel data is **raw palette-indexed** (NOT RLE). Geometry from hardcoded tables:

```
row_widths:  [4, 8, 12, 16, 20, 24, 28, 32, 28, 24, 20, 16, 12, 8, 4]
row_xoffs:   [14, 12, 10, 8, 6, 4, 2, 0, 2, 4, 6, 8, 10, 12, 14]
row_src_ofs: [0, 4, 12, 24, 40, 60, 84, 112, 144, 172, 196, 216, 232, 244, 252]
```

Win binary has these tables at: widths=0x0072db84, offsets=0x0072db48, src_ptrs=0x0072dbc0.
SPRITECACHE_AllocEntry (0x005fdea0, __stdcall) loads tile data into LRU cache. After call: pTile+0x50 = block count, pTile+0x54 = decoded block data pointer.

### Wall Tile Decoding (partially working)
RLE format: 2-byte headers per run (skip, count) + count raw palette bytes.
(0,0) = end of scanline. 32 scanlines per block.
Block pixel pointer at +0x10, same as ground tiles.
Currently producing partial results — some roofs render, positioning/sizing may be off.

### DC6 Sprite Decoding (working)
RLE-compressed indexed pixels, bottom-up scanlines.
- 0x80 = EOL (end of line)
- Byte with bit7 set: transparent run of (byte & 0x7F) pixels
- Byte with bit7 clear: literal run of N palette indices following

pDC6Block layout: width at +0x00, height at +0x04, pixel data pointer varies.
We call SPRITECACHE_GetOrLoadSprite (0x006001f0, __stdcall) to populate pDC6Block.

### Sprite Transparency Bug (known, unfixed)
Black rectangles around smoke/fire effects. The `mode` parameter in DrawImage controls blending:
- mode 0: normal alpha test (palette index 0 = transparent)
- mode 1: alpha blend
- mode 2: additive blend (fire, smoke, magic effects)
- mode 3+: other blend modes

We currently ignore `mode` entirely — always use simple alpha test. This is why fire/smoke has black borders: those sprites need additive blending (GL_SRC_ALPHA, GL_ONE).

### Naked Wrapper Pattern (working)
All 54 vtable entries are `__fastcall` (first 2 args in ECX/EDX, rest on stack, callee cleans).
Our naked asm wrappers save callee-saved regs (EBX/ESI/EDI/EBP), push fastcall args + stack args for a cdecl call, then `ret $N` for correct stack cleanup.

Example for 9-param function (2 fastcall + 7 stack):
```
push %ebp; mov %esp,%ebp
push %ebx; push %esi; push %edi
pushl 32(%ebp); pushl 28(%ebp); ... pushl 8(%ebp)  // 7 stack args
push %edx; push %ecx                                 // 2 fastcall args
call impl_function                                    // cdecl impl
add $36, %esp                                         // 9 args × 4
pop %edi; pop %esi; pop %ebx; pop %ebp
ret $28                                               // callee cleans 7 stack args × 4
```

### WGL Context Setup (working)
Lazy init on first BeginScene call:
1. Find game HWND via `FindWindowA("Diablo II")`
2. `GetDC(hwnd)` → `ChoosePixelFormat` → `SetPixelFormat`
3. `wglCreateContext(hdc)` → `wglMakeCurrent(hdc, hglrc)`
4. `glViewport(0, 0, 800, 600)` → `glMatrixMode(GL_PROJECTION)` → `glOrtho(0, 800, 600, 0, -1, 1)`
5. Enable GL_BLEND, GL_TEXTURE_2D

### Activation Mechanism (working)
Parse `-ogl` from `GetCommandLineA()` at DLL attach.
Overwrite `RENDERER_RenderedFunctionsSelector[1]` (Windowed) and `[3]` (DirectDraw) with our table pointer — covers both `-w` and default modes.
Reverts on cleanup.

### Wine Compatibility Notes
- Wine 11.0 on macOS ARM (M3 Max) via Homebrew + Rosetta 2
- `WINEDLLOVERRIDES="dbghelp=n"` needed in launch command
- GL context creation works through Wine's WGL→CGL bridge
- `SwapBuffers` works correctly through Wine

### Current File Structure (monolithic — needs splitting)
```
dllinject/src/renderer/
  ogl.zig          — ~1400 lines, everything in one file
```

## Target File Structure (after translation)

```
dllinject/src/renderer/
  ogl.zig              — Entry point: vtable array, earlyInit/cleanup, hasOglFlag,
                          imports from other modules. Naked wrappers live here.
                          (~300 lines)

  context.zig          — WGL context: lazy init, pixel format, ortho setup,
                          SwapBuffers. State: hdc, hglrc, initialized flag.
                          Source: D2OpenGL.cpp init/teardown sections (~200 lines)

  scene.zig            — BeginScene, EndScene1, EndScene2/PresentFrame, ClearScreen.
                          Source: D2OpenGL.cpp scene functions (~100 lines)

  palette.zig          — SetPalette, SetPaletteTable, BuildPaletteLookupTables.
                          Stores current_palette[256] RGBA. Gamma handling.
                          Source: D2OpenGL.cpp palette sections (~150 lines)

  sprite.zig           — DrawImage, DrawShiftedImage, DrawClippedImage,
                          DrawVerticalCropImage, DrawPerspectiveImage, DrawImageFast,
                          DrawShadow. DC6 RLE decode, palette expand, textured quad.
                          Blend mode handling (the transparency fix).
                          Source: oglSprite.cpp (~300 lines)

  vertex.zig           — DrawGroundTile (floor mesh), DrawWallTile,
                          DrawTransWallTile, DrawShadowTile.
                          Tile block decoding, diamond geometry, RLE wall decode.
                          Source: oglVertex.cpp (~500 lines)

  texture_cache.zig    — GL texture pool with LRU eviction. Alloc/free/lookup.
                          Replaces current per-frame texture gen/delete.
                          Source: COGLAGPTextures.cpp (~300 lines)

  primitives.zig       — DrawSolidRect, DrawSolidRectAlpha, DrawRect, DrawRectEx,
                          DrawSolidSquare, DrawLine. Simple GL immediate mode.
                          Source: D2OpenGL.cpp rect/line sections (~150 lines)

  perspective.zig      — SetPerspectiveScale, AdjustPerspectivePosition,
                          PerspectiveScalePosition, SetDefaultPerspectiveFactor.
                          Can stub initially — only needed for Act 5 perspective.
                          Source: oglPerspective.cpp (~50 lines)

  types.zig            — Shared types: Win32 (DWORD, BOOL, RECT, HDC, etc.),
                          GL constants, D2 struct layouts (D2GfxDataStrc offsets,
                          D2TileLibraryEntryStrc offsets). Calling convention defs.
                          Source: D2OpenGL.h + our current type defs (~150 lines)

  gl.zig               — OpenGL function imports (glBegin, glEnd, glTexImage2D, etc.)
                          WGL imports. All extern declarations in one place.
                          (~100 lines)
```

### Splitting Strategy
The split happens as part of the translation, not as a separate refactor step. For each Mac source file we translate:
1. Create the corresponding Zig target file
2. Move existing code from `ogl.zig` that belongs there
3. Translate new code from the Mac source
4. Update imports in `ogl.zig`

`ogl.zig` shrinks incrementally as code moves out. By the end it's just the vtable array, naked wrappers, and earlyInit.

## Verification
1. `cd dllinject && zig build -Doptimize=ReleaseSmall`
2. `./run.sh` — game launches with `-ogl`
3. Ground tiles render (same as before, now matching Mac logic)
4. Wall tiles render correctly (translated from Mac vertex code)
5. Sprites: fire/smoke/magic effects no longer have black borders (blend modes from Mac sprite code)
6. Menus and UI rectangles work
7. No crashes on act transitions
