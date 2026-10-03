/**
 * Device Capability Detector
 *
 * Centralized service for detecting device capabilities once and caching the results.
 * FeatureManager passes the result to every feature, so isSupported() reads one source.
 */

import type { DaikinCloudDevice } from '../api';
import type { FanAxis } from './data-paths';
import { DataPaths } from './data-paths';
import type {
  DeviceCapabilities,
  DeviceTemperatureCapabilities } from '../types';
import {
  DaikinOperationModes,
  DaikinFanSpeedModes,
} from '../types';

export class DeviceCapabilityDetector {
  private readonly device: DaikinCloudDevice;
  private readonly managementPointId: string;
  private cachedCapabilities: DeviceCapabilities | null = null;
  private cachedTemperatureCapabilities: DeviceTemperatureCapabilities | null = null;

  constructor(device: DaikinCloudDevice, managementPointId: string) {
    this.device = device;
    this.managementPointId = managementPointId;
  }

  /**
     * Get all device capabilities. Results are cached after first detection.
     */
  getCapabilities(): DeviceCapabilities {
    if (this.cachedCapabilities) {
      return this.cachedCapabilities;
    }

    this.cachedCapabilities = this.detectCapabilities();
    return this.cachedCapabilities;
  }

  /**
     * Get temperature capabilities per operation mode. Results are cached.
     */
  getTemperatureCapabilities(): DeviceTemperatureCapabilities {
    if (this.cachedTemperatureCapabilities) {
      return this.cachedTemperatureCapabilities;
    }

    this.cachedTemperatureCapabilities = this.detectTemperatureCapabilities();
    return this.cachedTemperatureCapabilities;
  }

  /**
     * Clear cached capabilities (useful if device data is refreshed).
     */
  clearCache(): void {
    this.cachedCapabilities = null;
    this.cachedTemperatureCapabilities = null;
  }

  private detectCapabilities(): DeviceCapabilities {
    const operationModeData = this.device.getData(
      this.managementPointId,
      'operationMode',
      undefined,
    );
    const supportedModes = (operationModeData.values || []) as DaikinOperationModes[];

    return {
      // Management points
      hasClimateControl: this.hasManagementPoint('climateControl'),
      hasDomesticHotWaterTank: this.hasManagementPoint('domesticHotWaterTank'),
      hasGateway: this.hasManagementPoint('gateway'),

      // Climate control features
      hasPowerfulMode: this.hasFeature('powerfulMode'),
      hasEconoMode: this.hasFeature('econoMode'),
      hasStreamerMode: this.hasFeature('streamerMode'),
      hasOutdoorSilentMode: this.hasFeature('outdoorSilentMode'),
      hasIndoorSilentMode: this.detectIndoorSilentMode(),
      hasAutoFanMode: this.detectAutoFanMode(),
      hasSwingModeVertical: this.hasSwingMode('vertical'),
      hasSwingModeHorizontal: this.hasSwingMode('horizontal'),
      hasFanControl: this.detectFanControl(),
      hasHolidayMode: this.detectHolidayMode(),

      // Operation modes
      supportedOperationModes: supportedModes,
      hasDryOperationMode: supportedModes.includes(DaikinOperationModes.DRY),
      hasFanOnlyOperationMode: supportedModes.includes(DaikinOperationModes.FAN_ONLY),

      // Temperature control
      hasHeatingMode: supportedModes.includes(DaikinOperationModes.HEATING),
      hasCoolingMode: supportedModes.includes(DaikinOperationModes.COOLING),
      hasAutoMode: supportedModes.includes(DaikinOperationModes.AUTO),

      // Altherma-specific
      hasControlMode: this.hasFeature('controlMode'),
      hasSetpointMode: this.hasFeature('setpointMode'),
    };
  }

  private hasManagementPoint(type: string): boolean {
    return this.device.desc.managementPoints.some(
      (mp: { managementPointType: string }) => mp.managementPointType === type,
    );
  }

  /**
   * getData() returns `{ value: undefined }` when a data point is missing, so the
   * wrapper itself is always truthy — support means the inner value is set.
   */
  private hasValue(dataPoint: string, path?: string): boolean {
    return this.device.getData(this.managementPointId, dataPoint, path).value !== undefined;
  }

  private hasFeature(feature: string): boolean {
    return this.hasValue(feature);
  }

  private hasSwingMode(direction: FanAxis): boolean {
    return this.hasValue('fanControl', DataPaths.fanDirection(this.getCurrentOperationMode(), direction));
  }

  private fanSpeedModes(): string[] {
    const fanSpeedData = this.device.getData(
      this.managementPointId,
      'fanControl',
      DataPaths.fanSpeedCurrentMode(this.getCurrentOperationMode()),
    );
    return fanSpeedData.values || [];
  }

  private detectIndoorSilentMode(): boolean {
    return this.fanSpeedModes().includes(DaikinFanSpeedModes.QUIET);
  }

  /** Only meaningful when the device can toggle between 'auto' and a manual ('fixed') speed. */
  private detectAutoFanMode(): boolean {
    const fanSpeedValues = this.fanSpeedModes();
    return fanSpeedValues.includes(DaikinFanSpeedModes.AUTO) && fanSpeedValues.includes(DaikinFanSpeedModes.FIXED);
  }

  private detectFanControl(): boolean {
    return this.hasValue('fanControl', DataPaths.fanSpeedFixed(this.getCurrentOperationMode()));
  }

  private detectHolidayMode(): boolean {
    const holidayMode = this.device.getData(this.managementPointId, 'holidayMode', undefined).value as { enabled?: unknown } | undefined;
    return holidayMode?.enabled !== undefined;
  }

  private getCurrentOperationMode(): string {
    const operationMode = this.device.getData(this.managementPointId, 'operationMode', undefined).value;
    return typeof operationMode === 'string' && operationMode ? operationMode : DaikinOperationModes.AUTO;
  }

  private detectTemperatureCapabilities(): DeviceTemperatureCapabilities {
    const capabilities: DeviceTemperatureCapabilities = {};

    const modes = ['cooling', 'heating', 'auto'] as const;

    for (const mode of modes) {
      const data = this.device.getData(
        this.managementPointId,
        'temperatureControl',
        DataPaths.setpoint(mode, 'roomTemperature'),
      );

      if (data.minValue !== undefined && data.maxValue !== undefined && data.stepValue !== undefined) {
        capabilities[mode] = {
          minValue: data.minValue,
          maxValue: data.maxValue,
          stepValue: data.stepValue,
        };
      }
    }

    // Check for domestic hot water temperature
    const hotWaterData = this.device.getData(
      this.managementPointId,
      'temperatureControl',
      DataPaths.setpoint('heating', 'domesticHotWaterTemperature'),
    );

    if (hotWaterData.minValue !== undefined && hotWaterData.maxValue !== undefined && hotWaterData.stepValue !== undefined) {
      capabilities.domesticHotWater = {
        minValue: hotWaterData.minValue,
        maxValue: hotWaterData.maxValue,
        stepValue: hotWaterData.stepValue,
      };
    }

    return capabilities;
  }
}
