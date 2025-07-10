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

class PerformanceTimerImpl implements PerformanceTimer {
  private startTime: number = 0;

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

export class LoggingService {
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

  public readonly config: LoggingConfig;
  private currentLevel: LoggingLevel;

  constructor(private server: Server, config: Partial<LoggingConfig> = {}) {
    this.config = {
      ...DEFAULT_LOGGING_CONFIG,
      ...config
    };
    this.currentLevel = this.config.defaultLevel;
  }

  // Core logging methods
  async debug(message: string, context?: LogContext): Promise<void> {
    await this.log('debug', message, context);
  }

  async info(message: string, context?: LogContext): Promise<void> {
    await this.log('info', message, context);
  }

  async notice(message: string, context?: LogContext): Promise<void> {
    await this.log('notice', message, context);
  }

  async warning(message: string, context?: LogContext): Promise<void> {
    await this.log('warning', message, context);
  }

  async error(message: string, error?: Error, context?: LogContext): Promise<void> {
    await this.log('error', message, context, error);
  }

  async critical(message: string, error?: Error, context?: LogContext): Promise<void> {
    await this.log('critical', message, context, error);
  }

  async alert(message: string, error?: Error, context?: LogContext): Promise<void> {
    await this.log('alert', message, context, error);
  }

  async emergency(message: string, error?: Error, context?: LogContext): Promise<void> {
    await this.log('emergency', message, context, error);
  }

  // Configuration methods
  setLevel(level: LoggingLevel): void {
    this.currentLevel = level;
  }

  getLevel(): LoggingLevel {
    return this.currentLevel;
  }

  shouldLog(level: LoggingLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.currentLevel];
  }

  // Utility methods
  createTimer(): PerformanceTimer {
    return new PerformanceTimerImpl(this);
  }

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

  private sanitizeContext(context: LogContext): LogContext {
    try {
      // Remove circular references and limit depth
      const sanitized = JSON.parse(JSON.stringify(context, this.getCircularReplacer(), 2));
      
      // Truncate large strings
      return this.truncateValues(sanitized) as LogContext;
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

  private truncateValues(obj: unknown, maxLength = this.config.serialization.maxLength): unknown {
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

  private formatError(error: Error): object {
    const errorObj = error as any; // Type assertion to access potential cause property
    return {
      name: error.name,
      message: error.message,
      stack: this.config.serialization.includeStackTrace ? error.stack : undefined,
      ...(errorObj.cause && { cause: this.formatError(errorObj.cause as Error) })
    };
  }

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
}