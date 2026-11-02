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

# The browser verifier (Emscripten builds only): see neurals-wasm.cpp.
if (EMSCRIPTEN)
  add_executable(neurals-wasm neurals-wasm.cpp)
  target_link_libraries(neurals-wasm PRIVATE llama ggml)
  target_link_options(neurals-wasm PRIVATE
    --no-entry -O3
    -sEXPORTED_FUNCTIONS=_neurals_load,_neurals_measure,_malloc,_free
    -sEXPORTED_RUNTIME_METHODS=ccall,FS,HEAPF64,HEAP32
    -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB -sSTACK_SIZE=8MB
    -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=NeuralsWasm
    -sENVIRONMENT=worker,node -sFORCE_FILESYSTEM=1 -lworkerfs.js -lnodefs.js)
endif()
