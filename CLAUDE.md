# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build and Run
- `npm run build` - Compile TypeScript to JavaScript in `/dist`
- `npm run dev` - Build and run the server in development mode
- `npm start` - Start the compiled server from `/dist`
- `npm test` - Run Jest tests

### Environment Configuration
- `MAX_CACHE_SIZE` - Maximum cached entries (default: 1000)
- `CACHE_TTL` - Cache time-to-live in milliseconds (default: 1 hour)
- `MAX_FILE_SIZE` - Maximum file size in bytes for reading

## Architecture Overview

This is a Model Context Protocol (MCP) server that provides file system context and analysis to LLMs. The server is built using the MCP SDK and provides tools for reading, searching, and analyzing code files.

### Core Components

**Main Server Class (`src/index.ts`):**
- `FileContextServer` - Main server implementation handling MCP protocol
- Implements streaming, compression, and chunking for large files
- Provides file watching with automatic cache invalidation
- Handles cross-platform path compatibility (Windows/macOS/Linux)

**Services (`src/services/`):**
- `CodeAnalysisService` - Analyzes code complexity, dependencies, and quality metrics
- `FileWatcherService` - Real-time file system monitoring with chokidar
- `ProfileService` - Context generation profiles for different use cases
- `TemplateService` - Template rendering for prompts and context

**Type Definitions (`src/types.ts`):**
- Complete type definitions for file operations, caching, and analysis
- Error handling with custom `FileOperationError` class
- Profile and context specification interfaces

### Key Features

**File Operations:**
- Cross-platform path handling using POSIX-style paths for globs
- Streaming support for large files with configurable chunk sizes
- Automatic encoding detection (UTF-8, UTF-16LE with BOM support)
- LRU caching with TTL for performance optimization

**Code Analysis:**
- Cyclomatic complexity calculation
- Dependency extraction and analysis
- Code quality metrics (duplicate lines, long lines, complex functions)
- Language-specific analysis for TypeScript, JavaScript, Python

**Search and Filtering:**
- Regex pattern matching with context lines
- File type filtering by extension
- Recursive directory traversal
- Automatic exclusion of common artifact directories

**Profile System:**
- Multiple context generation profiles (code, code-prompt, code-file)
- Configurable file selection and exclusion rules
- Template-based prompt generation

### Tool Interface

The server exposes these MCP tools:
- `list_context_files` - List files with metadata
- `read_context` - Read file contents with chunking support
- `search_context` - Search for patterns in files
- `get_chunk_count` - Calculate chunks before reading large content
- `set_profile` - Switch context generation profiles
- `get_profile_context` - Generate structured repository context
- `generate_outline` - Create code structure outlines

### Path Handling

**Critical for cross-platform compatibility:**
- Use `path.posix.join()` for glob patterns
- Use `path.normalize()` for file system operations
- All internal paths are resolved to absolute paths
- Glob patterns use forward slashes regardless of OS

### Caching Strategy

**LRU Cache Implementation:**
- File content caching with modification time validation
- Automatic cache invalidation on file changes
- Configurable cache size and TTL
- Cache statistics tracking for performance monitoring

### Error Handling

**Structured Error Management:**
- Custom `FileOperationError` class with error codes
- Specific error codes: `FILE_NOT_FOUND`, `PERMISSION_DENIED`, `INVALID_PATH`, `FILE_TOO_LARGE`
- Graceful fallback for inaccessible files
- Detailed error context for debugging

### Testing

Run tests with `npm test` using Jest framework. The project uses TypeScript with strict type checking enabled.