// sm_bridge.cpp — C bridge implementation for SpiderMonkey ESR (~60+)
// This version uses the unified JSContext API (no separate JSRuntime).
#include "sm_bridge.h"

#include "jsapi.h"
#include "jsfriendapi.h"
#include "js/Initialization.h"
#include "js/Conversions.h"
#include "js/GCAPI.h"

#include <cstring>

// ── Internal types ────────────────────────────────────────────────────

// "Runtime" handle — in post-52 SM there's no separate JSRuntime.
// We store the heap limit here; the actual JSContext is created per-context.
struct RuntimeHandle {
    int heap_limit_mb;
};

struct ContextHandle {
    JSContext* cx;
    JS::PersistentRootedObject global;
};

static const JSClassOps global_classOps = {
    nullptr, nullptr, nullptr, nullptr,
    nullptr, nullptr, nullptr, nullptr,
    nullptr, nullptr,
    JS_GlobalObjectTraceHook
};

static JSClass global_class = {
    "global",
    JSCLASS_GLOBAL_FLAGS,
    &global_classOps
};

// ── Helpers ──────────────────────────────────────────────────────────

static int write_to_buf(const char* src, int src_len,
                        char* buf, int buf_len) {
    if (buf_len <= 0) return src_len;
    int n = (src_len < buf_len - 1) ? src_len : (buf_len - 1);
    memcpy(buf, src, n);
    buf[n] = '\0';
    return src_len;
}

static int write_error_msg(const char* msg, char* buf, int buf_len) {
    int len = static_cast<int>(strlen(msg));
    write_to_buf(msg, len, buf, buf_len);
    return -1;
}

// ── Lifecycle ─────────────────────────────────────────────────────────

// Disable helper threads — single-threaded embedding, no off-thread compilation needed
namespace js { void DisableExtraThreads(); }

int sm_init(void) {
    if (!JS_Init()) return -1;
    js::DisableExtraThreads();
    return 0;
}

void sm_shutdown(void) {
    JS_ShutDown();
}

// ── Runtime (thin wrapper, actual work happens in create_context) ─────

void* sm_create_runtime(int heap_limit_mb) {
    auto* handle = new RuntimeHandle();
    handle->heap_limit_mb = heap_limit_mb;
    return static_cast<void*>(handle);
}

void sm_destroy_runtime(void* runtime) {
    delete static_cast<RuntimeHandle*>(runtime);
}

// ── Context ───────────────────────────────────────────────────────────

void* sm_create_context(void* runtime) {
    auto* rh = static_cast<RuntimeHandle*>(runtime);
    if (!rh) return nullptr;

    size_t max_bytes = (rh->heap_limit_mb > 0)
        ? static_cast<size_t>(rh->heap_limit_mb) * 1024 * 1024
        : 64 * 1024 * 1024;

    JSContext* cx = JS_NewContext(max_bytes);
    if (!cx) return nullptr;

    JS_SetNativeStackQuota(cx, 512 * 1024);

    JS_SetParallelParsingEnabled(cx, false);
    JS_SetOffthreadIonCompilationEnabled(cx, false);

    // Disable baseline JIT during self-hosted code init (heavy compile overhead),
    // then re-enable for user code. Ion stays enabled for hot user functions.
    JS_SetGlobalJitCompilerOption(cx, JSJITCOMPILER_BASELINE_ENABLE, 0);
    JS_SetGlobalJitCompilerOption(cx, JSJITCOMPILER_ION_ENABLE, 0);

    if (!JS::InitSelfHostedCode(cx)) {
        JS_DestroyContext(cx);
        return nullptr;
    }

    // Re-enable JIT for user code
    JS_SetGlobalJitCompilerOption(cx, JSJITCOMPILER_BASELINE_ENABLE, 1);
    JS_SetGlobalJitCompilerOption(cx, JSJITCOMPILER_ION_ENABLE, 1);

    auto* ch = new ContextHandle();
    ch->cx = cx;

    JSAutoRequest ar(cx);

    JS::CompartmentOptions options;
    JS::RootedObject global(cx,
        JS_NewGlobalObject(cx, &global_class, nullptr,
                           JS::FireOnNewGlobalHook, options));
    if (!global) {
        JS_DestroyContext(cx);
        delete ch;
        return nullptr;
    }

    ch->global.init(cx, global);

    JSAutoCompartment ac(cx, global);
    if (!JS_InitStandardClasses(cx, global)) {
        JS_DestroyContext(cx);
        delete ch;
        return nullptr;
    }

    return static_cast<void*>(ch);
}

