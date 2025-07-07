# LoggingService Technical Specification

## Interface Definition

### Core Types
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { LoggingLevel } from '@modelcontextprotocol/sdk/types.js';

export interface LoggingConfig {
  defaultLevel: LoggingLevel;
  enableConsoleLogging: boolean;
  loggerName: string;
  performance: {
    enabled: boolean;
    slowOperationThreshold: number; // milliseconds
  };
  serialization: {
    maxDepth: number;
    maxLength: number;
    includeStackTrace: boolean;
  };
}

export interface LogContext {
  [key: string]: unknown;
  timestamp?: number;
  operation?: string;
  filePath?: string;
  toolName?: string;
  requestId?: string;
  duration?: number;
}

export interface PerformanceTimer {
  start(): void;
  end(operation: string, context?: LogContext): Promise<void>;
}
```

### LoggingService Class
```typescript
export class LoggingService {
  private server: Server;
  private config: LoggingConfig;
  private currentLevel: LoggingLevel;
  private readonly levelPriority: Record<LoggingLevel, number>;

  constructor(server: Server, config: Partial<LoggingConfig> = {});

  // Core logging methods
  async debug(message: string, context?: LogContext): Promise<void>;
  async info(message: string, context?: LogContext): Promise<void>;
  async notice(message: string, context?: LogContext): Promise<void>;
  async warning(message: string, context?: LogContext): Promise<void>;
  async error(message: string, error?: Error, context?: LogContext): Promise<void>;
  async critical(message: string, error?: Error, context?: LogContext): Promise<void>;

  // Configuration methods
  setLevel(level: LoggingLevel): void;
  getLevel(): LoggingLevel;
  shouldLog(level: LoggingLevel): boolean;

  // Utility methods
  createTimer(): PerformanceTimer;
  private sanitizeContext(context: LogContext): LogContext;
  private formatError(error: Error): object;
  private fallbackLog(level: LoggingLevel, message: string, data?: unknown): void;
}
```

## Implementation Details

### Level Priority System
```typescript
private readonly levelPriority: Record<LoggingLevel, number> = {
  debug: 0,
  info: 1,
  notice: 2,
  warning: 3,
  error: 4,
  critical: 5,
  alert: 6,
  emergency: 7
};
```

### Core Logging Implementation
```typescript
private async log(level: LoggingLevel, message: string, context?: LogContext, error?: Error): Promise<void> {
  if (!this.shouldLog(level)) {
    return;
  }

  try {
    const logData = {
      message,
      timestamp: Date.now(),
      level,
      logger: this.config.loggerName,
      ...this.sanitizeContext(context || {}),
      ...(error && { error: this.formatError(error) })
    };

    await this.server.sendLoggingMessage({
      level,
      logger: this.config.loggerName,
      data: logData
    });
  } catch (loggingError) {
    // Fallback to console if MCP logging fails
    this.fallbackLog(level, message, { context, error, loggingError });
  }
}
```

### Performance Timer Implementation
```typescript
class PerformanceTimerImpl implements PerformanceTimer {
  private startTime: number;

  constructor(private loggingService: LoggingService) {}

  start(): void {
    this.startTime = performance.now();
  }

  async end(operation: string, context: LogContext = {}): Promise<void> {
    const duration = performance.now() - this.startTime;
    const logContext = {
      ...context,
      operation,
      duration: Math.round(duration * 100) / 100 // Round to 2 decimal places
    };

    if (duration > this.loggingService.config.performance.slowOperationThreshold) {
      await this.loggingService.warning(`Slow operation detected: ${operation}`, logContext);
    } else if (this.loggingService.config.performance.enabled) {
      await this.loggingService.debug(`Operation completed: ${operation}`, logContext);
    }
  }
}
```

### Context Sanitization
```typescript
private sanitizeContext(context: LogContext): LogContext {
  try {
    // Remove circular references and limit depth
    const sanitized = JSON.parse(JSON.stringify(context, this.getCircularReplacer(), 2));
    
    // Truncate large strings
    return this.truncateValues(sanitized);
  } catch (error) {
    return { 
      contextError: 'Failed to serialize context',
      originalKeys: Object.keys(context)
    };
  }
}

private getCircularReplacer() {
  const seen = new WeakSet();
  return (key: string, value: unknown) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular Reference]';
      }
      seen.add(value);
    }
    return value;
  };
}

private truncateValues(obj: unknown, maxLength = 1000): unknown {
  if (typeof obj === 'string') {
    return obj.length > maxLength ? obj.substring(0, maxLength) + '...' : obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => this.truncateValues(item, maxLength));
  }
  if (typeof obj === 'object' && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = this.truncateValues(value, maxLength);
    }
    return result;
  }
  return obj;
}
```

### Error Formatting
```typescript
private formatError(error: Error): object {
  return {
    name: error.name,
    message: error.message,
    stack: this.config.serialization.includeStackTrace ? error.stack : undefined,
    ...(error.cause && { cause: this.formatError(error.cause as Error) })
  };
}
```

## Integration Pattern

### Server Integration
```typescript
// In FileContextServer constructor
export class FileContextServer {
  private loggingService: LoggingService;

