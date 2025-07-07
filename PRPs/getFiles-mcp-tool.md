name: "getFiles MCP Tool Implementation"
description: |

## Purpose
Implement a new MCP server tool that accepts an array of file paths and quickly retrieves each file's content and metadata, returning a predictable schema for MCP clients. This enables efficient batch file retrieval for MCP client applications.

## Core Principles
1. **Context is King**: Include ALL necessary documentation, examples, and caveats
2. **Validation Loops**: Provide executable tests/lints the AI can run and fix
3. **Information Dense**: Use keywords and patterns from the codebase
4. **Progressive Success**: Start simple, validate, then enhance
5. **Global rules**: Be sure to follow all rules in CLAUDE.md

---

## Goal
Implement a new MCP tool called `getFiles` that accepts an array of file paths and returns structured file data (content, metadata) in a fixed, predictable schema that MCP clients can reliably work with.

## Why
- **Business value**: Enables efficient batch file retrieval for MCP clients
- **Integration**: Provides predictable interface for file access across different MCP client applications
- **Problems solved**: Eliminates need for multiple individual file requests, provides standardized file metadata format

## What
A new MCP tool that:
- Accepts array of file paths via `filePathList` parameter
- Returns structured array of file objects with content and metadata
- Uses existing file reading infrastructure for consistency
- Handles errors gracefully with partial results
- Follows established security and validation patterns

### Success Criteria
- [ ] `getFiles` tool defined in MCP tool schema
- [ ] Tool accepts `filePathList` array as per examples/getFiles_request_schema.json
- [ ] Returns file objects matching examples/getFiles_response_schema.json
- [ ] Handles non-existent files gracefully without failing entire request
- [ ] Uses existing security validation (path access checks)
- [ ] All validation gates pass (build, tests, lint)

## All Needed Context

### Documentation & References
```yaml
# MUST READ - Include these in your context window
- file: /mnt/c/Projects/mcp-servers/mcp-context-server/src/index.ts
  why: Contains FileContextServer class and existing tool implementation patterns
  critical: handleReadFile, handleListFiles methods show file reading patterns
  
- file: /mnt/c/Projects/mcp-servers/mcp-context-server/src/tools.ts
  why: Tool schema definitions and input validation patterns
  critical: Shows how to define new tools with proper inputSchema
  
- file: /mnt/c/Projects/mcp-servers/mcp-context-server/src/types.ts
  why: FileMetadata, FileContent interfaces and error handling patterns
  critical: FileOperationError class and FileErrorCode enum for error handling
  
- file: /mnt/c/Projects/mcp-servers/mcp-context-server/examples/getFiles_request_schema.json
  why: Exact request schema that must be implemented
  critical: filePathList array with fileName objects
  
- file: /mnt/c/Projects/mcp-servers/mcp-context-server/examples/getFiles_response_schema.json
  why: Exact response schema that must be returned
  critical: Array of file objects with fileName, content, fileSize, lastModifiedDateTime

- url: https://modelcontextprotocol.io/specification/2025-06-18
  why: MCP protocol specifications for tool development
  critical: Tool security principles and response format requirements

- file: /mnt/c/Projects/mcp-servers/mcp-context-server/CLAUDE.md
  why: Development commands and architecture patterns
  critical: npm run build, npm run dev, npm test commands for validation
```

### Current Codebase tree (relevant files)
```bash
src/
├── index.ts              # Main FileContextServer class with tool handlers
├── tools.ts              # MCP tool schema definitions
├── types.ts              # TypeScript interfaces and error classes
└── services/             # Supporting services (FileWatcherService, etc.)

examples/
├── getFiles_request_schema.json   # Required request format
└── getFiles_response_schema.json  # Required response format

docs/
├── llms-full.txt         # MCP client compatibility information
└── mcp-typescript-readme.md  # MCP TypeScript SDK patterns
```

