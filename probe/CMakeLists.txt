# Builds neurals-probe against a pinned llama.cpp checkout (see scripts/build-probe.sh).
cmake_minimum_required(VERSION 3.16)
project(neurals-probe CXX C)
set(CMAKE_CXX_STANDARD 17)

if(NOT LLAMA_DIR)
  message(FATAL_ERROR "set -DLLAMA_DIR=<llama.cpp checkout>")
endif()
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_CURL OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
add_subdirectory(${LLAMA_DIR} llama.cpp EXCLUDE_FROM_ALL)

add_executable(neurals-probe neurals-probe.cpp)
target_link_libraries(neurals-probe PRIVATE llama ggml)

add_executable(neurals-traits neurals-traits.cpp)
target_link_libraries(neurals-traits PRIVATE llama ggml)
