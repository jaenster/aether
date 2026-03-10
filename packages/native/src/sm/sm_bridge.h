// sm_bridge.h — Thin C bridge for SpiderMonkey JSAPI
// When built as mozjs.dll (MOZJS_DLL_BUILD), functions are dllexported.
// When consumed by Zig (MOZJS_DLL_IMPORT), functions are dllimported.
#pragma once

#include <stdint.h>

#if defined(MOZJS_DLL_BUILD)
#define SM_API __declspec(dllexport)
#elif defined(MOZJS_DLL_IMPORT)
#define SM_API __declspec(dllimport)
#else
#define SM_API
#endif

#ifdef __cplusplus
extern "C" {
#endif

// Lifecycle — call once per process
SM_API int      sm_init(void);
SM_API void     sm_shutdown(void);

// Runtime — one per DLL (single-threaded)
SM_API void*    sm_create_runtime(int heap_limit_mb);
SM_API void     sm_destroy_runtime(void* runtime);

// Context — multiple per runtime (OOG, in-game)
SM_API void*    sm_create_context(void* runtime);
SM_API void     sm_destroy_context(void* context);

// Execution
// Evaluates source in context. Writes result string to result_buf.
// Returns length of result string, or -1 on error (error message in result_buf).
SM_API int      sm_eval(void* context, const char* source, int source_len,
                        char* result_buf, int result_buf_len);

// GC pump — call once per tick
SM_API void     sm_pump_gc(void* context);

// Diagnostics
SM_API int      sm_get_heap_used(void* runtime);
SM_API int      sm_get_heap_limit(void* runtime);

#ifdef __cplusplus
}
#endif