  constructor(config: Partial<StreamConfig> = {}) {
    // ... existing initialization

    // Initialize logging service
    this.loggingService = new LoggingService(this.server, {
      defaultLevel: process.env.MCP_LOG_LEVEL as LoggingLevel || 'info',
      enableConsoleLogging: process.env.NODE_ENV === 'development',
      loggerName: 'file-context-server',
      performance: {
        enabled: process.env.MCP_LOG_PERFORMANCE === 'true',
        slowOperationThreshold: 1000
      },
      serialization: {
        maxDepth: 5,
        maxLength: 2000,
        includeStackTrace: true
      }
    });

    // Handle client logging level requests
    this.server.setRequestHandler(SetLevelRequestSchema, async (request) => {
      this.loggingService.setLevel(request.params.level);
      await this.loggingService.info('Log level changed', { 
        newLevel: request.params.level,
        requestedBy: 'client'
      });
      return {};
    });

    // Pass logging service to other services
    this.fileWatcherService = new FileWatcherService(this.loggingService);
    this.profileService = new ProfileService(process.cwd(), this.loggingService);
    // ... etc
  }
}
```

### Service Integration Pattern
```typescript
// Example: FileWatcherService integration
export class FileWatcherService extends EventEmitter {
  constructor(private logger?: LoggingService) {
    super();
    // ... existing initialization
  }

  async watch(targetPath: string): Promise<void> {
    const timer = this.logger?.createTimer();
    timer?.start();

    try {
      // ... existing watch logic
      await this.logger?.info('File watcher started', {
        targetPath,
        operation: 'watch_start'
      });
      
      timer?.end('watch_initialization', { targetPath });
    } catch (error) {
      await this.logger?.error('Failed to start file watcher', error, {
        targetPath,
        operation: 'watch_start'
      });
      throw error;
    }
  }
}
```

## Migration Examples

### Before/After Comparisons

#### Simple Error Logging
```typescript
// Before
console.error(`Error reading file ${filePath}:`, error);

// After  
await this.loggingService.error('Failed to read file', error, {
  filePath,
  operation: 'read_file',
  encoding: 'utf8'
});
```

#### Debug Information
```typescript
// Before
console.error('[FileContextServer] Services initialized');

// After
await this.loggingService.info('Server services initialized', {
  operation: 'server_startup',
  services: ['fileWatcher', 'profile', 'template', 'codeAnalysis']
});
```

#### Performance Sensitive Operations
```typescript
// Before
const files = await this.listFiles(dirPath);
console.error(`Found files: ${files.length}`);

// After
const timer = this.loggingService.createTimer();
timer.start();

const files = await this.listFiles(dirPath);

await timer.end('list_files', {
  directory: dirPath,
  fileCount: files.length,
  recursive: options.recursive
});
```

## Default Configuration

```typescript
export const DEFAULT_LOGGING_CONFIG: LoggingConfig = {
  defaultLevel: 'info',
  enableConsoleLogging: false,
  loggerName: 'file-context-server',
  performance: {
    enabled: false,
    slowOperationThreshold: 1000
  },
  serialization: {
    maxDepth: 5,
    maxLength: 2000,
    includeStackTrace: true
  }
};
```

## Error Handling Strategy

### Logging Service Failures
```typescript
private fallbackLog(level: LoggingLevel, message: string, data?: unknown): void {
  if (this.config.enableConsoleLogging) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    
    if (level === 'error' || level === 'critical') {
      console.error(logLine, data);
    } else {
      console.log(logLine, data);
    }
  }
}
```

### Graceful Degradation
1. **MCP Connection Issues**: Fall back to console logging
2. **Serialization Errors**: Log error with minimal context
3. **Performance Timer Failures**: Continue operation without timing
4. **Configuration Errors**: Use default configuration with warning

## Testing Strategy

### Unit Tests
```typescript
describe('LoggingService', () => {
  let mockServer: jest.Mocked<Server>;
  let loggingService: LoggingService;

  beforeEach(() => {
    mockServer = {
      sendLoggingMessage: jest.fn().mockResolvedValue(undefined)
    } as any;
    
    loggingService = new LoggingService(mockServer, {
      defaultLevel: 'debug',
      enableConsoleLogging: false,
      loggerName: 'test-logger'
    });
  });

  test('should filter messages based on log level', async () => {
    loggingService.setLevel('warning');
    
    await loggingService.debug('debug message');
    await loggingService.warning('warning message');
    
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledTimes(1);
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith({
      level: 'warning',
      logger: 'test-logger',
      data: expect.objectContaining({
        message: 'warning message'
      })
    });
  });

  test('should handle circular references in context', async () => {
    const circular: any = { name: 'test' };
    circular.self = circular;

    await loggingService.info('test message', { circular });

    expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith({
      level: 'info',
      logger: 'test-logger',
      data: expect.objectContaining({
        circular: expect.objectContaining({
          self: '[Circular Reference]'
        })
      })
    });
  });
});
```

This implementation provides a robust, feature-complete logging service that integrates seamlessly with the MCP protocol while maintaining performance and reliability.