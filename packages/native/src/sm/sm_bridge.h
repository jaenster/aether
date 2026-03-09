// sm_bridge.h — Thin C bridge for SpiderMonkey JSAPI
// Allows Zig to interact with SpiderMonkey via extern "C" functions.
#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Lifecycle — call once per process
int      sm_init(void);
void     sm_shutdown(void);

// Runtime — one per DLL (single-threaded)
void*    sm_create_runtime(int heap_limit_mb);
void     sm_destroy_runtime(void* runtime);

// Context — multiple per runtime (OOG, in-game)
void*    sm_create_context(void* runtime);
void     sm_destroy_context(void* context);

// Execution
// Evaluates source in context. Writes result string to result_buf.
// Returns length of result string, or -1 on error (error message in result_buf).
int      sm_eval(void* context, const char* source, int source_len,
                 char* result_buf, int result_buf_len);

// GC pump — call once per tick
void     sm_pump_gc(void* context);

// Diagnostics
int      sm_get_heap_used(void* runtime);
int      sm_get_heap_limit(void* runtime);

#ifdef __cplusplus
}
#endif
