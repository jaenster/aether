// sm_bridge.cpp — C bridge implementation for SpiderMonkey ESR (~60+)
// This version uses the unified JSContext API (no separate JSRuntime).
#include "sm_bridge.h"

#include "jsapi.h"
#include "jsfriendapi.h"
#include "js/Initialization.h"
#include "js/Conversions.h"
#include "js/GCAPI.h"

#include <cstring>
#include <vector>
#include <string>

// ── Internal types ────────────────────────────────────────────────────

// "Runtime" handle — in post-52 SM there's no separate JSRuntime.
// We store the heap limit here; the actual JSContext is created per-context.
struct RuntimeHandle {
    int heap_limit_mb;
};

struct ModuleEntry {
    std::string specifier;
    JS::PersistentRootedObject module;
    ModuleEntry(JSContext* cx, const std::string& spec, JSObject* mod)
        : specifier(spec), module(cx, mod) {}
};

struct ContextHandle {
    JSContext* cx;
    JS::PersistentRootedObject global;
    std::vector<ModuleEntry*> modules;
    bool module_system_init = false;
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
        for (auto* entry : ch->modules)
            delete entry;
        ch->modules.clear();
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

// ── Module system ────────────────────────────────────────────────────

// Find a module in the registry by specifier
static ModuleEntry* find_module(ContextHandle* ch, const char* spec, size_t spec_len) {
    for (auto* entry : ch->modules) {
        if (entry->specifier.size() == spec_len &&
            memcmp(entry->specifier.data(), spec, spec_len) == 0)
            return entry;
    }
    return nullptr;
}

// Dirname: return everything up to and including the last '/'
static std::string path_dirname(const std::string& path) {
    auto pos = path.rfind('/');
    if (pos == std::string::npos) return "./";
    return path.substr(0, pos + 1);
}

// Normalize path: collapse "foo/../" and "./" segments
static std::string path_normalize(const std::string& path) {
    // Split on '/'
    std::vector<std::string> parts;
    size_t start = 0;
    bool absolute = false;
    if (!path.empty() && path[0] == '/') {
        absolute = true;
        start = 1;
    }
    for (size_t i = start; i <= path.size(); i++) {
        if (i == path.size() || path[i] == '/') {
            std::string seg = path.substr(start, i - start);
            start = i + 1;
            if (seg == "." || seg.empty()) continue;
            if (seg == ".." && !parts.empty() && parts.back() != "..") {
                parts.pop_back();
            } else {
                parts.push_back(seg);
            }
        }
    }
    std::string result;
    if (absolute) result = "/";
    for (size_t i = 0; i < parts.size(); i++) {
        if (i > 0) result += "/";
        result += parts[i];
    }
    return result;
}

// Resolve hook — called by SM60 during ModuleInstantiate
static bool module_resolve_hook(JSContext* cx, unsigned argc, JS::Value* vp) {
    JS::CallArgs args = JS::CallArgsFromVp(argc, vp);

    // Get ContextHandle from reserved slot
    JSObject* callee = &args.callee();
    const JS::Value& privval = js::GetFunctionNativeReserved(callee, 0);
    auto* ch = reinterpret_cast<ContextHandle*>(
        static_cast<uintptr_t>(privval.toPrivateUint32()));

    // arg0 = referencing module (or undefined), arg1 = specifier string
    JS::RootedObject refModule(cx);
    if (args[0].isObject())
        refModule = &args[0].toObject();

    JSString* specStr = args[1].toString();
    JSAutoByteString specBytes(cx, specStr);
    if (!specBytes.ptr()) {
        JS_ReportErrorASCII(cx, "module resolve: failed to get specifier string");
        return false;
    }

    std::string specifier = specBytes.ptr();

    // Resolution logic
    if (specifier.find("diablo:") == 0) {
        // Exact lookup for built-in modules
    } else if (specifier.find("./") == 0 || specifier.find("../") == 0) {
        // Relative path — resolve against referencing module's path
        if (refModule) {
            JS::Value hostDefined = JS::GetModuleHostDefinedField(refModule);
            if (hostDefined.isString()) {
                JSAutoByteString refPath(cx, hostDefined.toString());
                if (refPath.ptr()) {
                    std::string dir = path_dirname(refPath.ptr());
                    std::string resolved = path_normalize(dir + specifier);
                    // Ensure result starts with "./" to match daemon specifiers
                    if (resolved.find("./") != 0 && resolved.find("../") != 0 &&
                        resolved.find("diablo:") != 0 && resolved.find("/") != 0) {
                        resolved = "./" + resolved;
                    }
                    specifier = resolved;
                }
            }
        }
    }
    // Bare specifiers: exact lookup

    auto* entry = find_module(ch, specifier.data(), specifier.size());
    if (!entry) {
        std::string err = "Cannot resolve module '";
        err += specifier;
        err += "'";
        JS_ReportErrorASCII(cx, "%s", err.c_str());
        return false;
    }

    args.rval().setObject(*entry->module);
    return true;
}

int sm_module_init(void* context) {
    auto* ch = static_cast<ContextHandle*>(context);
    if (!ch) return -1;
    if (ch->module_system_init) return 0;

    JSContext* cx = ch->cx;
    JSAutoRequest ar(cx);
    JSAutoCompartment ac(cx, ch->global);

    // Create resolve hook function with ContextHandle in reserved slot
    JSFunction* hookFn = js::NewFunctionWithReserved(cx, module_resolve_hook, 2, 0,
                                                      "moduleResolveHook");
    if (!hookFn) return -1;

    JSObject* hookObj = JS_GetFunctionObject(hookFn);
    js::SetFunctionNativeReserved(hookObj, 0,
        JS::PrivateUint32Value(static_cast<uint32_t>(reinterpret_cast<uintptr_t>(ch))));

    JS::RootedFunction rootedHook(cx, hookFn);
    JS::SetModuleResolveHook(cx, rootedHook);

    ch->module_system_init = true;
    return 0;
}

int sm_module_compile(void* context,
                      const char* specifier, int spec_len,
                      const char* source, int source_len,
                      char* err_buf, int err_buf_len) {
    auto* ch = static_cast<ContextHandle*>(context);
    if (!ch) return write_error_msg("null context", err_buf, err_buf_len);

    JSContext* cx = ch->cx;
    JSAutoRequest ar(cx);
    JSAutoCompartment ac(cx, ch->global);

    // Convert UTF-8 source to char16_t (ASCII widening)
    size_t srcLen = static_cast<size_t>(source_len);
    char16_t stackBuf[65536];
    char16_t* wideBuf = stackBuf;
    bool heapAlloc = false;
    if (srcLen > sizeof(stackBuf) / sizeof(char16_t)) {
        wideBuf = static_cast<char16_t*>(js_malloc(srcLen * sizeof(char16_t)));
        if (!wideBuf) return write_error_msg("out of memory", err_buf, err_buf_len);
        heapAlloc = true;
    }
    for (size_t i = 0; i < srcLen; i++)
        wideBuf[i] = static_cast<char16_t>(static_cast<unsigned char>(source[i]));

    // CompileModule takes ownership when using GiveOwnership, but we use NoOwnership
    // so we can manage the buffer ourselves
    JS::SourceBufferHolder srcBufHolder(wideBuf, srcLen,
        heapAlloc ? JS::SourceBufferHolder::GiveOwnership
                  : JS::SourceBufferHolder::NoOwnership);

    JS::CompileOptions opts(cx);
    std::string specStr(specifier, spec_len);
    opts.setFileAndLine(specStr.c_str(), 1);

    JS::RootedObject moduleObj(cx);
    if (!JS::CompileModule(cx, opts, srcBufHolder, &moduleObj)) {
        if (JS_IsExceptionPending(cx)) {
            JS::RootedValue exc(cx);
            if (JS_GetPendingException(cx, &exc)) {
                JS_ClearPendingException(cx);
                JSString* exc_str = JS::ToString(cx, exc);
                if (exc_str) {
                    JSAutoByteString bytes(cx, exc_str);
                    if (bytes.ptr())
                        return write_error_msg(bytes.ptr(), err_buf, err_buf_len);
                }
            }
        }
        return write_error_msg("module compile failed", err_buf, err_buf_len);
    }

    // Set HostDefined field to the specifier (used for relative resolution)
    JSString* specJsStr = JS_NewStringCopyN(cx, specifier, spec_len);
    if (specJsStr) {
        JS::SetModuleHostDefinedField(moduleObj, JS::StringValue(specJsStr));
    }

    // Register in our module list
    auto* entry = new ModuleEntry(cx, specStr, moduleObj);
    ch->modules.push_back(entry);

    return 0;
}

int sm_module_instantiate(void* context,
                          const char* entry_spec, int spec_len,
                          char* err_buf, int err_buf_len) {
    auto* ch = static_cast<ContextHandle*>(context);
    if (!ch) return write_error_msg("null context", err_buf, err_buf_len);

    auto* entry = find_module(ch, entry_spec, spec_len);
    if (!entry) return write_error_msg("entry module not found", err_buf, err_buf_len);

    JSContext* cx = ch->cx;
    JSAutoRequest ar(cx);
    JSAutoCompartment ac(cx, ch->global);

    JS::RootedObject mod(cx, entry->module);
    if (!JS::ModuleInstantiate(cx, mod)) {
        if (JS_IsExceptionPending(cx)) {
            JS::RootedValue exc(cx);
            if (JS_GetPendingException(cx, &exc)) {
                JS_ClearPendingException(cx);
                JSString* exc_str = JS::ToString(cx, exc);
                if (exc_str) {
                    JSAutoByteString bytes(cx, exc_str);
                    if (bytes.ptr())
                        return write_error_msg(bytes.ptr(), err_buf, err_buf_len);
                }
            }
        }
        return write_error_msg("module instantiate failed", err_buf, err_buf_len);
    }
    return 0;
}

int sm_module_evaluate(void* context,
                       const char* entry_spec, int spec_len,
                       char* err_buf, int err_buf_len) {
    auto* ch = static_cast<ContextHandle*>(context);
    if (!ch) return write_error_msg("null context", err_buf, err_buf_len);

    auto* entry = find_module(ch, entry_spec, spec_len);
    if (!entry) return write_error_msg("entry module not found", err_buf, err_buf_len);

    JSContext* cx = ch->cx;
    JSAutoRequest ar(cx);
    JSAutoCompartment ac(cx, ch->global);

    JS::RootedObject mod(cx, entry->module);
    if (!JS::ModuleEvaluate(cx, mod)) {
        if (JS_IsExceptionPending(cx)) {
            JS::RootedValue exc(cx);
            if (JS_GetPendingException(cx, &exc)) {
                JS_ClearPendingException(cx);
                JSString* exc_str = JS::ToString(cx, exc);
                if (exc_str) {
                    JSAutoByteString bytes(cx, exc_str);
                    if (bytes.ptr())
                        return write_error_msg(bytes.ptr(), err_buf, err_buf_len);
                }
            }
        }
        return write_error_msg("module evaluate failed", err_buf, err_buf_len);
    }
    return 0;
}

void sm_module_clear(void* context) {
    auto* ch = static_cast<ContextHandle*>(context);
    if (!ch) return;
    for (auto* entry : ch->modules)
        delete entry;
    ch->modules.clear();
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
