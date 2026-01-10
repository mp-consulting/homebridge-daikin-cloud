/**
 * ErrorHandler Tests
 */

import {ErrorHandler, ErrorCategory, ErrorSeverity} from '../../../src/utils/error-handler';
import {Logger} from 'homebridge';

describe('ErrorHandler', () => {
    let mockLogger: Logger;
    let handler: ErrorHandler;

    beforeEach(() => {
        mockLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            log: jest.fn(),
        } as unknown as Logger;

        handler = new ErrorHandler(mockLogger, 'TestContext');
    });

    describe('categorize', () => {
        it('should categorize authentication errors', () => {
            const error = new Error('Unauthorized token expired');
            expect(handler.categorize(error)).toBe(ErrorCategory.AUTHENTICATION);
        });

        it('should categorize rate limit errors', () => {
            const error = new Error('Rate limit exceeded');
            expect(handler.categorize(error)).toBe(ErrorCategory.RATE_LIMIT);
        });

        it('should categorize network errors', () => {
            const error = new Error('ECONNRESET connection failed');
            expect(handler.categorize(error)).toBe(ErrorCategory.NETWORK);
        });

        it('should categorize websocket errors', () => {
            const error = new Error('ws: connection closed');
            expect(handler.categorize(error)).toBe(ErrorCategory.WEBSOCKET);
        });

        it('should categorize validation errors', () => {
            const error = new Error('Invalid configuration value');
            expect(handler.categorize(error)).toBe(ErrorCategory.VALIDATION);
        });

        it('should categorize device errors', () => {
            const error = new Error('Device not responding');
            expect(handler.categorize(error)).toBe(ErrorCategory.DEVICE);
        });

        it('should categorize unknown errors', () => {
            const error = new Error('Something went wrong');
            expect(handler.categorize(error)).toBe(ErrorCategory.UNKNOWN);
        });
    });

    describe('determineSeverity', () => {
        it('should mark rate limit as warning', () => {
            const error = new Error('Rate limit');
            const severity = handler.determineSeverity(error, ErrorCategory.RATE_LIMIT);
            expect(severity).toBe(ErrorSeverity.WARNING);
        });

        it('should mark authentication as fatal', () => {
            const error = new Error('Auth failed');
            const severity = handler.determineSeverity(error, ErrorCategory.AUTHENTICATION);
            expect(severity).toBe(ErrorSeverity.FATAL);
        });

        it('should mark configuration as fatal', () => {
            const error = new Error('Config error');
            const severity = handler.determineSeverity(error, ErrorCategory.CONFIGURATION);
            expect(severity).toBe(ErrorSeverity.FATAL);
        });

        it('should mark network as warning', () => {
            const error = new Error('Network error');
            const severity = handler.determineSeverity(error, ErrorCategory.NETWORK);
            expect(severity).toBe(ErrorSeverity.WARNING);
        });

        it('should mark device as error', () => {
            const error = new Error('Device error');
            const severity = handler.determineSeverity(error, ErrorCategory.DEVICE);
            expect(severity).toBe(ErrorSeverity.ERROR);
        });
    });

    describe('isRetryable', () => {
        it('should mark network errors as retryable', () => {
            const error = new Error('ECONNRESET');
            expect(handler.isRetryable(error)).toBe(true);
        });

        it('should mark timeout errors as retryable', () => {
            const error = new Error('ETIMEDOUT');
            expect(handler.isRetryable(error)).toBe(true);
        });

        it('should mark gateway errors as retryable', () => {
            const error = new Error('Bad gateway');
            expect(handler.isRetryable(error)).toBe(true);
        });

        it('should mark rate limit as retryable', () => {
            const error = new Error('Rate limit exceeded');
            expect(handler.isRetryable(error)).toBe(true);
        });

        it('should not mark validation errors as retryable', () => {
            const error = new Error('Invalid input');
            expect(handler.isRetryable(error)).toBe(false);
        });
    });

    describe('handle', () => {
        it('should handle error and log with context', () => {
            const error = new Error('Test error');
            const context = {
                category: ErrorCategory.API,
                operation: 'testOperation',
                deviceId: 'device123',
            };

            const handled = handler.handle(error, context);

            expect(handled.message).toBe('Test error');
            expect(handled.context.category).toBe(ErrorCategory.API);
            expect(handled.context.operation).toBe('testOperation');
            expect(handled.context.deviceId).toBe('device123');
            expect(mockLogger.error).toHaveBeenCalled();
        });

        it('should auto-categorize when category not provided', () => {
            const error = new Error('Unauthorized');
            const handled = handler.handle(error);

            expect(handled.context.category).toBe(ErrorCategory.AUTHENTICATION);
        });

        it('should auto-determine severity', () => {
            const error = new Error('Rate limit');
            const handled = handler.handle(error);

            expect(handled.context.severity).toBe(ErrorSeverity.WARNING);
        });

        it('should detect retryability', () => {
            const error = new Error('ECONNRESET');
            const handled = handler.handle(error);

            expect(handled.context.retryable).toBe(true);
        });

        it('should record error in history', () => {
            const error = new Error('Test error');
            handler.handle(error);

            const history = handler.getRecentErrors(1);
            expect(history).toHaveLength(1);
            expect(history[0].message).toBe('Test error');
        });
    });

    describe('handleWithMessage', () => {
        it('should return user-friendly message for authentication', () => {
            const error = new Error('Token expired');
            const message = handler.handleWithMessage(error, {
                category: ErrorCategory.AUTHENTICATION,
            });

            expect(message).toContain('Authentication failed');
        });

        it('should return user-friendly message for rate limit', () => {
            const error = new Error('Too many requests');
            const message = handler.handleWithMessage(error, {
                category: ErrorCategory.RATE_LIMIT,
            });

            expect(message).toContain('rate limit');
        });

        it('should return user-friendly message for network', () => {
            const error = new Error('Connection failed');
            const message = handler.handleWithMessage(error, {
                category: ErrorCategory.NETWORK,
            });

            expect(message).toContain('Network connection');
        });
    });

    describe('getRecentErrors', () => {
        it('should return limited number of recent errors', () => {
            for (let i = 0; i < 10; i++) {
                handler.handle(new Error(`Error ${i}`));
            }

            const recent = handler.getRecentErrors(5);
            expect(recent).toHaveLength(5);
        });

        it('should return all errors when no limit specified', () => {
            for (let i = 0; i < 5; i++) {
                handler.handle(new Error(`Error ${i}`));
            }

            const all = handler.getRecentErrors();
            expect(all).toHaveLength(5);
        });
    });

    describe('getErrorsByCategory', () => {
        it('should filter errors by category', () => {
            handler.handle(new Error('Auth error'), {category: ErrorCategory.AUTHENTICATION});
            handler.handle(new Error('Network error'), {category: ErrorCategory.NETWORK});
            handler.handle(new Error('Another auth error'), {category: ErrorCategory.AUTHENTICATION});

            const authErrors = handler.getErrorsByCategory(ErrorCategory.AUTHENTICATION);
            expect(authErrors).toHaveLength(2);
        });
    });

    describe('clearHistory', () => {
        it('should clear all error history', () => {
            handler.handle(new Error('Error 1'));
            handler.handle(new Error('Error 2'));
            expect(handler.getRecentErrors()).toHaveLength(2);

            handler.clearHistory();
            expect(handler.getRecentErrors()).toHaveLength(0);
        });
    });

    describe('logging', () => {
        it('should log fatal errors with stack trace', () => {
            const error = new Error('Fatal error');
            error.stack = 'Stack trace here';

            handler.handle(error, {
                category: ErrorCategory.AUTHENTICATION,
                severity: ErrorSeverity.FATAL,
            });

            expect(mockLogger.error).toHaveBeenCalledTimes(2); // Message + stack
        });

        it('should log warnings with warn level', () => {
            handler.handle(new Error('Warning'), {
                severity: ErrorSeverity.WARNING,
            });

            expect(mockLogger.warn).toHaveBeenCalled();
        });

        it('should include context in log messages', () => {
            handler.handle(new Error('Test'), {
                category: ErrorCategory.DEVICE,
                deviceId: 'device123',
                operation: 'update',
            });

            const logCall = (mockLogger.error as jest.Mock).mock.calls[0][0];
            expect(logCall).toContain('DEVICE');
            expect(logCall).toContain('device123');
            expect(logCall).toContain('update');
        });
    });
});