### Desired Codebase tree with files to be modified
```bash
src/
├── index.ts              # ADD: handleGetFiles method, ADD: case 'getFiles' to switch
├── tools.ts              # ADD: getFiles tool schema definition
└── types.ts              # No changes needed (existing interfaces sufficient)
```

### Known Gotchas & Library Quirks
```typescript
// CRITICAL: MCP requires explicit user consent before tool invocation
// CRITICAL: Always use path.resolve() for security validation via validateAccess()
// CRITICAL: Use existing createJsonResponse() method for consistent response format
// CRITICAL: Handle file errors gracefully - return partial results, don't fail entire request
// CRITICAL: FileMetadata.modifiedTime uses ISO string format (toISOString())
// CRITICAL: Tool schema must match exact format in tools.ts pattern
// CRITICAL: Use existing readFileWithEncoding() method for consistent file reading
// CRITICAL: Follow existing error handling with FileOperationError class
```

## Implementation Blueprint

### Data models and structure

Using existing interfaces from types.ts - no new models needed:
```typescript
// Existing interfaces to leverage:
interface FileMetadata {
    size: number;
    mimeType: string;
    modifiedTime: string;  // ISO format
    createdTime: string;
    isDirectory: boolean;
    // ... other optional fields
}

// Response will be array of objects matching getFiles_response_schema.json:
interface GetFilesResponse {
    fileName: string;
    content: string;
    fileSize: number;
    lastModifiedDateTime: string; // ISO format
}
```

### List of tasks to be completed in order

```yaml
Task 1: Add getFiles tool schema to tools.ts
MODIFY src/tools.ts:
  - FIND: export const tools: typeof ToolSchema[] = [
  - ADD: New tool object after existing tools
  - PATTERN: Mirror existing tool structures with name, description, inputSchema
  - SCHEMA: Match examples/getFiles_request_schema.json exactly

Task 2: Add getFiles case to request handler
MODIFY src/index.ts:
  - FIND: switch (request.params.name) {
  - ADD: case 'getFiles': return await this.handleGetFiles(request.params.arguments);
  - PATTERN: Follow existing case statements for other tools

Task 3: Implement handleGetFiles method
CREATE new private method in FileContextServer class:
  - PATTERN: Follow handleReadFile method structure
  - VALIDATE: Use existing validateAccess for security
  - READ: Use existing readFileWithEncoding and getFileMetadata methods
  - ERROR: Handle FileOperationError gracefully, continue with other files
  - RETURN: Use createJsonResponse with array matching response schema

Task 4: Test implementation
RUN validation commands:
  - npm run build (compile TypeScript)
  - npm run dev (test server startup)
  - npm test (run existing tests)
  - Manual test with MCP client or curl
```

### Per task pseudocode

```typescript
// Task 1: Tool schema (add to tools.ts)
{
    name: 'getFiles',
    description: 'Retrieve multiple files by their paths, returning content and metadata for each file',
    inputSchema: {
        type: 'object',
        properties: {
            filePathList: {
                type: 'array',
                description: 'The list of file paths for the file content to return.',
                minItems: 1,
                items: {
                    type: 'object',
                    properties: {
                        fileName: {
                            type: 'string',
                            description: 'Path and file name for the file to be retrieved.'
                        }
                    },
                    required: ['fileName']
                }
            }
        },
        required: ['filePathList']
    }
}

// Task 3: Handler implementation
private async handleGetFiles(args: any) {
    const { filePathList } = args;
    
    if (!Array.isArray(filePathList)) {
        throw new McpError(ErrorCode.InvalidParams, 'filePathList must be an array');
    }

    const results: any[] = [];

    // Process each file, handling errors gracefully
    for (const fileItem of filePathList) {
        const filePath = fileItem.fileName;
        
        try {
            // PATTERN: Use existing security validation
            const resolvedPath = await this.validateAccess(filePath);
            
            // PATTERN: Use existing file reading methods
            const metadata = await this.getFileMetadata(resolvedPath);
            const { content } = await this.readFileWithEncoding(resolvedPath, 'utf8');
            
            // TRANSFORM: Match required response schema
            results.push({
                fileName: filePath,
                content: content,
                fileSize: metadata.size,
                lastModifiedDateTime: metadata.modifiedTime
            });
        } catch (error) {
            // GOTCHA: Don't fail entire request - log error and continue
            console.error(`Error reading file ${filePath}:`, error);
            
            // Optional: include error info in response
            results.push({
                fileName: filePath,
                content: `Error: ${error.message}`,
                fileSize: 0,
                lastModifiedDateTime: new Date().toISOString()
            });
        }
    }

    // PATTERN: Use existing response format method
    return this.createJsonResponse(results);
}
```

