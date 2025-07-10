# MCP Logging Implementation Plan

## Executive Summary

This plan outlines the step-by-step implementation of MCP SDK logging to replace the current 43+ console.error statements across 5 files. The implementation will provide real-time, structured logging visible to MCP clients with configurable log levels.

## Implementation Phases

### Phase 1: Foundation Setup (Week 1)

#### 1.1 Create LoggingService Infrastructure
**Priority: Critical**
**Estimated Time: 2-3 days**

**Tasks:**
1. Create `src/services/LoggingService.ts` with complete interface
2. Implement level filtering and context enrichment
3. Add graceful fallback to console logging
4. Create comprehensive TypeScript types

**Files to Create:**
- `src/services/LoggingService.ts` (new)
- `src/types/logging.ts` (new, extract from types.ts)

**Key Features:**
- 8 log levels (debug → emergency) with priority filtering
- Structured context enrichment with operation timing
- JSON serialization with depth/length limits
- Performance timer utilities
- Error formatting with stack traces

#### 1.2 Server Integration
**Priority: Critical**
**Estimated Time: 1-2 days**

**Tasks:**
1. Integrate LoggingService into FileContextServer constructor
2. Add `logging/setLevel` request handler
3. Initialize logging service before other services
4. Add logging configuration to server startup

**Files to Modify:**
- `src/index.ts` (constructor, request handlers)

### Phase 2: Service Migration (Week 2)

#### 2.1 High Priority Files
**Priority: High**
**Estimated Time: 2-3 days**

**Target: `src/index.ts` (17 console statements)**
```typescript
// Current
console.error(`Error reading file ${path}:`, error);

// Target  
await this.logger.error("Failed to read file", error, {
  filePath: path,
  operation: "read_context",
  toolName: request.params.name,
  fileSize: stats?.size,
  encoding: detectedEncoding
});
```

**Migration Strategy:**
1. Inject LoggingService into FileContextServer constructor
2. Replace console.error with structured logging calls
3. Add operational context (file paths, tool names, sizes)
4. Include performance timing for file operations
5. Maintain error object for stack traces

#### 2.2 Medium Priority Files
**Priority: Medium**
**Estimated Time: 2-3 days**

**Target Files:**
- `src/services/ProfileService.ts` (13 console statements)
- `src/services/FileWatcherService.ts` (9 console statements)

**ProfileService Migration:**
```typescript
// Current
console.error('[ProfileService] Failed to initialize:', error);

// Target
await this.logger.error("Profile service initialization failed", error, {
  operation: "profile_init",
  projectRoot: this.projectRoot,
  configPath: this.configPath,
  availableProfiles: Object.keys(this.config?.profiles || {})
});
```

**FileWatcherService Migration:**
```typescript
// Current
console.error(`File ${filePath} has been changed`);

// Target
await this.logger.debug("File change detected", {
  operation: "file_watch",
  filePath,
  event: "change",
  watcherPath: this.targetPath
});
```

### Phase 3: Remaining Services (Week 3)

#### 3.1 Low Priority Files
**Priority: Low**
**Estimated Time: 1-2 days**

**Target Files:**
- `src/services/CodeAnalysisService.ts` (2 console statements)
- `src/services/TemplateService.ts` (2 console statements)

#### 3.2 Service Constructor Injection
**Priority: Medium**
**Estimated Time: 1-2 days**

**Tasks:**
1. Update all service constructors to accept LoggingService
2. Update FileContextServer to pass logger to all services
3. Ensure dependency injection pattern consistency

### Phase 4: Testing & Validation (Week 4)

#### 4.1 Unit Testing
**Estimated Time: 2-3 days**

**Test Files to Create:**
- `src/services/__tests__/LoggingService.test.ts`
- Integration tests for each migrated service

**Test Coverage:**
- Level filtering behavior
- Context enrichment accuracy
- Error serialization
- Performance timing
- Fallback logging behavior
- Client setLevel request handling

#### 4.2 Integration Testing
**Estimated Time: 1-2 days**

**Validation:**
- MCP client can receive structured logs
- Log level filtering works correctly
- Performance impact is minimal
- No regression in existing functionality

## File-by-File Migration Details

### 1. `src/index.ts` (17 statements)
**Lines to Migrate:** File operations, tool execution, cache operations
**Context Needed:** filePath, toolName, operation, fileSize, encoding, duration
**Log Levels:** error (file operations), warning (cache issues), info (operations)

### 2. `src/services/ProfileService.ts` (13 statements)
**Lines to Migrate:** Initialization, configuration, profile switching
**Context Needed:** projectRoot, profileName, configPath, availableProfiles
**Log Levels:** debug (state changes), error (failures), info (operations)

### 3. `src/services/FileWatcherService.ts` (9 statements)
**Lines to Migrate:** File system events, watcher lifecycle
**Context Needed:** filePath, watcherPath, event, dirPath
**Log Levels:** debug (events), info (lifecycle), error (failures)

### 4. `src/services/CodeAnalysisService.ts` (2 statements)
**Lines to Migrate:** Analysis failures
**Context Needed:** analysisType, filePath, analysisOptions
**Log Levels:** warning (analysis failures)

### 5. `src/services/TemplateService.ts` (2 statements)
**Lines to Migrate:** Template operations
**Context Needed:** templateName, templatePath, renderContext
**Log Levels:** error (template failures)

## Implementation Code Examples

