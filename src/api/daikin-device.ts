/**
 * Daikin Cloud Device
 *
 * Represents a Daikin device from the cloud API.
 * Provides methods to get and set device data.
 */

import {EventEmitter} from 'node:events';
import {GatewayDevice, ManagementPoint, WebSocketDeviceUpdate} from './daikin-types';
import {DaikinApi} from './daikin-api';

export interface DeviceDataPoint {
    value: unknown;
    values?: string[];
    minValue?: number;
    maxValue?: number;
    stepValue?: number;
    settable?: boolean;
}

export class DaikinCloudDevice extends EventEmitter {
    private lastUpdated: Date = new Date();

    constructor(
        private rawData: GatewayDevice,
        private readonly api: DaikinApi,
    ) {
        super();
    }

    /**
     * Get the raw device data (replaces the old `desc` property)
     */
    get desc(): GatewayDevice {
        return this.rawData;
    }

    /**
     * Get the device ID
     */
    getId(): string {
        return this.rawData.id;
    }

    /**
     * Get the device description
     */
    getDescription(): { deviceModel: string } {
        return {
            deviceModel: this.rawData.deviceModel || 'Unknown',
        };
    }

    /**
     * Get the last update timestamp
     */
    getLastUpdated(): Date {
        return this.lastUpdated;
    }

    /**
     * Update the last updated timestamp
     */
    updateTimestamp(): void {
        this.lastUpdated = new Date();
    }

    /**
     * Get data from a management point
     *
     * @param managementPointId - The embedded ID of the management point (e.g., 'climateControl')
     * @param dataPoint - The data point name (e.g., 'operationMode', 'temperatureControl')
     * @param path - Optional path within the data point (e.g., '/operationModes/cooling/setpoints/roomTemperature')
     */
    getData(
        managementPointId: string,
        dataPoint: string,
        path: string | undefined,
    ): DeviceDataPoint {
        const managementPoint = this.getManagementPoint(managementPointId);
        if (!managementPoint) {
            return {value: undefined};
        }

        const data = managementPoint[dataPoint];
        if (!data) {
            return {value: undefined};
        }

        // If no path, return the data directly
        if (!path) {
            return data as DeviceDataPoint;
        }

        // Navigate the path
        return this.navigatePath(data, path);
    }

    /**
     * Set data on a management point
     *
     * @param managementPointId - The embedded ID of the management point
     * @param dataPoint - The data point name
     * @param pathOrValue - Either the path within the data point, or the value if no path
     * @param valueOrUndefined - The value to set, or undefined if pathOrValue is the value
     */
    async setData(
        managementPointId: string,
        dataPoint: string,
        pathOrValue: string | unknown,
        valueOrUndefined: unknown,
    ): Promise<void> {
        let path: string | undefined;
        let value: unknown;

        // Determine which overload was used
        if (valueOrUndefined !== undefined) {
            // setData(managementPointId, dataPoint, path, value)
            path = pathOrValue as string;
            value = valueOrUndefined;
        } else {
            // setData(managementPointId, dataPoint, value, undefined)
            path = undefined;
            value = pathOrValue;
        }

        // Call API with path in the body (not the URL) - matches mobile app format
        await this.api.updateDevice(this.rawData.id, managementPointId, dataPoint, value, path);
        this.lastUpdated = new Date();
    }

    /**
     * Update the raw device data (after refresh from API)
     */
    updateRawData(newData: GatewayDevice): void {
        this.rawData = newData;
        this.lastUpdated = new Date();
    }

    /**
     * Apply a WebSocket update to the device's raw data
     * This updates the in-memory data without making an API call
     */
    applyWebSocketUpdate(update: WebSocketDeviceUpdate): void {
        const managementPoint = this.getManagementPoint(update.embeddedId);
        if (!managementPoint) {
            return;
        }

        const characteristicName = update.characteristicName;
        const data = update.data;

        // Get or create the characteristic object
        let characteristic = managementPoint[characteristicName] as Record<string, unknown> | undefined;
        if (!characteristic) {
            characteristic = {};
            managementPoint[characteristicName] = characteristic;
        }

        // Update the characteristic with new data
        if (data.value !== undefined) {
            characteristic.value = data.value;
        }
        if (data.values !== undefined) {
            characteristic.values = data.values;
        }
        if (data.settable !== undefined) {
            characteristic.settable = data.settable;
        }
        if (data.minValue !== undefined) {
            characteristic.minValue = data.minValue;
        }
        if (data.maxValue !== undefined) {
            characteristic.maxValue = data.maxValue;
        }
        if (data.stepValue !== undefined) {
            characteristic.stepValue = data.stepValue;
        }

        // Emit an 'updated' event so accessories can react
        this.emit('updated', {
            characteristicName,
            embeddedId: update.embeddedId,
            data,
        });
    }

    // Private helper methods

    private getManagementPoint(embeddedId: string): ManagementPoint | undefined {
        return this.rawData.managementPoints?.find(mp => mp.embeddedId === embeddedId);
    }

    private navigatePath(data: unknown, path: string): DeviceDataPoint {
        if (!path || path === '/') {
            return data as DeviceDataPoint;
        }

        // Split path and navigate
        const parts = path.split('/').filter(p => p);
        let current: unknown = data;

        for (const part of parts) {
            if (current === null || current === undefined) {
                return {value: undefined};
            }

            // Handle 'value' wrapping - Daikin data often has { value: { ... } }
            if (typeof current === 'object' && 'value' in (current as object)) {
                current = (current as { value: unknown }).value;
            }

            if (typeof current === 'object' && current !== null && part in current) {
                current = (current as Record<string, unknown>)[part];
            } else {
                return {value: undefined};
            }
        }

        // If final result has a value property, return it properly
        if (typeof current === 'object' && current !== null && 'value' in current) {
            return current as DeviceDataPoint;
        }

        return {value: current};
    }
}
