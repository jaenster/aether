// rebuild-mpqs.c — Create minimal D2 MPQs containing only essential data files.
// Build: cc -o rebuild-mpqs rebuild-mpqs.c -I/opt/homebrew/include -L/opt/homebrew/lib -lstorm
// Usage: rebuild-mpqs <source-dir> <dest-dir>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <sys/stat.h>
#include <StormLib.h>

// File patterns we want to keep (case-insensitive prefix/suffix matching)
static bool is_essential(const char *filename) {
    // Data tables (.bin files in excel/)
    if (strcasestr(filename, "data\\global\\excel\\") && strcasestr(filename, ".bin"))
        return true;

    // String tables
    if (strcasestr(filename, ".tbl"))
        return true;

    // Animation data
    if (strcasestr(filename, "animdata.d2"))
        return true;

    // Palettes (pal.dat and pal.pl2 — both required for act palette loading)
    if (strcasestr(filename, "data\\global\\palette\\"))
        return true;

    // Fonts (DC6 font sprites — needed for text rendering)
    if (strcasestr(filename, "data\\local\\font\\"))
        return true;

    // Level presets (DS1 files only — DT1 tile graphics are stubbed)
    if (strcasestr(filename, ".ds1"))
        return true;

    return false;
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

    // Add to destination MPQ (ZLIB compressed)
    if (!SFileCreateFile(dst_mpq, filename, 0, size, 0, MPQ_FILE_COMPRESS | MPQ_FILE_REPLACEEXISTING, &hFile)) {
        free(buf);
        return 0;
    }

    if (!SFileWriteFile(hFile, buf, size, MPQ_COMPRESSION_ZLIB)) {
        SFileFinishFile(hFile);
        free(buf);
        return 0;
    }

    SFileFinishFile(hFile);
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

    // Create destination MPQ (estimate max 2048 files)
    HANDLE dst_mpq;
    if (!SFileCreateArchive(dst_path, MPQ_CREATE_ARCHIVE_V1, 2048, &dst_mpq)) {
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

    // Copy Patch_D2.mpq as-is (small, uses obfuscated filenames)
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

    // Create empty stubs for sound MPQs
    printf("Creating empty sound MPQ stubs...\n");
    snprintf(dst_path, sizeof(dst_path), "%s/d2sfx.mpq", dst_dir);
    create_empty_mpq(dst_path);
    snprintf(dst_path, sizeof(dst_path), "%s/d2speech.mpq", dst_dir);
    create_empty_mpq(dst_path);

    printf("\nDone. Copy Game.exe to %s to complete.\n", dst_dir);
    return 0;
}
