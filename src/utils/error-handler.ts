/**
 * Error Handler Service
 *
 * Provides centralized error handling, logging, and recovery strategies.
 */

import {Logger} from 'homebridge';

export enum ErrorSeverity {
    INFO = 'INFO',
    WARNING = 'WARNING',
    ERROR = 'ERROR',
    FATAL = 'FATAL',
}

export enum ErrorCategory {
    AUTHENTICATION = 'AUTHENTICATION',
    NETWORK = 'NETWORK',
    RATE_LIMIT = 'RATE_LIMIT',
    VALIDATION = 'VALIDATION',
    API = 'API',
    DEVICE = 'DEVICE',
    WEBSOCKET = 'WEBSOCKET',
    CONFIGURATION = 'CONFIGURATION',
    UNKNOWN = 'UNKNOWN',
}

export interface ErrorContext {
    category: ErrorCategory;
    severity: ErrorSeverity;
    operation?: string;
    deviceId?: string;
    retryable?: boolean;
    metadata?: Record<string, unknown>;
}

export interface HandledError {
    message: string;
    originalError: Error;
    context: ErrorContext;
    timestamp: Date;
    stack?: string;
}

/**
 * Unified Error Handler
 */
export class ErrorHandler {
    private errorHistory: HandledError[] = [];
    private readonly maxHistorySize = 100;

    constructor(
        private readonly logger: Logger,
        private readonly contextPrefix: string = '',
    ) {}

    /**
     * Handle an error with context
     */
    handle(error: Error, context: Partial<ErrorContext> = {}): HandledError {
        const handledError = this.createHandledError(error, context);
        this.logError(handledError);
        this.recordError(handledError);
        return handledError;
    }

    /**
     * Handle an error and return a user-friendly message
     */
    handleWithMessage(error: Error, context: Partial<ErrorContext> = {}): string {
        const handled = this.handle(error, context);
        return this.getUserMessage(handled);
    }

    /**
     * Determine if an error is retryable
     */
    isRetryable(error: Error): boolean {
        const errorMessage = error.message.toLowerCase();

        // Network errors that are typically retryable
        if (
            errorMessage.includes('econnreset') ||
            errorMessage.includes('econnrefused') ||
            errorMessage.includes('etimedout') ||
            errorMessage.includes('socket hang up') ||
            errorMessage.includes('network')
        ) {
            return true;
        }

        // Gateway errors
        if (
            errorMessage.includes('bad gateway') ||
            errorMessage.includes('service unavailable') ||
            errorMessage.includes('gateway timeout')
        ) {
            return true;
        }

        // Rate limit (retryable after delay)
        if (errorMessage.includes('rate limit')) {
            return true;
        }

        return false;
    }

    /**
     * Categorize an error
     */
    categorize(error: Error): ErrorCategory {
        const message = error.message.toLowerCase();

        if (message.includes('unauthorized') || message.includes('token') || message.includes('auth')) {
            return ErrorCategory.AUTHENTICATION;
        }

        if (message.includes('rate limit')) {
            return ErrorCategory.RATE_LIMIT;
        }

        if (
            message.includes('econnreset') ||
            message.includes('econnrefused') ||
            message.includes('etimedout') ||
            message.includes('network') ||
            message.includes('socket')
        ) {
            return ErrorCategory.NETWORK;
        }

        if (message.includes('websocket') || message.includes('ws:')) {
            return ErrorCategory.WEBSOCKET;
        }

        if (message.includes('validation') || message.includes('invalid')) {
            return ErrorCategory.VALIDATION;
        }

        if (message.includes('device')) {
            return ErrorCategory.DEVICE;
        }

        if (message.includes('config')) {
            return ErrorCategory.CONFIGURATION;
        }

        if (message.includes('api') || message.includes('status')) {
            return ErrorCategory.API;
        }

        return ErrorCategory.UNKNOWN;
    }

