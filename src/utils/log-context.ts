/**
 * Structured Logging with Context
 *
 * Provides enhanced logging with structured context, categories, and formatting.
 */

import {Logger} from 'homebridge';

export enum LogLevel {
    DEBUG = 'debug',
    INFO = 'info',
    WARN = 'warn',
    ERROR = 'error',
}

export enum LogCategory {
    PLATFORM = 'Platform',
    API = 'API',
    AUTH = 'Auth',
    DEVICE = 'Device',
    WEBSOCKET = 'WebSocket',
    SERVICE = 'Service',
    FEATURE = 'Feature',
    CONFIG = 'Config',
    ACCESSORY = 'Accessory',
}

export interface LogContext {
    category?: LogCategory;
    deviceId?: string;
    deviceName?: string;
    operation?: string;
    embeddedId?: string;
    feature?: string;
    metadata?: Record<string, unknown>;
}

export interface LogEntry {
    level: LogLevel;
    message: string;
    context?: LogContext;
    timestamp: Date;
}

/**
 * Structured logger with context support
 */
export class StructuredLogger {
    private readonly history: LogEntry[] = [];
    private readonly maxHistorySize = 100;

    constructor(
        private readonly logger: Logger,
        private readonly defaultContext?: LogContext,
    ) {}

    /**
     * Log a debug message
     */
    debug(message: string, context?: LogContext): void {
        this.log(LogLevel.DEBUG, message, context);
    }

    /**
     * Log an info message
     */
    info(message: string, context?: LogContext): void {
        this.log(LogLevel.INFO, message, context);
    }

    /**
     * Log a warning message
     */
    warn(message: string, context?: LogContext): void {
        this.log(LogLevel.WARN, message, context);
    }

    /**
     * Log an error message
     */
    error(message: string, context?: LogContext): void {
        this.log(LogLevel.ERROR, message, context);
    }

    /**
     * Log with context
     */
    log(level: LogLevel, message: string, context?: LogContext): void {
        const mergedContext = this.mergeContext(context);
        const formattedMessage = this.formatMessage(message, mergedContext);

        // Call the appropriate logger method
        switch (level) {
            case LogLevel.DEBUG:
                this.logger.debug(formattedMessage);
                break;
            case LogLevel.INFO:
                this.logger.info(formattedMessage);
                break;
            case LogLevel.WARN:
                this.logger.warn(formattedMessage);
                break;
            case LogLevel.ERROR:
                this.logger.error(formattedMessage);
                break;
        }

        // Record in history
        this.recordLog({
            level,
            message,
            context: mergedContext,
            timestamp: new Date(),
        });
    }

    /**
     * Create a child logger with additional context
     */
    child(context: LogContext): StructuredLogger {
        const mergedContext = this.mergeContext(context);
        return new StructuredLogger(this.logger, mergedContext);
    }

    /**
     * Get log history
     */
    getHistory(limit?: number): LogEntry[] {
        return limit ? this.history.slice(-limit) : [...this.history];
    }

    /**
     * Clear log history
     */
    clearHistory(): void {
        this.history.length = 0;
    }

    /**
     * Merge context with defaults
     */
    private mergeContext(context?: LogContext): LogContext | undefined {
        if (!this.defaultContext && !context) {
            return undefined;
        }

        return {
            ...this.defaultContext,
            ...context,
            metadata: {
                ...this.defaultContext?.metadata,
                ...context?.metadata,
            },
        };
    }

    /**
     * Format log message with context
     */
    private formatMessage(message: string, context?: LogContext): string {
        if (!context) {
            return message;
        }

        const parts: string[] = [];

        // Add category
        if (context.category) {
            parts.push(`[${context.category}]`);
        }

        // Add device info
        if (context.deviceName) {
            parts.push(`[${context.deviceName}]`);
        } else if (context.deviceId) {
            parts.push(`[Device:${context.deviceId}]`);
        }

        // Add embedded ID
        if (context.embeddedId) {
            parts.push(`[${context.embeddedId}]`);
        }

        // Add operation
        if (context.operation) {
            parts.push(`(${context.operation})`);
        }

        // Add feature
        if (context.feature) {
            parts.push(`[Feature:${context.feature}]`);
        }

        // Build final message
        const prefix = parts.length > 0 ? `${parts.join(' ')} ` : '';
        let finalMessage = `${prefix}${message}`;

        // Add metadata if present
        if (context.metadata && Object.keys(context.metadata).length > 0) {
            const metadataStr = JSON.stringify(context.metadata);
            finalMessage += ` ${metadataStr}`;
        }

        return finalMessage;
    }

    /**
     * Record log entry in history
     */
    private recordLog(entry: LogEntry): void {
        this.history.push(entry);

        // Trim history if needed
        if (this.history.length > this.maxHistorySize) {
            this.history.splice(0, this.history.length - this.maxHistorySize);
        }
    }
}

/**
 * Create a structured logger
 */
export function createLogger(logger: Logger, context?: LogContext): StructuredLogger {
    return new StructuredLogger(logger, context);
}

/**
 * Create a logger for a specific category
 */
export function createCategoryLogger(logger: Logger, category: LogCategory): StructuredLogger {
    return createLogger(logger, {category});
}

/**
 * Create a logger for a device
 */
export function createDeviceLogger(
    logger: Logger,
    deviceId: string,
    deviceName?: string,
): StructuredLogger {
    return createLogger(logger, {
        category: LogCategory.DEVICE,
        deviceId,
        deviceName,
    });
}
