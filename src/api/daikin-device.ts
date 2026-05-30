/**
 * Daikin Cloud Device
 *
 * Represents a Daikin device from the cloud API.
 * Provides methods to get and set device data.
 */

import { EventEmitter } from 'node:events';
import type { GatewayDevice, ManagementPoint, WebSocketDeviceUpdate } from './daikin-types';
import type { DaikinApi } from './daikin-api';

export class DeviceOfflineError extends Error {
  constructor(deviceId: string) {
    super(`Device ${deviceId} is offline (cloud connection down)`);
    this.name = 'DeviceOfflineError';
  }
}

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
      return { value: undefined };
    }

    const data = managementPoint[dataPoint];
    if (!data) {
      return { value: undefined };
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

    // Check if device cloud connection is up before attempting write
    if (this.rawData.isCloudConnectionUp?.value === false) {
      throw new DeviceOfflineError(this.rawData.id);
    }

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

    // Optimistically reflect the write in the in-memory cache so getData returns
    // the new value immediately, instead of the stale one until the next poll
    // (up to forceUpdateDelay / the polling interval away). Without this, switches
    // that derive their state from a data point — e.g. the Auto fan mode switch
    // reading fanSpeed/currentMode — keep showing the old state after a related
    // change (moving the fan speed slider flips currentMode to 'fixed', but the
    // switch stayed on). The next full poll reconciles any drift.
    this.applyLocalWrite(managementPointId, dataPoint, value, path);
    this.lastUpdated = new Date();
  }

  /**
     * Enable or disable holiday (away) mode on a management point.
     *
     * Holiday mode uses a dedicated endpoint instead of the per-characteristic
     * PATCH used by setData, so it has its own method. Optimistically reflects
     * the new state in the in-memory cache (mirroring setData) so getData returns
     * it immediately instead of the stale value until the next poll.
     *
     * @param managementPointId - The embedded ID of the management point
     * @param enabled - Whether holiday mode should be enabled
     * @param startDate - Optional start date (YYYY-MM-DD)
     * @param endDate - Optional end date (YYYY-MM-DD)
     */
  async setHolidayMode(
    managementPointId: string,
    enabled: boolean,
    startDate?: string,
    endDate?: string,
  ): Promise<void> {
    // Check device cloud connection is up before attempting write
    if (this.rawData.isCloudConnectionUp?.value === false) {
      throw new DeviceOfflineError(this.rawData.id);
    }

    await this.api.setHolidayMode(this.rawData.id, managementPointId, { enabled, startDate, endDate });

    // Optimistically reflect the write in the in-memory cache
    const managementPoint = this.getManagementPoint(managementPointId);
    const holidayMode = managementPoint?.holidayMode;
    if (holidayMode && typeof holidayMode.value === 'object' && holidayMode.value !== null) {
      holidayMode.value.enabled = enabled;
      if (startDate !== undefined) {
        holidayMode.value.startDate = startDate;
      }
      if (endDate !== undefined) {
        holidayMode.value.endDate = endDate;
      }
    }
    this.lastUpdated = new Date();
  }

  /**
     * Update the raw device data (after refresh from API)
     */
  updateRawData(newData: GatewayDevice): void {
    this.rawData = newData;
    this.lastUpdated = new Date();
    this.emit('updated');
  }

  /**
     * Apply a WebSocket update to the device's raw data
     * This updates the in-memory data without making an API call
     *
     * Daikin sends PARTIAL sub-trees on WebSocket — e.g. a fanControl push for a
     * single operationMode/fanDirection/vertical path. A naive
     * `characteristic.value = data.value` assignment would wipe out every other
     * operation mode and sibling path, leaving GET handlers reading undefined
     * until the next full poll. Deep-merge object values so partial pushes
     * augment instead of replace; primitives and arrays still replace.
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
      characteristic.value = mergeValue(characteristic.value, data.value);
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

  /**
     * Optimistically write a value into the in-memory cache after a successful
     * setData, so subsequent getData calls see it without waiting for a poll.
     * Navigates exactly like navigatePath (descending through Daikin's
     * { value: { ... } } wrapping) and sets the leaf's `value`. No-op if the
     * path can't be resolved — the next full poll will provide the real value.
     */
  private applyLocalWrite(
    managementPointId: string,
    dataPoint: string,
    value: unknown,
    path: string | undefined,
  ): void {
    const managementPoint = this.getManagementPoint(managementPointId);
    if (!managementPoint) {
      return;
    }

    const data = managementPoint[dataPoint];
    if (!data || typeof data !== 'object') {
      return;
    }

    if (!path) {
      (data as Record<string, unknown>).value = value;
      return;
    }

    const parts = path.split('/').filter(p => p);
    let current: unknown = data;
    for (const part of parts) {
      if (current === null || current === undefined) {
        return;
      }
      if (typeof current === 'object' && 'value' in (current as object)) {
        current = (current as { value: unknown }).value;
      }
      if (typeof current === 'object' && current !== null && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return;
      }
    }

    if (typeof current === 'object' && current !== null && 'value' in current) {
      (current as Record<string, unknown>).value = value;
    }
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
        return { value: undefined };
      }

      // Handle 'value' wrapping - Daikin data often has { value: { ... } }
      if (typeof current === 'object' && 'value' in (current as object)) {
        current = (current as { value: unknown }).value;
      }

      if (typeof current === 'object' && current !== null && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return { value: undefined };
      }
    }

    // If final result has a value property, return it properly
    if (typeof current === 'object' && current !== null && 'value' in current) {
      return current as DeviceDataPoint;
    }

    return { value: current };
  }
}

/**
 * Deep-merge a partial WebSocket value into the existing in-memory value.
 * Plain objects merge key-by-key; arrays and primitives replace. Without this,
 * a partial fanControl push for cooling/vertical wipes heating/auto/dry/fanOnly
 * out of memory until the next full poll. See applyWebSocketUpdate.
 */
function mergeValue(existing: unknown, incoming: unknown): unknown {
  if (!isPlainObject(existing) || !isPlainObject(incoming)) {
    return incoming;
  }
  const merged: Record<string, unknown> = { ...existing };
  for (const key of Object.keys(incoming)) {
    merged[key] = mergeValue(merged[key], incoming[key]);
  }
  return merged;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