### LoggingService Creation
```typescript
// src/services/LoggingService.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { LoggingLevel } from '@modelcontextprotocol/sdk/types.js';

export interface LoggingConfig {
  defaultLevel: LoggingLevel;
  enableConsoleLogging: boolean;
  loggerName: string;
  performance: {
    enabled: boolean;
    slowOperationThreshold: number;
  };
}

export class LoggingService {
  private server: Server;
  private config: LoggingConfig;
  private currentLevel: LoggingLevel;
  
  constructor(server: Server, config: Partial<LoggingConfig> = {}) {
    this.server = server;
    this.config = {
      defaultLevel: 'info',
      enableConsoleLogging: true,
      loggerName: 'file-context-server',
      performance: {
        enabled: true,
        slowOperationThreshold: 1000
      },
      ...config
    };
    this.currentLevel = this.config.defaultLevel;
  }

  async error(message: string, error?: Error, context?: LogContext): Promise<void> {
    await this.log('error', message, context, error);
  }

  private async log(level: LoggingLevel, message: string, context?: LogContext, error?: Error): Promise<void> {
    if (!this.shouldLog(level)) return;

    const logData = {
      message,
      timestamp: Date.now(),
      level,
      logger: this.config.loggerName,
      ...context,
      ...(error && { error: this.formatError(error) })
    };

    try {
      await this.server.sendLoggingMessage({
        level,
        logger: this.config.loggerName,
        data: logData
      });
    } catch (err) {
      this.fallbackLog(level, message, logData);
    }
  }
}
```

### Server Integration
```typescript
// src/index.ts modifications
import { LoggingService } from './services/LoggingService.js';

export class FileContextServer {
  private server: Server;
  private logger: LoggingService;
  // ... other services

  constructor() {
    this.server = new Server(/* ... */);
    this.logger = new LoggingService(this.server);
    
    // Initialize other services with logger
    this.profileService = new ProfileService(projectRoot, this.logger);
    this.fileWatcher = new FileWatcherService(this.logger);
    // ...

    // Add logging level handler
    this.server.setRequestHandler(ListRequestsRequestSchema, async () => ({
      requests: [
        // ... existing requests
        {
          name: "logging/setLevel",
          description: "Set the logging level"
        }
      ]
    }));

    this.server.setRequestHandler(CallRequestSchema, async (request) => {
      if (request.params.name === "logging/setLevel") {
        const { level } = request.params.arguments as { level: LoggingLevel };
        this.logger.setLevel(level);
        return { success: true };
      }
      // ... existing handlers
    });
  }
}
```

### Service Migration Example
```typescript
// Before (src/services/ProfileService.ts)
console.error('[ProfileService] Failed to initialize:', error);

// After
await this.logger.error("Profile service initialization failed", error, {
  operation: "profile_init",
  projectRoot: this.projectRoot,
  configPath: this.configPath,
  timestamp: Date.now()
});
```

## Testing Strategy

### Unit Tests
```typescript
// src/services/__tests__/LoggingService.test.ts
describe('LoggingService', () => {
  test('should filter logs by level', async () => {
    const mockServer = { sendLoggingMessage: jest.fn() };
    const logger = new LoggingService(mockServer as any);
    
    logger.setLevel('error');
    await logger.debug('debug message');
    await logger.error('error message');
    
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledTimes(1);
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith({
      level: 'error',
      logger: 'file-context-server',
      data: expect.objectContaining({ message: 'error message' })
    });
  });
});
```

### Integration Tests
```typescript
// Test MCP client can receive logs
test('client receives structured logs', async () => {
  const transport = new TestTransport();
  const client = new Client({ name: "test-client", version: "1.0.0" }, {
    capabilities: { logging: {} }
  });
  
  await client.connect(transport);
  
  // Trigger server operation that logs
  await client.request({ method: "tools/call", params: { name: "read_context", arguments: { path: "test.txt" } } });
  
  // Verify logging message received
  expect(transport.receivedMessages).toContainEqual(
    expect.objectContaining({
      method: "notifications/message",
      params: expect.objectContaining({
        level: "info",
        logger: "file-context-server"
      })
    })
  );
});
```

## Success Criteria

### Functional Requirements
- [ ] All 43+ console statements migrated to MCP logging
- [ ] Client can control log levels via `logging/setLevel`
- [ ] Structured context included in all log messages
- [ ] Error objects properly serialized with stack traces
- [ ] Performance timing for slow operations (>1s)
- [ ] Graceful fallback to console when MCP unavailable

### Performance Requirements
- [ ] Logging overhead < 5ms per message
- [ ] No impact on file operation performance
- [ ] Memory usage stable with large log volumes

### Compatibility Requirements
- [ ] No breaking changes to existing API
- [ ] Works with all existing MCP clients
- [ ] Backwards compatible console logging for development

## Risk Mitigation

### High Risk: Breaking Changes
**Mitigation:** Implement feature flags and graceful degradation

### Medium Risk: Performance Impact
**Mitigation:** Async logging, level filtering, message batching

### Low Risk: Client Compatibility
**Mitigation:** Optional logging capability, fallback behavior

## Timeline Summary

| Week | Phase | Focus | Deliverables |
|------|-------|-------|--------------|
| 1 | Foundation | LoggingService + Server Integration | Core service, types, integration |
| 2 | Migration | High/Medium priority files | 39/43 statements migrated |
| 3 | Completion | Remaining files + polish | All migrations complete |
| 4 | Validation | Testing + documentation | Production ready |

## Next Steps

1. **Start with Phase 1.1**: Create the LoggingService infrastructure
2. **Test early**: Implement basic functionality and test with simple MCP client
3. **Migrate incrementally**: One file at a time, testing each migration
4. **Monitor performance**: Ensure no degradation in file operations
5. **Document patterns**: Create migration examples for future reference

This plan provides a structured approach to implementing professional, client-visible logging while maintaining full backwards compatibility and ensuring a smooth transition from console-based logging.