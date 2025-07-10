# MCP Logging Implementation Project Brief

## Executive Summary

This document outlines the implementation plan for integrating the Model Context Protocol (MCP) SDK's logging API into the file-context-server. The goal is to replace console-based logging with structured MCP logging that provides better visibility, control, and debugging capabilities for clients.

## Current State Analysis

### Existing Logging Patterns
The codebase currently uses `console.error()` extensively across multiple files:

- **src/index.ts**: 17 console.error instances
- **src/services/FileWatcherService.ts**: 9 console.error instances  
- **src/services/ProfileService.ts**: 13 console.error instances
- **src/services/CodeAnalysisService.ts**: 2 console.error instances
- **src/services/TemplateService.ts**: 2 console.error instances

**Total**: 43+ logging statements that output to stderr

### Current Logging Categories
1. **Server Lifecycle**: Service initialization, startup, shutdown
2. **File Operations**: File access, validation, reading errors
3. **File Watching**: File system events, watcher lifecycle
4. **Profile Management**: Profile loading, switching, validation
5. **Cache Operations**: Cache hits, misses, invalidation
6. **Error Handling**: Tool execution errors, validation failures

### Limitations of Current Approach
- No structured logging format
- No log level control
- Stderr output not visible to MCP clients
- No centralized logging configuration
- No log filtering or categorization
- Limited debugging information for clients

## MCP Logging API Capabilities

### Core Components (@modelcontextprotocol/sdk@1.15.0)

#### 1. Logging Levels
```typescript
type LoggingLevel = "debug" | "info" | "notice" | "warning" | 
                   "error" | "critical" | "alert" | "emergency";
```

#### 2. Server Method
```typescript
async sendLoggingMessage(params: {
  level: LoggingLevel;
  logger?: string;           // Optional logger name
  data: unknown;            // Any JSON serializable content
}): Promise<void>
```

#### 3. Client Control
- Clients can request specific log levels via `logging/setLevel` requests
- Server receives logging level preferences and filters accordingly
- Real-time log streaming to clients

#### 4. Message Structure
```typescript
{
  method: "notifications/message",
  params: {
    level: LoggingLevel,
    logger?: string,
    data: any,           // Message, object, or structured data
    _meta?: object       // Optional metadata
  }
}
```

## Implementation Strategy

### Phase 1: Logging Service Architecture

#### 1.1 Create LoggingService
```typescript
interface LoggingServiceConfig {
  defaultLevel: LoggingLevel;
  enableConsoleLogging: boolean;    // Fallback for development
  loggerName: string;
  bufferSize?: number;              // For batching
  enableTimestamps: boolean;
}

class LoggingService {
  private server: Server;
  private config: LoggingServiceConfig;
  private currentLevel: LoggingLevel;
  private loggerName: string;
  
  async log(level: LoggingLevel, message: string, context?: object): Promise<void>;
  async debug(message: string, context?: object): Promise<void>;
  async info(message: string, context?: object): Promise<void>;
  async warning(message: string, context?: object): Promise<void>;
  async error(message: string, error?: Error, context?: object): Promise<void>;
  
  setLevel(level: LoggingLevel): void;
  shouldLog(level: LoggingLevel): boolean;
}
```

#### 1.2 Integration Points
- **FileContextServer**: Main server class integration
- **Services**: Inject logging service into all service classes
- **Error Handling**: Structured error logging with stack traces
- **Performance Monitoring**: Log timing and cache statistics

### Phase 2: Migration Strategy

#### 2.1 Gradual Replacement
1. Create LoggingService alongside existing console logging
2. Replace console.error with structured logging methods
3. Add contextual information to log messages
4. Remove console logging after validation

#### 2.2 Log Level Mapping
```typescript
// Current -> MCP Logging Level
console.error("Error: ...") -> logger.error(message, error)
console.error("Debug: ...") -> logger.debug(message)
console.error("Info: ...") -> logger.info(message)
console.error("Warning: ...") -> logger.warning(message)
```

#### 2.3 Enhanced Context
```typescript
// Before
console.error(`Error reading file ${path}:`, error);

// After  
await logger.error("Failed to read file", error, {
  filePath: path,
  operation: "read_context",
  fileSize: stats?.size,
  encoding: "utf8"
});
```

### Phase 3: Advanced Features

#### 3.1 Structured Logging Categories
```typescript
enum LogCategory {
  SERVER_LIFECYCLE = "server",
  FILE_OPERATIONS = "files", 
  CACHE_OPERATIONS = "cache",
  SECURITY = "security",
  PERFORMANCE = "performance",
  USER_ACTIONS = "user"
}
```

#### 3.2 Performance Logging
```typescript
interface PerformanceContext {
  operation: string;
  duration: number;
  cacheHit?: boolean;
  fileCount?: number;
  bytesProcessed?: number;
}

await logger.info("Operation completed", {
  category: LogCategory.PERFORMANCE,
  ...performanceContext
});
```

#### 3.3 Request Correlation
```typescript
interface RequestContext {
  requestId: string;
  toolName: string;
  userId?: string;
  startTime: number;
}
```

## Detailed Implementation Plan

### Step 1: LoggingService Foundation
1. Create `src/services/LoggingService.ts`
2. Define interfaces and configuration types
3. Implement core logging methods
4. Add level filtering logic
5. Create factory function for service instances

