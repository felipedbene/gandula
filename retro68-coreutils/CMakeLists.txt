# retro68-coreutils
#
# Cross build (the real target — classic Mac OS via Retro68):
#   cmake -S . -B build-m68k \
#     -DCMAKE_TOOLCHAIN_FILE=$RETRO68/m68k-apple-macos/cmake/retro68.toolchain.cmake
#   cmake --build build-m68k
#
#   cmake -S . -B build-ppc \
#     -DCMAKE_TOOLCHAIN_FILE=$RETRO68/powerpc-apple-macos/cmake/retroppc.toolchain.cmake
#   cmake --build build-ppc
#
# Building without a toolchain file produces host (POSIX) binaries for
# development; `make test` at the top of this directory does the same
# thing without CMake.

cmake_minimum_required(VERSION 3.9)
project(retro68_coreutils C)

set(GU_TOOLS
    true false echo cat head tail wc sort uniq basename dirname
    pwd ls mkdir rmdir rm mv cp touch date sleep uname)

set(GU_LIB_SOURCES
    lib/gufile.c
    lib/util.c
    lib/tool_main.c
    lib/compat_mac.c
    lib/compat_posix.c)

if(CMAKE_SYSTEM_NAME MATCHES Retro68)
    foreach(tool IN LISTS GU_TOOLS)
        # CONSOLE links Retro68's console runtime so stdio gets a window.
        add_application(${tool} CONSOLE src/${tool}.c ${GU_LIB_SOURCES})
        target_include_directories(${tool} PRIVATE include)
        target_compile_definitions(${tool} PRIVATE
            GU_MACOS GU_TOOLNAME="${tool}")
    endforeach()
else()
    foreach(tool IN LISTS GU_TOOLS)
        add_executable(${tool} src/${tool}.c ${GU_LIB_SOURCES})
        target_include_directories(${tool} PRIVATE include)
        target_compile_definitions(${tool} PRIVATE
            GU_HOST GU_TOOLNAME="${tool}")
    endforeach()
endif()
