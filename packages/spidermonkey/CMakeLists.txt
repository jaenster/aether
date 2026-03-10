cmake_minimum_required(VERSION 3.24)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED True)

project(mozjs)

include("cmake/options.cmake")
include("cmake/configure.cmake")

add_subdirectory(src)