### Integration Points
```yaml
SECURITY:
  - Uses existing validateAccess() for path security validation
  - Leverages existing file access permission checking
  
ERROR_HANDLING:
  - Uses existing FileOperationError patterns
  - Graceful failure - continue processing other files on individual errors
  
RESPONSE_FORMAT:
  - Uses existing createJsonResponse() method
  - Maintains consistency with other tool responses
  
FILE_READING:
  - Reuses existing readFileWithEncoding() method
  - Reuses existing getFileMetadata() method
  - Leverages existing encoding detection and caching
```

## Validation Loop

### Level 1: Syntax & Style
```bash
# Run these FIRST - fix any errors before proceeding
npm run build              # TypeScript compilation
# Expected: No compilation errors

# If errors: Read TypeScript error messages, fix type issues, re-run
```

### Level 2: Server Functionality
```bash
# Test server starts successfully
npm run dev
# Expected: "File Context MCP server running on stdio" message

# If failing: Check console for startup errors, fix and restart
```

### Level 3: Tool Integration Test
```typescript
// Manual test using MCP client or tool like curl/postman
// Test case 1: Valid files
{
  "method": "tools/call",
  "params": {
    "name": "getFiles",
    "arguments": {
      "filePathList": [
        {"fileName": "package.json"},
        {"fileName": "README.md"}
      ]
    }
  }
}

// Expected response: Array with file objects containing fileName, content, fileSize, lastModifiedDateTime

// Test case 2: Mix of valid and invalid files
{
  "method": "tools/call", 
  "params": {
    "name": "getFiles",
    "arguments": {
      "filePathList": [
        {"fileName": "package.json"},
        {"fileName": "nonexistent.txt"}
      ]
    }
  }
}

// Expected: Partial success - valid files returned, errors handled gracefully
```

### Level 4: Unit Tests (if test framework available)
```bash
npm test
# Expected: All existing tests continue to pass

# If failing: Fix issues without breaking existing functionality
```

## Final Validation Checklist
- [ ] TypeScript compiles without errors: `npm run build`
- [ ] Server starts successfully: `npm run dev`
- [ ] Tool appears in tools list when MCP client connects
- [ ] getFiles tool accepts correct input schema
- [ ] Returns response matching examples/getFiles_response_schema.json
- [ ] Handles non-existent files gracefully (doesn't crash)
- [ ] Uses existing security validation patterns
- [ ] Response format matches other tools (JSON with content array)
- [ ] All existing tests still pass: `npm test`

---

## Anti-Patterns to Avoid
- ❌ Don't create new file reading methods - use existing readFileWithEncoding()
- ❌ Don't skip path validation - always use validateAccess()
- ❌ Don't fail entire request on single file error - handle gracefully
- ❌ Don't create custom response format - use createJsonResponse()
- ❌ Don't hardcode file encoding - use existing encoding detection
- ❌ Don't ignore existing error handling patterns - use FileOperationError
- ❌ Don't modify existing tool behavior - only add new functionality

## Confidence Score: 9/10

High confidence due to:
- Clear existing patterns to follow in codebase
- Well-defined request/response schemas in examples
- Existing file reading infrastructure to leverage
- Established error handling and security patterns
- Comprehensive validation steps defined

Minor uncertainty on specific MCP client testing approach, but manual verification methods are provided.