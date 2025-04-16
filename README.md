# File Context Server
[![smithery badge](https://smithery.ai/badge/@bsmi021/mcp-file-context-server)](https://smithery.ai/server/@bsmi021/mcp-file-context-server)

A Model Context Protocol (MCP) server that provides file system context to Large Language Models (LLMs). This server enables LLMs to read, search, and analyze code files with advanced caching and real-time file watching capabilities.

## Features

- **File Operations**
  - Read file and directory contents
  - List files with detailed metadata
  - Real-time file watching and cache invalidation
  - Support for multiple file encodings
  - Recursive directory traversal
  - File type filtering

- **Code Analysis**
  - Cyclomatic complexity calculation
  - Dependency extraction
  - Comment analysis
  - Quality metrics:
    - Duplicate lines detection
    - Long lines detection (>100 characters)
    - Complex function identification
    - Line counts (total, non-empty, comments)

- **Smart Caching**
  - LRU (Least Recently Used) caching strategy
  - Automatic cache invalidation on file changes
  - Size-aware caching with configurable limits
  - Cache statistics and performance metrics
  - Last read result caching for efficient searches

- **Advanced Search**
  - Regex pattern matching
  - Context-aware results with configurable surrounding lines
  - File type filtering
  - Multi-pattern search support
  - Cached result searching
  - Exclusion patterns

## Installation

### Installing via Smithery

To install File Context Server for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@bsmi021/mcp-file-context-server):

```bash
npx -y @smithery/cli install @bsmi021/mcp-file-context-server --client claude
```

### Manual Installation
```bash
npm install @modelcontextprotocol/file-context-server
```

## Usage

### Starting the Server

```bash
npx file-context-server
```

### Available Tools

1. **list_context_files**
   - Lists files in a directory with detailed metadata

   ```json
   {
     "path": "./src",
     "recursive": true,
     "includeHidden": false
   }
   ```

2. **read_context**
   - Reads file or directory contents with metadata

   ```json
   {
     "path": "./src/index.ts",
     "encoding": "utf8",
     "maxSize": 1000000,
     "recursive": true,
     "fileTypes": ["ts", "js"]
   }
   ```

3. **search_context**
   - Searches for patterns in files with context

   ```json
   {
     "pattern": "function.*",
     "path": "./src",
     "options": {
       "recursive": true,
       "contextLines": 2,
       "fileTypes": ["ts"]
     }
   }
   ```

4. **analyze_code**
   - Analyzes code files for quality metrics

   ```json
   {
     "path": "./src",
     "recursive": true,
     "metrics": ["complexity", "dependencies", "quality"]
   }
   ```

5. **cache_stats**
   - Gets cache statistics and performance metrics

   ```json
   {
     "detailed": true
   }
   ```

## Error Handling

The server provides detailed error messages with specific error codes:

- `FILE_NOT_FOUND`: File or directory does not exist
- `PERMISSION_DENIED`: Access permission issues
- `INVALID_PATH`: Invalid file path format
- `FILE_TOO_LARGE`: File exceeds size limit
- `ENCODING_ERROR`: File encoding issues
- `UNKNOWN_ERROR`: Unexpected errors

## Configuration

Environment variables for customization:

- `MAX_CACHE_SIZE`: Maximum number of cached entries (default: 1000)
- `CACHE_TTL`: Cache time-to-live in milliseconds (default: 1 hour)
- `MAX_FILE_SIZE`: Maximum file size in bytes for reading

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Start in development mode
npm run dev
```

## License

MIT

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## Cross-Platform Path Compatibility

**Note:** As of April 2025, all file and directory path handling in File Context Server has been updated for improved cross-platform compatibility (Windows, macOS, Linux):

- All glob patterns use POSIX-style paths (forward slashes) internally, ensuring consistent file matching regardless of OS.
- All file system operations (reading, writing, stat, etc.) use normalized absolute paths for reliability.
- If you are developing or extending the server, use `path.posix.join` for glob patterns and `path.normalize` for file system access.
- This change prevents issues with path separators and file matching on different operating systems.

No changes are required for end users, but developers should follow these conventions when contributing to the project.
