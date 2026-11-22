cmake_minimum_required(VERSION 3.13)

project(tree-sitter-java
        VERSION "3.0.3"
        DESCRIPTION "Java grammar for tree-sitter"
        HOMEPAGE_URL "https://github.com/wotjr1649/tree-sitter-java"
        LANGUAGES C)

option(BUILD_SHARED_LIBS "Build using shared libraries" ON)
option(TREE_SITTER_REUSE_ALLOCATOR "Reuse the library allocator" OFF)

file(STRINGS "${CMAKE_CURRENT_SOURCE_DIR}/ci/tree-sitter-abi.txt" TREE_SITTER_DEFAULT_ABI_VERSION)
set(TREE_SITTER_ABI_VERSION "${TREE_SITTER_DEFAULT_ABI_VERSION}" CACHE STRING "Tree-sitter ABI version")
if(NOT "${TREE_SITTER_ABI_VERSION}" MATCHES "^[0-9]+$")
    unset(TREE_SITTER_ABI_VERSION CACHE)
    message(FATAL_ERROR "TREE_SITTER_ABI_VERSION must be an integer")
endif()

set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS src/parser.c)
file(STRINGS "${CMAKE_CURRENT_SOURCE_DIR}/src/parser.c" PARSER_ABI_DEFINE
     LIMIT_COUNT 1 REGEX "^#define LANGUAGE_VERSION [0-9]+$")
if(NOT PARSER_ABI_DEFINE MATCHES "^#define LANGUAGE_VERSION ([0-9]+)$")
    message(FATAL_ERROR "Cannot read LANGUAGE_VERSION from src/parser.c")
endif()
set(PARSER_ABI_VERSION "${CMAKE_MATCH_1}")

add_library(tree-sitter-java src/parser.c)
if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/src/scanner.c)
  target_sources(tree-sitter-java PRIVATE src/scanner.c)
endif()
target_include_directories(tree-sitter-java PRIVATE src)

target_compile_definitions(tree-sitter-java PRIVATE
                           $<$<BOOL:${TREE_SITTER_REUSE_ALLOCATOR}>:TREE_SITTER_REUSE_ALLOCATOR>
                           $<$<CONFIG:Debug>:TREE_SITTER_DEBUG>)

set_target_properties(tree-sitter-java
                      PROPERTIES
                      C_STANDARD 11
                      POSITION_INDEPENDENT_CODE ON
                      SOVERSION "${PARSER_ABI_VERSION}.${PROJECT_VERSION_MAJOR}"
                      DEFINE_SYMBOL "")

include(GNUInstallDirs)

foreach(dir IN ITEMS LIBDIR INCLUDEDIR)
    if(IS_ABSOLUTE "${CMAKE_INSTALL_${dir}}")
        set(PC_${dir} "${CMAKE_INSTALL_${dir}}")
    else()
        set(PC_${dir} "\${prefix}/${CMAKE_INSTALL_${dir}}")
    endif()
endforeach()
configure_file(bindings/c/tree-sitter-java.pc.in
               "${CMAKE_CURRENT_BINARY_DIR}/tree-sitter-java.pc" @ONLY)

install(FILES bindings/c/tree-sitter-java.h
        DESTINATION "${CMAKE_INSTALL_INCLUDEDIR}/tree_sitter")
install(FILES "${CMAKE_CURRENT_BINARY_DIR}/tree-sitter-java.pc"
        DESTINATION "${CMAKE_INSTALL_DATAROOTDIR}/pkgconfig")
install(TARGETS tree-sitter-java
        LIBRARY DESTINATION "${CMAKE_INSTALL_LIBDIR}")

find_program(TREE_SITTER_CLI tree-sitter DOC "Tree-sitter CLI")
if(TREE_SITTER_CLI)
    add_custom_target(ts-generate
                      COMMAND "${TREE_SITTER_CLI}" generate --abi "${TREE_SITTER_ABI_VERSION}" --js-runtime native
                      WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
                      VERBATIM)
    add_custom_target(ts-test
                      COMMAND "${TREE_SITTER_CLI}" test
                      WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
                      VERBATIM)
endif()