### Step 2: Server Integration
1. Modify `FileContextServer` constructor to accept LoggingService
2. Handle `logging/setLevel` requests from clients
3. Initialize default logging configuration
4. Add logging service to server capabilities

### Step 3: Service Migration
1. **FileWatcherService**: Replace 9 console.error calls
2. **ProfileService**: Replace 13 console.error calls
3. **CodeAnalysisService**: Replace 2 console.error calls
4. **TemplateService**: Replace 2 console.error calls

### Step 4: Main Server Migration
1. Replace 17 console.error calls in index.ts
2. Add structured context to file operations
3. Enhance error reporting with stack traces
4. Add performance logging for tool operations

### Step 5: Configuration & Environment
1. Add logging configuration to environment variables
2. Create development vs production logging profiles
3. Add configuration for log levels per category
4. Support for client-requested logging levels

## Configuration Design

### Environment Variables
```bash
MCP_LOG_LEVEL=info                    # Default log level
MCP_LOG_CONSOLE_FALLBACK=true        # Enable console logging
MCP_LOG_BUFFER_SIZE=100              # Message buffering
MCP_LOG_PERFORMANCE_ENABLED=true     # Performance logging
MCP_LOG_CATEGORIES=server,files,cache # Enabled categories
```

### Configuration File
```typescript
interface LoggingConfig {
  defaultLevel: LoggingLevel;
  enableConsoleLogging: boolean;
  categories: {
    [category: string]: {
      enabled: boolean;
      level: LoggingLevel;
    };
  };
  performance: {
    enabled: boolean;
    thresholds: {
      slow_operation_ms: number;
      large_file_bytes: number;
    };
  };
  formatting: {
    includeTimestamp: boolean;
    includeStackTrace: boolean;
    maxMessageLength: number;
  };
}
```

## Testing Strategy

### Unit Tests
1. LoggingService level filtering
2. Message formatting and serialization
3. Configuration loading and validation
4. Error handling and fallback behavior

### Integration Tests
1. Client logging level requests
2. Service integration with structured logging
3. Performance logging accuracy
4. Message delivery to clients

### Manual Testing
1. Client log visibility in MCP applications
2. Log level filtering behavior
3. Performance impact measurement
4. Error reproduction with enhanced context

## Performance Considerations

### Logging Overhead
- **Asynchronous logging**: Non-blocking message sending
- **Level filtering**: Early return for disabled levels
- **Message buffering**: Batch small messages
- **Lazy evaluation**: Context objects computed only when needed

### Memory Management
- **Buffer limits**: Prevent memory leaks from log buffering
- **Message size limits**: Truncate large objects
- **Circular reference detection**: Safe serialization

### Network Efficiency
- **Compression**: Consider message compression for large logs
- **Batching**: Group related log messages
- **Throttling**: Rate limiting for high-frequency events

## Migration Timeline

### Week 1: Foundation
- [ ] Create LoggingService implementation
- [ ] Add configuration interfaces
- [ ] Create unit tests for core functionality

### Week 2: Server Integration  
- [ ] Integrate LoggingService into FileContextServer
- [ ] Handle client logging/setLevel requests
- [ ] Add logging capability advertisement

### Week 3: Service Migration
- [ ] Migrate FileWatcherService logging
- [ ] Migrate ProfileService logging
- [ ] Migrate CodeAnalysisService logging
- [ ] Migrate TemplateService logging

### Week 4: Main Server & Polish
- [ ] Migrate main server logging
- [ ] Add structured context to all log messages
- [ ] Performance logging implementation
- [ ] Documentation and examples

## Risk Assessment

### High Risk
- **Breaking Changes**: Ensure logging doesn't affect core functionality
- **Performance Impact**: Monitor CPU and memory usage
- **Client Compatibility**: Verify logging works across MCP clients

### Medium Risk
- **Message Format**: Ensure JSON serialization handles all data types
- **Error Handling**: Fallback when logging service fails
- **Configuration**: Validate all configuration options

### Low Risk
- **Log Level Changes**: Runtime log level adjustment
- **Message Content**: Formatting and truncation logic

## Success Criteria

### Functional Requirements
1. ✅ All console.error calls replaced with structured logging
2. ✅ Client-controlled log level filtering working
3. ✅ Structured context included in all log messages
4. ✅ Performance logging for operations >100ms
5. ✅ Error logs include stack traces and context

### Non-Functional Requirements
1. ✅ <5% performance overhead from logging
2. ✅ Memory usage remains stable under load
3. ✅ Log messages appear in real-time in clients
4. ✅ Configuration supports all deployment environments
5. ✅ 100% backwards compatibility maintained

## Future Enhancements

### Advanced Features
- **Log Analytics**: Structured data for log analysis
- **Metrics Collection**: Operational metrics via logging
- **Distributed Tracing**: Request correlation across services
- **Log Rotation**: File-based logging for debugging

### Monitoring Integration
- **Health Checks**: Server health via log patterns
- **Alerting**: Critical error detection and notification
- **Dashboard Integration**: Log data visualization

## Conclusion

This implementation will significantly improve the debugging and monitoring capabilities of the file-context-server while maintaining all existing functionality. The structured approach ensures minimal risk while providing maximum benefit to both developers and end users.

The phased implementation allows for incremental testing and validation, ensuring the logging system is robust and performant before full deployment.