// rebuild-mpqs.c — Create minimal D2 MPQs containing only essential data files.
// Build: cc -o rebuild-mpqs rebuild-mpqs.c -I/opt/homebrew/include -L/opt/homebrew/lib -lstorm
// Usage: rebuild-mpqs <source-dir> <dest-dir>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <sys/stat.h>
#include <StormLib.h>

// Headless server: exclude all rendering assets and media.
// Renderers are stubbed so no sprites/fonts/UI are drawn.
static bool is_essential(const char *filename) {
    // Rendering assets — renderers are stubbed, nothing draws
    if (strcasestr(filename, ".dc6"))  return false;  // sprites
    if (strcasestr(filename, ".dcc"))  return false;  // animated sprites
    if (strcasestr(filename, ".cof"))  return false;  // animation descriptors
    if (strcasestr(filename, ".pl2"))  return false;  // palettes
    if (strcasestr(filename, ".pcx"))  return false;  // images
    // Audio/video
    if (strcasestr(filename, ".wav"))  return false;
    if (strcasestr(filename, ".bik"))  return false;
    return true;
}

// DT1 file format:
//   [0x00] int32  version1 (7)
//   [0x04] int32  version2 (6)
//   [0x08] 260 bytes unused
//   [0x10C] int32 num_blocks (tile count)
//   [0x110] int32 block_headers_offset (= 0x114)
//   [0x114] block headers: num_blocks * 96 bytes each
//     Per block header (96 bytes):
//       [+0x00] int32 direction
//       [+0x04] int16 roof_y
//       [+0x06] byte  sound
//       [+0x07] byte  animated
//       [+0x08] int32 size_y
//       [+0x0C] int32 size_x
//       [+0x10] 4 bytes unused
//       [+0x14] int32 orientation
//       [+0x18] int32 main_index
//       [+0x1C] int32 sub_index
//       [+0x20] int32 frame
//       [+0x24] 4 bytes unknown
//       [+0x28] 25 bytes floor_flags (COLLISION DATA - needed for server)
//       [+0x41] 7 bytes unused
//       [+0x48] int32 data_ptr (offset to pixel data within file)
//       [+0x4C] int32 data_length
//       [+0x50] int32 num_sub_blocks
//       [+0x54] 12 bytes unused
// After headers: pixel sub-block data (RENDERING ONLY - not needed)

static int strip_dt1(void *buf, DWORD size, void **out_buf, DWORD *out_size) {
    if (size < 0x114) return 0;
    unsigned char *data = (unsigned char *)buf;

    int32_t num_blocks;
    memcpy(&num_blocks, data + 0x10C, 4);
    if (num_blocks < 0 || num_blocks > 10000) return 0;

    // New size: file header (0x114) + block headers only
    DWORD header_size = 0x114 + num_blocks * 96;
    if (header_size > size) return 0;

    unsigned char *stripped = malloc(header_size);
    if (!stripped) return 0;
    memcpy(stripped, data, header_size);

    // Zero out pixel data references in each block header
    for (int i = 0; i < num_blocks; i++) {
        unsigned char *block = stripped + 0x114 + i * 96;
        int32_t zero = 0;
        memcpy(block + 0x48, &zero, 4);  // data_ptr = 0
        memcpy(block + 0x4C, &zero, 4);  // data_length = 0
        memcpy(block + 0x50, &zero, 4);  // num_sub_blocks = 0
    }

    *out_buf = stripped;
    *out_size = header_size;
    return 1;
}

static int copy_file(HANDLE src_mpq, HANDLE dst_mpq, const char *filename) {
    HANDLE hFile;
    if (!SFileOpenFileEx(src_mpq, filename, 0, &hFile)) {
        return 0; // skip silently
    }

    DWORD size_hi = 0;
    DWORD size = SFileGetFileSize(hFile, &size_hi);
    if (size == SFILE_INVALID_SIZE || size == 0) {
        SFileCloseFile(hFile);
        return 0;
    }

    void *buf = malloc(size);
    if (!buf) {
        SFileCloseFile(hFile);
        return 0;
    }

    DWORD read = 0;
    if (!SFileReadFile(hFile, buf, size, &read, NULL) || read != size) {
        free(buf);
        SFileCloseFile(hFile);
        return 0;
    }
    SFileCloseFile(hFile);

    // Strip pixel data from .dt1 files (keep headers + collision flags only)
    void *write_buf = buf;
    DWORD write_size = size;
    void *stripped = NULL;
    if (strcasestr(filename, ".dt1")) {
        if (strip_dt1(buf, size, &stripped, &write_size)) {
            write_buf = stripped;
        }
    }

    // Add to destination MPQ (ZLIB compressed)
    if (!SFileCreateFile(dst_mpq, filename, 0, write_size, 0, MPQ_FILE_COMPRESS | MPQ_FILE_REPLACEEXISTING, &hFile)) {
        free(stripped);
        free(buf);
        return 0;
    }

    if (!SFileWriteFile(hFile, write_buf, write_size, MPQ_COMPRESSION_ZLIB)) {
        SFileFinishFile(hFile);
        free(stripped);
        free(buf);
        return 0;
    }

    SFileFinishFile(hFile);
    free(stripped);
    free(buf);
    return 1;
}

