#####################################################################
## Compile definitions
add_definitions(-DJS_DEFAULT_JITREPORT_GRANULARITY=3)
add_definitions(-DWIN32 -D_WIN32)
add_definitions(-DXP_WIN)
add_definitions(-DWINVER=0x601)

# Make sure debug/release defines
if(CMAKE_BUILD_TYPE MATCHES "^(D|d)ebug$")
  add_definitions(-DDEBUG -D_DEBUG)
else()
  add_definitions(-DNDEBUG -D_NDEBUG)
endif()

# CPU arch
if(CMAKE_SIZEOF_VOID_P MATCHES 8)
  set(TARGET_CPU "x86_64")
  add_definitions(-D_AMD64_)
else()
  set(TARGET_CPU "x86")
  add_definitions(-D_X86_)
endif()

# option MOZJS_THREADSAFE
if(MOZJS_THREADSAFE)
  #set(JS_THREADSAFE ON)
  #add_definitions(-DJS_THREADSAFE)
  message(STATUS "Building SpiderMonkey with thread-safety ON")
endif()

if(MOZJS_ENABLE_ION)
  message(STATUS "Building SpiderMonkey with method-jit ON")
endif()

if(MOZJS_SM_PROMISE)
  message(STATUS "Building SpiderMonkey with Promise ON")
endif()

# option MOZJS_STATIC_RTL
if(MOZJS_STATIC_RTL)
  # Set runtime linking to /MT
  set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
  message(STATUS "Link against static runtime")
endif()

# TODO: Properly define version
add_definitions(-DMOZILLA_VERSION="0.0")

# Add the ESR version to directories so we don't override when doing multiple ESR builds
set(CMAKE_INSTALL_PREFIX ${CMAKE_INSTALL_PREFIX})
if(MOZJS_STATIC_LIB)
  set(LIBRARY_TYPE)
  set(LIBRARY_DIR lib)
  message(STATUS "Building static libraries")
  message(STATUS "Library install directory ${CMAKE_INSTALL_PREFIX}/${LIBRARY_DIR}")
else()
  set(LIBRARY_TYPE SHARED)
  set(LIBRARY_DIR bin)
  message(STATUS "Building dynamic libraries")
  message(STATUS "Library install directory ${CMAKE_INSTALL_PREFIX}/${LIBRARY_DIR}")
endif()

set(MOZJS_EXPORT_PREFIX "${CMAKE_BINARY_DIR}/include")
message(STATUS "Exporting public headers to ${MOZJS_EXPORT_PREFIX}")

set(MOZJS_TOP_DIR ${CMAKE_CURRENT_SOURCE_DIR})