    /**
     * Determine error severity
     */
    determineSeverity(error: Error, category: ErrorCategory): ErrorSeverity {
        // Rate limit is a warning, not an error
        if (category === ErrorCategory.RATE_LIMIT) {
            return ErrorSeverity.WARNING;
        }

        // Authentication errors are fatal
        if (category === ErrorCategory.AUTHENTICATION) {
            return ErrorSeverity.FATAL;
        }

        // Configuration errors are fatal
        if (category === ErrorCategory.CONFIGURATION) {
            return ErrorSeverity.FATAL;
        }

        // Network errors are typically warnings (transient)
        if (category === ErrorCategory.NETWORK) {
            return ErrorSeverity.WARNING;
        }

        // Device errors are typically errors
        if (category === ErrorCategory.DEVICE) {
            return ErrorSeverity.ERROR;
        }

        // Default to error
        return ErrorSeverity.ERROR;
    }

    /**
     * Get recent errors
     */
    getRecentErrors(limit = 10): HandledError[] {
        return this.errorHistory.slice(-limit);
    }

    /**
     * Get errors by category
     */
    getErrorsByCategory(category: ErrorCategory): HandledError[] {
        return this.errorHistory.filter(e => e.context.category === category);
    }

    /**
     * Clear error history
     */
    clearHistory(): void {
        this.errorHistory = [];
    }

    /**
     * Create a handled error object
     */
    private createHandledError(error: Error, context: Partial<ErrorContext>): HandledError {
        const category = context.category ?? this.categorize(error);
        const severity = context.severity ?? this.determineSeverity(error, category);
        const retryable = context.retryable ?? this.isRetryable(error);

        return {
            message: error.message,
            originalError: error,
            context: {
                category,
                severity,
                retryable,
                ...context,
            },
            timestamp: new Date(),
            stack: error.stack,
        };
    }

    /**
     * Log an error with appropriate level
     */
    private logError(error: HandledError): void {
        const prefix = this.contextPrefix ? `[${this.contextPrefix}] ` : '';
        const operation = error.context.operation ? ` (${error.context.operation})` : '';
        const deviceId = error.context.deviceId ? ` [${error.context.deviceId}]` : '';
        const message = `${prefix}${error.context.category}${operation}${deviceId}: ${error.message}`;

        switch (error.context.severity) {
            case ErrorSeverity.FATAL:
                this.logger.error(message);
                if (error.stack) {
                    this.logger.error(error.stack);
                }
                break;
            case ErrorSeverity.ERROR:
                this.logger.error(message);
                break;
            case ErrorSeverity.WARNING:
                this.logger.warn(message);
                break;
            case ErrorSeverity.INFO:
                this.logger.info(message);
                break;
        }
    }

    /**
     * Record error in history
     */
    private recordError(error: HandledError): void {
        this.errorHistory.push(error);

        // Trim history if needed
        if (this.errorHistory.length > this.maxHistorySize) {
            this.errorHistory = this.errorHistory.slice(-this.maxHistorySize);
        }
    }

    /**
     * Get user-friendly error message
     */
    private getUserMessage(error: HandledError): string {
        switch (error.context.category) {
            case ErrorCategory.AUTHENTICATION:
                return 'Authentication failed. Please check your credentials and re-authenticate.';
            case ErrorCategory.RATE_LIMIT:
                return 'API rate limit exceeded. Please wait before trying again.';
            case ErrorCategory.NETWORK:
                return 'Network connection issue. Will retry automatically.';
            case ErrorCategory.WEBSOCKET:
                return 'WebSocket connection issue. Will attempt to reconnect.';
            case ErrorCategory.DEVICE:
                return `Device error: ${error.message}`;
            case ErrorCategory.CONFIGURATION:
                return `Configuration error: ${error.message}`;
            case ErrorCategory.VALIDATION:
                return `Validation error: ${error.message}`;
            case ErrorCategory.API:
                return `API error: ${error.message}`;
            default:
                return error.message;
        }
    }
}

/**
 * Create a scoped error handler
 */
export function createErrorHandler(logger: Logger, context: string): ErrorHandler {
    return new ErrorHandler(logger, context);
}