static int rebuild_mpq(const char *src_path, const char *dst_path) {
    HANDLE src_mpq;
    if (!SFileOpenArchive(src_path, 0, STREAM_FLAG_READ_ONLY, &src_mpq)) {
        fprintf(stderr, "  Cannot open: %s (error %d)\n", src_path, SErrGetLastError());
        return -1;
    }

    // Enumerate files to count essentials
    SFILE_FIND_DATA find_data;
    HANDLE hFind;
    int total = 0, copied = 0;

    // First pass: count
    hFind = SFileFindFirstFile(src_mpq, "*", &find_data, NULL);
    if (hFind) {
        do {
            total++;
        } while (SFileFindNextFile(hFind, &find_data));
        SFileFindClose(hFind);
    }

    // Create destination MPQ — hash table must be large enough for all files
    HANDLE dst_mpq;
    if (!SFileCreateArchive(dst_path, MPQ_CREATE_ARCHIVE_V1, 16384, &dst_mpq)) {
        fprintf(stderr, "  Cannot create: %s (error %d)\n", dst_path, SErrGetLastError());
        SFileCloseArchive(src_mpq);
        return -1;
    }

    // Second pass: copy essentials
    hFind = SFileFindFirstFile(src_mpq, "*", &find_data, NULL);
    if (hFind) {
        do {
            if (is_essential(find_data.cFileName)) {
                if (copy_file(src_mpq, dst_mpq, find_data.cFileName)) {
                    copied++;
                }
            }
        } while (SFileFindNextFile(hFind, &find_data));
        SFileFindClose(hFind);
    }

    SFileCompactArchive(dst_mpq, NULL, 0);
    SFileCloseArchive(dst_mpq);
    SFileCloseArchive(src_mpq);

    printf("  %s: %d/%d files copied\n", dst_path, copied, total);
    return copied;
}

static int create_empty_mpq(const char *path) {
    HANDLE mpq;
    if (!SFileCreateArchive(path, MPQ_CREATE_ARCHIVE_V1, 4, &mpq)) {
        fprintf(stderr, "  Cannot create empty: %s\n", path);
        return -1;
    }
    SFileCloseArchive(mpq);
    printf("  %s: empty MPQ created\n", path);
    return 0;
}

int main(int argc, char **argv) {
    if (argc != 3) {
        fprintf(stderr, "Usage: %s <source-dir> <dest-dir>\n", argv[0]);
        fprintf(stderr, "  source-dir: full D2 install with original MPQs\n");
        fprintf(stderr, "  dest-dir:   output directory for minimal MPQs\n");
        return 1;
    }

    const char *src_dir = argv[1];
    const char *dst_dir = argv[2];

    mkdir(dst_dir, 0755);

    char src_path[512], dst_path[512];

    // Rebuild d2data.mpq
    printf("Rebuilding d2data.mpq...\n");
    snprintf(src_path, sizeof(src_path), "%s/d2data.mpq", src_dir);
    snprintf(dst_path, sizeof(dst_path), "%s/d2data.mpq", dst_dir);
    rebuild_mpq(src_path, dst_path);

    // Rebuild d2exp.mpq
    printf("Rebuilding d2exp.mpq...\n");
    snprintf(src_path, sizeof(src_path), "%s/d2exp.mpq", src_dir);
    snprintf(dst_path, sizeof(dst_path), "%s/d2exp.mpq", dst_dir);
    rebuild_mpq(src_path, dst_path);

    // Copy Patch_D2.mpq verbatim (2MB, hash-addressed obfuscated files)
    printf("Copying Patch_D2.mpq (verbatim)...\n");
    snprintf(src_path, sizeof(src_path), "%s/Patch_D2.mpq", src_dir);
    snprintf(dst_path, sizeof(dst_path), "%s/Patch_D2.mpq", dst_dir);
    {
        FILE *in = fopen(src_path, "rb");
        if (!in) { fprintf(stderr, "  Cannot open: %s\n", src_path); }
        else {
            FILE *out = fopen(dst_path, "wb");
            if (!out) { fprintf(stderr, "  Cannot create: %s\n", dst_path); fclose(in); }
            else {
                char buf[65536];
                size_t n;
                while ((n = fread(buf, 1, sizeof(buf), in)) > 0) fwrite(buf, 1, n, out);
                fclose(out);
                fclose(in);
                printf("  %s: copied verbatim\n", dst_path);
            }
        }
    }

    // Create empty stubs for all media MPQs the game expects
    printf("Creating empty media MPQ stubs...\n");
    const char *media_mpqs[] = {
        "d2sfx.mpq", "d2speech.mpq", "d2char.mpq",
        "d2music.mpq", "d2Xmusic.mpq", "d2Xtalk.mpq", "d2Xvideo.mpq",
        NULL
    };
    for (int i = 0; media_mpqs[i]; i++) {
        snprintf(dst_path, sizeof(dst_path), "%s/%s", dst_dir, media_mpqs[i]);
        create_empty_mpq(dst_path);
    }

    // Copy required DLLs that Game.exe imports
    printf("Copying required DLLs...\n");
    const char *required_dlls[] = { "binkw32.dll", "smackw32.dll", "ijl11.dll", "D2.LNG", NULL };
    for (int i = 0; required_dlls[i]; i++) {
        snprintf(src_path, sizeof(src_path), "%s/%s", src_dir, required_dlls[i]);
        snprintf(dst_path, sizeof(dst_path), "%s/%s", dst_dir, required_dlls[i]);
        FILE *in = fopen(src_path, "rb");
        if (!in) { fprintf(stderr, "  Warning: %s not found\n", src_path); continue; }
        FILE *out = fopen(dst_path, "wb");
        if (!out) { fclose(in); continue; }
        char buf[65536];
        size_t n;
        while ((n = fread(buf, 1, sizeof(buf), in)) > 0) fwrite(buf, 1, n, out);
        fclose(out);
        fclose(in);
        printf("  %s: copied\n", required_dlls[i]);
    }

    printf("\nDone. Copy Game.exe to %s to complete.\n", dst_dir);
    return 0;
}
