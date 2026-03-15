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

// Call a named global function. Caches the function value after first lookup.
// Returns: 0=success, 1=function returned false, -1=null ctx, -2=not callable, -3=call failed
SM_API int      sm_call_global_function(void* context, const char* name);
SM_API void     sm_invalidate_call_cache(void);

// Native call profiling — returns count + QPC ticks since last call, then resets.
SM_API int      sm_get_native_call_stats(uint64_t* out_count, uint64_t* out_ticks);

// Native function registration
// callback signature: bool fn(void* context, unsigned argc, void* vp)
// Returns 0 on success, -1 on error.
typedef int (*sm_native_fn)(void* context, unsigned argc, void* vp);
SM_API int      sm_register_native_fn(void* context, const char* name, sm_native_fn fn, unsigned nargs);

// Argument/return helpers for native callbacks
// argc must match the actual call's argument count for correct JS::CallArgs layout.
SM_API double   sm_arg_double(unsigned argc, void* vp, unsigned idx);
SM_API int      sm_arg_int32(unsigned argc, void* vp, unsigned idx);
SM_API int      sm_arg_string(void* context, unsigned argc, void* vp, unsigned idx, char* buf, int buf_len);
SM_API void     sm_ret_double(unsigned argc, void* vp, double val);
SM_API void     sm_ret_int32(unsigned argc, void* vp, int val);
SM_API void     sm_ret_string(void* context, unsigned argc, void* vp, const char* str, int len);
SM_API void     sm_ret_bool(unsigned argc, void* vp, int val);
SM_API void     sm_ret_undefined(unsigned argc, void* vp);
// TypedArray support — extract raw pointer + length from a TypedArray/ArrayBuffer argument.
// Returns byte length, or 0 if argument is not a typed array.
SM_API int      sm_arg_uint8array(void* context, unsigned argc, void* vp, unsigned idx,
                                  const unsigned char** out_data);
// Return a new Int32Array (copies data). Used for structured data like path coordinates.
SM_API void     sm_ret_int32array(void* context, unsigned argc, void* vp,
                                  const int* data, int count);
// Return a new Uint8Array (copies data). Used for packet data.
SM_API void     sm_ret_uint8array(void* context, unsigned argc, void* vp,
                                  const unsigned char* data, int count);

// Module system
SM_API int      sm_module_init(void* context);
SM_API int      sm_module_compile(void* context,
                                  const char* specifier, int spec_len,
                                  const char* source, int source_len,
                                  char* err_buf, int err_buf_len);
SM_API int      sm_module_instantiate(void* context,
                                      const char* entry_spec, int spec_len,
                                      char* err_buf, int err_buf_len);
SM_API int      sm_module_evaluate(void* context,
                                   const char* entry_spec, int spec_len,
                                   char* err_buf, int err_buf_len);
SM_API void     sm_module_clear(void* context);

// Diagnostics
SM_API int      sm_get_heap_used(void* runtime);
SM_API int      sm_get_heap_limit(void* runtime);

#ifdef __cplusplus
}
#endif
