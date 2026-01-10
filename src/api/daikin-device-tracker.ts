/**
 * Device Tracker
 *
 * Tracks device state changes and errors for differential updates and diagnostics.
 * Enables efficient polling by only updating devices that have changed.
 */

import crypto from 'crypto';
import {GatewayDevice} from './daikin-types';

export interface DeviceError {
    timestamp: Date;
    severity: 'error' | 'warning';
    message: string;
    operation: string;
    retryCount: number;
}

/**
 * Device Tracker for managing device state and error history
 */
export class DeviceTracker {
    private lastUpdate: Date = new Date();
    private dataHash: string = '';
    private errors: DeviceError[] = [];
    private readonly maxErrors = 10; // Keep last 10 errors

    /**
     * Check if device data has changed since last update
     *
     * @param newData - New device data from API
     * @returns True if data has changed
     */
    hasChanges(newData: GatewayDevice): boolean {
        const newHash = this.computeHash(newData);
        return this.dataHash !== newHash;
    }

    /**
     * Update the tracked state
     *
     * @param data - Device data to track
     */
    updateState(data: GatewayDevice): void {
        this.lastUpdate = new Date();
        this.dataHash = this.computeHash(data);
    }

    /**
     * Get time since last update in milliseconds
     *
     * @returns Milliseconds since last update
     */
    getTimeSinceLastUpdate(): number {
        return Date.now() - this.lastUpdate.getTime();
    }

    /**
     * Get last update timestamp
     *
     * @returns Date of last update
     */
    getLastUpdateTime(): Date {
        return this.lastUpdate;
    }

    /**
     * Add an error to the device error history
     *
     * @param error - Error details
     */
    addError(error: DeviceError): void {
        this.errors.unshift(error);
        if (this.errors.length > this.maxErrors) {
            this.errors.pop();
        }
    }

    /**
     * Get all recorded errors
     *
     * @returns Array of errors
     */
    getErrors(): DeviceError[] {
        return [...this.errors];
    }

    /**
     * Get errors since a specific time
     *
     * @param since - Date to filter errors from
     * @returns Filtered errors
     */
    getRecentErrors(since: Date): DeviceError[] {
        return this.errors.filter(e => e.timestamp >= since);
    }

    /**
     * Clear all recorded errors
     */
    clearErrors(): void {
        this.errors = [];
    }

    /**
     * Check if device has recent errors (within last 5 minutes)
     *
     * @returns True if recent errors exist
     */
    hasRecentErrors(): boolean {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        return this.getRecentErrors(fiveMinutesAgo).length > 0;
    }

    /**
     * Get error count by severity
     *
     * @returns Object with error and warning counts
     */
    getErrorStats(): { errors: number; warnings: number } {
        return {
            errors: this.errors.filter(e => e.severity === 'error').length,
            warnings: this.errors.filter(e => e.severity === 'warning').length,
        };
    }

    /**
     * Compute hash of device data for change detection
     *
     * Uses MD5 hash of JSON-stringified data for fast comparison.
     * Note: This is for change detection only, not cryptographic security.
     *
     * @param data - Device data to hash
     * @returns MD5 hash string
     */
    private computeHash(data: GatewayDevice): string {
        try {
            // Create a stable JSON representation
            const stableJson = JSON.stringify(data, Object.keys(data).sort());
            return crypto
                .createHash('md5')
                .update(stableJson)
                .digest('hex');
        } catch (error) {
            // If hashing fails, return a timestamp-based hash to force update
            return Date.now().toString();
        }
    }
}
