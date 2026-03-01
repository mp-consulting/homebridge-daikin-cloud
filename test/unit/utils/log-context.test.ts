import { vi, type Mock } from 'vitest';
/**
 * StructuredLogger Tests
 */

import {
  StructuredLogger,
  LogLevel,
  LogCategory,
  createLogger,
  createCategoryLogger,
  createDeviceLogger,
} from '../../../src/utils/log-context';
import type { Logger } from 'homebridge';

describe('StructuredLogger', () => {
  let mockLogger: Logger;
  let logger: StructuredLogger;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
    } as unknown as Logger;

    logger = new StructuredLogger(mockLogger);
  });

  describe('basic logging', () => {
    it('should log debug messages', () => {
      logger.debug('Debug message');
      expect(mockLogger.debug).toHaveBeenCalledWith('Debug message');
    });

    it('should log info messages', () => {
      logger.info('Info message');
      expect(mockLogger.info).toHaveBeenCalledWith('Info message');
    });

    it('should log warn messages', () => {
      logger.warn('Warning message');
      expect(mockLogger.warn).toHaveBeenCalledWith('Warning message');
    });

    it('should log error messages', () => {
      logger.error('Error message');
      expect(mockLogger.error).toHaveBeenCalledWith('Error message');
    });
  });

  describe('context formatting', () => {
    it('should include category in log message', () => {
      logger.log(LogLevel.INFO, 'Test', { category: LogCategory.API });
      expect(mockLogger.info).toHaveBeenCalledWith('[API] Test');
    });

    it('should include device name in log message', () => {
      logger.log(LogLevel.INFO, 'Test', { deviceName: 'Living Room' });
      expect(mockLogger.info).toHaveBeenCalledWith('[Living Room] Test');
    });

    it('should include device ID when no name', () => {
      logger.log(LogLevel.INFO, 'Test', { deviceId: 'device123' });
      expect(mockLogger.info).toHaveBeenCalledWith('[Device:device123] Test');
    });

    it('should include operation in log message', () => {
      logger.log(LogLevel.INFO, 'Test', { operation: 'update' });
      expect(mockLogger.info).toHaveBeenCalledWith('(update) Test');
    });

    it('should include embedded ID', () => {
      logger.log(LogLevel.INFO, 'Test', { embeddedId: 'climateControl' });
      expect(mockLogger.info).toHaveBeenCalledWith('[climateControl] Test');
    });

    it('should include feature name', () => {
      logger.log(LogLevel.INFO, 'Test', { feature: 'PowerfulMode' });
      expect(mockLogger.info).toHaveBeenCalledWith('[Feature:PowerfulMode] Test');
    });

    it('should combine multiple context fields', () => {
      logger.log(LogLevel.INFO, 'Test', {
        category: LogCategory.DEVICE,
        deviceName: 'Kitchen',
        operation: 'setState',
      });
      expect(mockLogger.info).toHaveBeenCalledWith('[Device] [Kitchen] (setState) Test');
    });

    it('should append metadata as JSON', () => {
      logger.log(LogLevel.INFO, 'Test', {
        metadata: { temp: 25, mode: 'cool' },
      });

      const logCall = (mockLogger.info as Mock).mock.calls[0][0];
      expect(logCall).toContain('{"temp":25,"mode":"cool"}');
    });
  });

  describe('default context', () => {
    it('should merge default context with call context', () => {
      const loggerWithDefaults = new StructuredLogger(mockLogger, {
        category: LogCategory.PLATFORM,
      });

      loggerWithDefaults.log(LogLevel.INFO, 'Test', { deviceId: 'device123' });

      const logCall = (mockLogger.info as Mock).mock.calls[0][0];
      expect(logCall).toContain('[Platform]');
      expect(logCall).toContain('[Device:device123]');
    });

    it('should override default context with call context', () => {
      const loggerWithDefaults = new StructuredLogger(mockLogger, {
        category: LogCategory.PLATFORM,
      });

      loggerWithDefaults.log(LogLevel.INFO, 'Test', {
        category: LogCategory.API,
      });

      const logCall = (mockLogger.info as Mock).mock.calls[0][0];
      expect(logCall).toContain('[API]');
      expect(logCall).not.toContain('[Platform]');
    });

    it('should merge metadata objects', () => {
      const loggerWithDefaults = new StructuredLogger(mockLogger, {
        metadata: { defaultKey: 'defaultValue' },
      });

      loggerWithDefaults.log(LogLevel.INFO, 'Test', {
        metadata: { callKey: 'callValue' },
      });

      const logCall = (mockLogger.info as Mock).mock.calls[0][0];
      expect(logCall).toContain('defaultKey');
      expect(logCall).toContain('callKey');
    });
  });

  describe('child logger', () => {
    it('should create child logger with additional context', () => {
      const child = logger.child({ category: LogCategory.DEVICE });
      child.info('Test message');

      const logCall = (mockLogger.info as Mock).mock.calls[0][0];
      expect(logCall).toContain('[Device]');
    });

    it('should inherit parent context', () => {
      const parent = new StructuredLogger(mockLogger, {
        category: LogCategory.PLATFORM,
      });

      const child = parent.child({ deviceName: 'Kitchen' });
      child.info('Test');

      const logCall = (mockLogger.info as Mock).mock.calls[0][0];
      expect(logCall).toContain('[Platform]');
      expect(logCall).toContain('[Kitchen]');
    });
  });

  describe('log history', () => {
    it('should record log entries in history', () => {
      logger.info('Message 1');
      logger.warn('Message 2');
      logger.error('Message 3');

      const history = logger.getHistory();
      expect(history).toHaveLength(3);
    });

    it('should return limited history', () => {
      for (let i = 0; i < 10; i++) {
        logger.info(`Message ${i}`);
      }

      const history = logger.getHistory(5);
      expect(history).toHaveLength(5);
    });

    it('should include context in history entries', () => {
      logger.info('Test', { category: LogCategory.API, deviceId: 'device123' });

      const history = logger.getHistory();
      expect(history[0].message).toBe('Test');
      expect(history[0].context?.category).toBe(LogCategory.API);
      expect(history[0].context?.deviceId).toBe('device123');
    });

    it('should include timestamp in history entries', () => {
      const before = new Date();
      logger.info('Test');
      const after = new Date();

      const history = logger.getHistory();
      expect(history[0].timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(history[0].timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should clear history', () => {
      logger.info('Message 1');
      logger.info('Message 2');
      expect(logger.getHistory()).toHaveLength(2);

      logger.clearHistory();
      expect(logger.getHistory()).toHaveLength(0);
    });
  });

  describe('helper functions', () => {
    it('createLogger should create StructuredLogger', () => {
      const newLogger = createLogger(mockLogger);
      expect(newLogger).toBeInstanceOf(StructuredLogger);
    });

    it('createLogger should accept default context', () => {
      const newLogger = createLogger(mockLogger, { category: LogCategory.API });
      newLogger.info('Test');

      const logCall = (mockLogger.info as Mock).mock.calls[0][0];
      expect(logCall).toContain('[API]');
    });

    it('createCategoryLogger should create logger with category', () => {
      const newLogger = createCategoryLogger(mockLogger, LogCategory.WEBSOCKET);
      newLogger.info('Test');

      const logCall = (mockLogger.info as Mock).mock.calls[0][0];
      expect(logCall).toContain('[WebSocket]');
    });

    it('createDeviceLogger should create logger with device context', () => {
      const newLogger = createDeviceLogger(mockLogger, 'device123', 'Kitchen AC');
      newLogger.info('Test');

      const logCall = (mockLogger.info as Mock).mock.calls[0][0];
      expect(logCall).toContain('[Device]');
      expect(logCall).toContain('[Kitchen AC]');
    });
  });

  describe('edge cases', () => {
    it('should handle empty message', () => {
      logger.info('');
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should handle undefined context', () => {
      logger.info('Test', undefined);
      expect(mockLogger.info).toHaveBeenCalledWith('Test');
    });

    it('should handle empty metadata', () => {
      logger.info('Test', { metadata: {} });

      const logCall = (mockLogger.info as Mock).mock.calls[0][0];
      expect(logCall).toBe('Test');
    });

    it('should handle special characters in messages', () => {
      logger.info('Test [brackets] (parens) {braces}');
      expect(mockLogger.info).toHaveBeenCalled();
    });
  });
});