void sm_destroy_context(void* context) {
    auto* ch = static_cast<ContextHandle*>(context);
    if (ch) {
        ch->global.reset();
        JS_DestroyContext(ch->cx);
        delete ch;
    }
}

// ── Eval ──────────────────────────────────────────────────────────────

int sm_eval(void* context, const char* source, int source_len,
            char* result_buf, int result_buf_len) {
    auto* ch = static_cast<ContextHandle*>(context);
    if (!ch) return write_error_msg("null context", result_buf, result_buf_len);

    JSContext* cx = ch->cx;
    JSAutoRequest ar(cx);
    JSAutoCompartment ac(cx, ch->global);

    JS::RootedValue rval(cx);

    JS::CompileOptions opts(cx);
    opts.setFileAndLine("eval", 1);

    bool ok = JS::Evaluate(cx, opts, source, static_cast<size_t>(source_len), &rval);
    if (!ok) {
        if (JS_IsExceptionPending(cx)) {
            JS::RootedValue exc(cx);
            if (JS_GetPendingException(cx, &exc)) {
                JS_ClearPendingException(cx);
                JSString* exc_str = JS::ToString(cx, exc);
                if (exc_str) {
                    JSAutoByteString bytes(cx, exc_str);
                    if (bytes.ptr()) {
                        return write_error_msg(bytes.ptr(), result_buf, result_buf_len);
                    }
                }
            }
        }
        return write_error_msg("evaluation failed", result_buf, result_buf_len);
    }

    if (rval.isUndefined()) {
        return write_to_buf("undefined", 9, result_buf, result_buf_len);
    }

    JSString* str = JS::ToString(cx, rval);
    if (!str) {
        return write_to_buf("undefined", 9, result_buf, result_buf_len);
    }

    JSAutoByteString bytes(cx, str);
    if (!bytes.ptr()) {
        return write_to_buf("undefined", 9, result_buf, result_buf_len);
    }

    const char* cstr = bytes.ptr();
    int len = static_cast<int>(strlen(cstr));
    return write_to_buf(cstr, len, result_buf, result_buf_len);
}

// ── Native function registration ─────────────────────────────────────

// Trampoline: SM calls this, we forward to the sm_native_fn stored in reserved slot 0.
static bool native_trampoline(JSContext* cx, unsigned argc, JS::Value* vp) {
    JS::CallArgs args = JS::CallArgsFromVp(argc, vp);

    JSObject* callee = &args.callee();
    const JS::Value& fnval = js::GetFunctionNativeReserved(callee, 0);
    auto fn = reinterpret_cast<sm_native_fn>(static_cast<uintptr_t>(fnval.toPrivateUint32()));

    return fn(cx, argc, vp) != 0;
}

int sm_register_native_fn(void* context, const char* name, sm_native_fn fn, unsigned nargs) {
    auto* ch = static_cast<ContextHandle*>(context);
    if (!ch) return -1;

    JSContext* cx = ch->cx;
    JSAutoRequest ar(cx);
    JSAutoCompartment ac(cx, ch->global);

    JSFunction* jsfn = js::NewFunctionWithReserved(cx, native_trampoline, nargs, 0, name);
    if (!jsfn) return -1;

    JSObject* fnobj = JS_GetFunctionObject(jsfn);
    js::SetFunctionNativeReserved(fnobj, 0,
        JS::PrivateUint32Value(static_cast<uint32_t>(reinterpret_cast<uintptr_t>(fn))));

    JS::RootedObject global(cx, ch->global);
    JS::RootedValue fnval(cx, JS::ObjectValue(*fnobj));
    if (!JS_DefineProperty(cx, global, name, fnval, JSPROP_ENUMERATE | JSPROP_READONLY | JSPROP_PERMANENT))
        return -1;

    return 0;
}

