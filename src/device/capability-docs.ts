/**
 * Device Documentation
 *
 * Utility for generating human-readable capability documentation from device data.
 * Useful for debugging and understanding what features a device supports.
 */

import {DeviceCapabilities, DeviceTemperatureCapabilities} from '../types';

/**
 * Format device capabilities as a human-readable string array for logging.
 */
export function formatCapabilities(capabilities: DeviceCapabilities): string[] {
    const lines: string[] = [];

    // Management points
    lines.push('Management Points:');
    lines.push(`  - Climate Control: ${capabilities.hasClimateControl ? 'Yes' : 'No'}`);
    lines.push(`  - Domestic Hot Water Tank: ${capabilities.hasDomesticHotWaterTank ? 'Yes' : 'No'}`);
    lines.push(`  - Gateway: ${capabilities.hasGateway ? 'Yes' : 'No'}`);

    // Operation modes
    if (capabilities.supportedOperationModes.length > 0) {
        lines.push('Operation Modes:');
        lines.push(`  - Supported: ${capabilities.supportedOperationModes.join(', ')}`);
        lines.push(`  - Heating: ${capabilities.hasHeatingMode ? 'Yes' : 'No'}`);
        lines.push(`  - Cooling: ${capabilities.hasCoolingMode ? 'Yes' : 'No'}`);
        lines.push(`  - Auto: ${capabilities.hasAutoMode ? 'Yes' : 'No'}`);
        lines.push(`  - Dry: ${capabilities.hasDryOperationMode ? 'Yes' : 'No'}`);
        lines.push(`  - Fan Only: ${capabilities.hasFanOnlyOperationMode ? 'Yes' : 'No'}`);
    }

    // Climate control features
    lines.push('Climate Features:');
    lines.push(`  - Powerful Mode: ${capabilities.hasPowerfulMode ? 'Yes' : 'No'}`);
    lines.push(`  - Econo Mode: ${capabilities.hasEconoMode ? 'Yes' : 'No'}`);
    lines.push(`  - Streamer Mode: ${capabilities.hasStreamerMode ? 'Yes' : 'No'}`);
    lines.push(`  - Outdoor Silent Mode: ${capabilities.hasOutdoorSilentMode ? 'Yes' : 'No'}`);
    lines.push(`  - Indoor Silent Mode: ${capabilities.hasIndoorSilentMode ? 'Yes' : 'No'}`);

    // Fan control
    lines.push('Fan Control:');
    lines.push(`  - Fan Speed Control: ${capabilities.hasFanControl ? 'Yes' : 'No'}`);
    lines.push(`  - Vertical Swing: ${capabilities.hasSwingModeVertical ? 'Yes' : 'No'}`);
    lines.push(`  - Horizontal Swing: ${capabilities.hasSwingModeHorizontal ? 'Yes' : 'No'}`);

    // Altherma-specific
    if (capabilities.hasControlMode || capabilities.hasSetpointMode) {
        lines.push('Altherma Features:');
        lines.push(`  - Control Mode: ${capabilities.hasControlMode ? 'Yes' : 'No'}`);
        lines.push(`  - Setpoint Mode: ${capabilities.hasSetpointMode ? 'Yes' : 'No'}`);
    }

    return lines;
}

/**
 * Format temperature capabilities as a human-readable string array.
 */
export function formatTemperatureCapabilities(capabilities: DeviceTemperatureCapabilities): string[] {
    const lines: string[] = [];

    lines.push('Temperature Ranges:');

    if (capabilities.cooling) {
        lines.push(`  - Cooling: ${capabilities.cooling.minValue}°C - ${capabilities.cooling.maxValue}°C (step: ${capabilities.cooling.stepValue}°C)`);
    }

    if (capabilities.heating) {
        lines.push(`  - Heating: ${capabilities.heating.minValue}°C - ${capabilities.heating.maxValue}°C (step: ${capabilities.heating.stepValue}°C)`);
    }

    if (capabilities.auto) {
        lines.push(`  - Auto: ${capabilities.auto.minValue}°C - ${capabilities.auto.maxValue}°C (step: ${capabilities.auto.stepValue}°C)`);
    }

    if (capabilities.domesticHotWater) {
        lines.push(`  - Hot Water: ${capabilities.domesticHotWater.minValue}°C - ${capabilities.domesticHotWater.maxValue}°C (step: ${capabilities.domesticHotWater.stepValue}°C)`);
    }

    return lines;
}

/**
 * Generate a compact summary of device capabilities.
 */
export function getCapabilitySummary(capabilities: DeviceCapabilities): string {
    const features: string[] = [];

    if (capabilities.hasPowerfulMode) {
        features.push('powerful');
    }
    if (capabilities.hasEconoMode) {
        features.push('econo');
    }
    if (capabilities.hasStreamerMode) {
        features.push('streamer');
    }
    if (capabilities.hasOutdoorSilentMode) {
        features.push('outdoor-silent');
    }
    if (capabilities.hasIndoorSilentMode) {
        features.push('indoor-silent');
    }
    if (capabilities.hasFanControl) {
        features.push('fan-speed');
    }
    if (capabilities.hasSwingModeVertical || capabilities.hasSwingModeHorizontal) {
        features.push('swing');
    }
    if (capabilities.hasDryOperationMode) {
        features.push('dry-mode');
    }
    if (capabilities.hasFanOnlyOperationMode) {
        features.push('fan-only');
    }

    return features.length > 0 ? features.join(', ') : 'basic';
}
