import { parseCacheConfig, parseToolDefaultMaxFileSize } from '../../src/index';
import { parseCacheConfig, parseToolDefaultMaxFileSize } from '../../src/index';
// Do not import the actual logger here, as we will pass a mock one.
// import logger from '../../src/utils/logger';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Create a manual mock for the logger
const mockLogger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  fatal: jest.fn(),
};

describe('Configuration Parsing', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Store original process.env
    originalEnv = { ...process.env };
    // Clear mock calls for the manually mocked logger
    mockLogger.warn.mockClear();
    mockLogger.info.mockClear();
    mockLogger.error.mockClear();
    mockLogger.debug.mockClear();
    mockLogger.fatal.mockClear();
  });

  afterEach(() => {
    // Restore original process.env
    process.env = originalEnv;
  });

  describe('parseCacheConfig', () => {
    const defaultConfig = { max: 500, ttl: 300000 }; // 5 minutes

    it('should use default values when env vars are not set', () => {
      delete process.env.MAX_CACHE_SIZE;
      delete process.env.CACHE_TTL;
      expect(parseCacheConfig(process.env, mockLogger)).toEqual(defaultConfig);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should use valid MAX_CACHE_SIZE from env', () => {
      process.env.MAX_CACHE_SIZE = '1000';
      delete process.env.CACHE_TTL;
      expect(parseCacheConfig(process.env, mockLogger)).toEqual({ ...defaultConfig, max: 1000 });
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should use valid CACHE_TTL from env', () => {
      delete process.env.MAX_CACHE_SIZE;
      process.env.CACHE_TTL = '600000'; // 10 minutes
      expect(parseCacheConfig(process.env, mockLogger)).toEqual({ ...defaultConfig, ttl: 600000 });
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should use both valid env vars', () => {
      process.env.MAX_CACHE_SIZE = '1500';
      process.env.CACHE_TTL = '900000'; // 15 minutes
      expect(parseCacheConfig(process.env, mockLogger)).toEqual({ max: 1500, ttl: 900000 });
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should use default MAX_CACHE_SIZE and log warning for invalid value', () => {
      process.env.MAX_CACHE_SIZE = 'invalid';
      delete process.env.CACHE_TTL;
      expect(parseCacheConfig(process.env, mockLogger)).toEqual(defaultConfig);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ envVar: 'MAX_CACHE_SIZE', value: 'invalid' }),
        expect.any(String)
      );
    });

    it('should use default MAX_CACHE_SIZE and log warning for zero value', () => {
      process.env.MAX_CACHE_SIZE = '0';
      delete process.env.CACHE_TTL;
      expect(parseCacheConfig(process.env, mockLogger)).toEqual(defaultConfig);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ envVar: 'MAX_CACHE_SIZE', value: '0' }),
        expect.any(String)
      );
    });

    it('should use default CACHE_TTL and log warning for invalid value', () => {
      process.env.CACHE_TTL = 'invalid';
      delete process.env.MAX_CACHE_SIZE;
      expect(parseCacheConfig(process.env, mockLogger)).toEqual(defaultConfig);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ envVar: 'CACHE_TTL', value: 'invalid' }),
        expect.any(String)
      );
    });

    it('should use default CACHE_TTL and log warning for zero value', () => {
      process.env.CACHE_TTL = '0';
      delete process.env.MAX_CACHE_SIZE;
      expect(parseCacheConfig(process.env, mockLogger)).toEqual(defaultConfig);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ envVar: 'CACHE_TTL', value: '0' }),
        expect.any(String)
      );
    });
  });

  describe('parseToolDefaultMaxFileSize', () => {
    const defaultSize = 1048576;

    it('should use default value when MAX_FILE_SIZE is not set', () => {
      delete process.env.MAX_FILE_SIZE;
      expect(parseToolDefaultMaxFileSize(process.env, mockLogger)).toBe(defaultSize);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should use valid MAX_FILE_SIZE from env', () => {
      process.env.MAX_FILE_SIZE = '2000000';
      expect(parseToolDefaultMaxFileSize(process.env, mockLogger)).toBe(2000000);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should use default MAX_FILE_SIZE and log warning for invalid value', () => {
      process.env.MAX_FILE_SIZE = 'invalid';
      expect(parseToolDefaultMaxFileSize(process.env, mockLogger)).toBe(defaultSize);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ envVar: 'MAX_FILE_SIZE', value: 'invalid' }),
        expect.any(String)
      );
    });

    it('should use default MAX_FILE_SIZE and log warning for zero value', () => {
      process.env.MAX_FILE_SIZE = '0';
      expect(parseToolDefaultMaxFileSize(process.env, mockLogger)).toBe(defaultSize);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ envVar: 'MAX_FILE_SIZE', value: '0' }),
        expect.any(String)
      );
    });
  });
});