// ── Argument/return helpers ──────────────────────────────────────────

double sm_arg_double(unsigned argc, void* vp, unsigned idx) {
    JS::CallArgs args = JS::CallArgsFromVp(argc, static_cast<JS::Value*>(vp));
    if (idx < args.length() && args[idx].isDouble())
        return args[idx].toDouble();
    if (idx < args.length() && args[idx].isInt32())
        return static_cast<double>(args[idx].toInt32());
    return 0.0;
}

int sm_arg_int32(unsigned argc, void* vp, unsigned idx) {
    JS::CallArgs args = JS::CallArgsFromVp(argc, static_cast<JS::Value*>(vp));
    if (idx < args.length() && args[idx].isInt32())
        return args[idx].toInt32();
    if (idx < args.length() && args[idx].isDouble())
        return static_cast<int>(args[idx].toDouble());
    return 0;
}

int sm_arg_string(void* context, unsigned argc, void* vp, unsigned idx, char* buf, int buf_len) {
    auto* cx = static_cast<JSContext*>(context);
    JS::CallArgs args = JS::CallArgsFromVp(argc, static_cast<JS::Value*>(vp));
    if (idx >= args.length()) return 0;

    JSString* str = JS::ToString(cx, args[idx]);
    if (!str) return 0;

    JSAutoByteString bytes(cx, str);
    if (!bytes.ptr()) return 0;

    int len = static_cast<int>(strlen(bytes.ptr()));
    int n = (len < buf_len - 1) ? len : (buf_len - 1);
    memcpy(buf, bytes.ptr(), n);
    buf[n] = '\0';
    return n;
}

void sm_ret_double(unsigned argc, void* vp, double val) {
    JS::CallArgs args = JS::CallArgsFromVp(argc, static_cast<JS::Value*>(vp));
    args.rval().setDouble(val);
}

void sm_ret_int32(unsigned argc, void* vp, int val) {
    JS::CallArgs args = JS::CallArgsFromVp(argc, static_cast<JS::Value*>(vp));
    args.rval().setInt32(val);
}

void sm_ret_string(void* context, unsigned argc, void* vp, const char* str, int len) {
    auto* cx = static_cast<JSContext*>(context);
    JS::CallArgs args = JS::CallArgsFromVp(argc, static_cast<JS::Value*>(vp));
    JSString* s = JS_NewStringCopyN(cx, str, static_cast<size_t>(len));
    if (s)
        args.rval().setString(s);
    else
        args.rval().setUndefined();
}

void sm_ret_bool(unsigned argc, void* vp, int val) {
    JS::CallArgs args = JS::CallArgsFromVp(argc, static_cast<JS::Value*>(vp));
    args.rval().setBoolean(val != 0);
}

void sm_ret_undefined(unsigned argc, void* vp) {
    JS::CallArgs args = JS::CallArgsFromVp(argc, static_cast<JS::Value*>(vp));
    args.rval().setUndefined();
}

// ── GC pump ──────────────────────────────────────────────────────────

void sm_pump_gc(void* context) {
    auto* ch = static_cast<ContextHandle*>(context);
    if (ch) {
        JS_MaybeGC(ch->cx);
    }
}

// ── Diagnostics ───────────────────────────────────────────────────────

int sm_get_heap_used(void* runtime) {
    // In the unified API, we don't have a context from just the runtime handle.
    // This will need to be called with a context in practice.
    // For now, return 0 — will be fixed when we have proper context tracking.
    (void)runtime;
    return 0;
}

int sm_get_heap_limit(void* runtime) {
    auto* rh = static_cast<RuntimeHandle*>(runtime);
    if (!rh) return 0;
    return rh->heap_limit_mb * 1024 * 1024;
}
