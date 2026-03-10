#ifndef js_confdefs_h
#define js_confdefs_h

/* Platform */
#define XP_WIN 1
#define WIN32 1
#define _WIN32 1
#define _X86_ 1
#define WINVER 0x601

/* SpiderMonkey core */
#define JS_32BIT 1
#define JS_NUNBOX32 1
#define JS_CODEGEN_X86 1
#define JS_ION 1
#define JSGC_INCREMENTAL 1
#define STATIC_JS_API 1

/* Build config */
#define MOZILLA_VERSION "0.0"
#define JS_DEFAULT_JITREPORT_GRANULARITY 3
#define PSAPI_VERSION 1
#define _USE_MATH_DEFINES 1
#define NOMINMAX 1

/* Disable jemalloc initially */
/* #undef MOZ_MEMORY */

/* Disable thread safety initially */
/* #undef JS_THREADSAFE */
/* #undef JS_POSIX_NSPR */

#include "js/RequiredDefines.h"

#endif /* js_confdefs_h */
