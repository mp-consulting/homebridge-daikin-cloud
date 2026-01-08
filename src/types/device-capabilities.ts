/**
 * Device capability interfaces for the Daikin Cloud plugin.
 * These interfaces define the structure of detected device capabilities.
 */

import { DaikinOperationModes } from './daikin-enums';

/**
 * Represents all detected capabilities of a Daikin device.
 */
export interface DeviceCapabilities {
    // Management points
    hasClimateControl: boolean;
    hasDomesticHotWaterTank: boolean;
    hasGateway: boolean;

    // Climate control features
    hasPowerfulMode: boolean;
    hasEconoMode: boolean;
    hasStreamerMode: boolean;
    hasOutdoorSilentMode: boolean;
    hasIndoorSilentMode: boolean;
    hasSwingModeVertical: boolean;
    hasSwingModeHorizontal: boolean;
    hasFanControl: boolean;

    // Operation modes
    supportedOperationModes: DaikinOperationModes[];
    hasDryOperationMode: boolean;
    hasFanOnlyOperationMode: boolean;

    // Temperature control
    hasHeatingMode: boolean;
    hasCoolingMode: boolean;
    hasAutoMode: boolean;

    // Altherma-specific
    hasControlMode: boolean;
    hasSetpointMode: boolean;
}

/**
 * Temperature constraints for a specific mode.
 */
export interface TemperatureConstraints {
    minValue: number;
    maxValue: number;
    stepValue: number;
}

/**
 * Temperature capabilities per operation mode.
 */
export interface DeviceTemperatureCapabilities {
    cooling?: TemperatureConstraints;
    heating?: TemperatureConstraints;
    auto?: TemperatureConstraints;
    domesticHotWater?: TemperatureConstraints;
}
