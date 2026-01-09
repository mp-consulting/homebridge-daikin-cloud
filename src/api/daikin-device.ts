/**
 * Daikin Cloud Device
 *
 * Represents a Daikin device from the cloud API.
 * Provides methods to get and set device data.
 */

import {EventEmitter} from 'node:events';
import {GatewayDevice, ManagementPoint} from './daikin-types';
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
    public readonly desc: GatewayDevice;
    private lastUpdated: Date = new Date();

    constructor(
        private readonly rawData: GatewayDevice,
        private readonly api: DaikinApi,
    ) {
        super();
        this.desc = rawData;
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

        // Build the characteristic path for the API
        let characteristic = dataPoint;
        if (path) {
            characteristic = `${dataPoint}${path}`;
        }

        await this.api.updateDevice(this.rawData.id, managementPointId, characteristic, value);
        this.lastUpdated = new Date();
    }

    /**
     * Update the raw device data (after refresh from API)
     */
    updateRawData(newData: GatewayDevice): void {
        Object.assign(this.rawData, newData);
        (this as { desc: GatewayDevice }).desc = this.rawData;
        this.lastUpdated = new Date();
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
