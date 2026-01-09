/**
 * Device Capability Detector
 *
 * Centralized service for detecting device capabilities once and caching the results.
 * This replaces the scattered hasXxxFeature() methods in service classes.
 */

import {DaikinCloudDevice} from '../api';
import {
    DeviceCapabilities,
    DeviceTemperatureCapabilities,
    TemperatureConstraints,
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
        const supportedModes = (operationModeData?.values || []) as DaikinOperationModes[];

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
            hasSwingModeVertical: this.hasSwingMode('vertical'),
            hasSwingModeHorizontal: this.hasSwingMode('horizontal'),
            hasFanControl: this.detectFanControl(),

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

    private hasFeature(feature: string): boolean {
        return Boolean(this.device.getData(this.managementPointId, feature, undefined));
    }

    private hasSwingMode(direction: 'vertical' | 'horizontal'): boolean {
        const operationMode = this.getCurrentOperationMode();
        return Boolean(
            this.device.getData(
                this.managementPointId,
                'fanControl',
                `/operationModes/${operationMode}/fanDirection/${direction}/currentMode`,
            ),
        );
    }

    private detectIndoorSilentMode(): boolean {
        const operationMode = this.getCurrentOperationMode();
        const fanSpeedData = this.device.getData(
            this.managementPointId,
            'fanControl',
            `/operationModes/${operationMode}/fanSpeed/currentMode`,
        );

        if (!fanSpeedData) {
            return false;
        }

        const fanSpeedValues = (fanSpeedData.values || []) as string[];
        return fanSpeedValues.includes(DaikinFanSpeedModes.QUIET);
    }

    private detectFanControl(): boolean {
        const operationMode = this.getCurrentOperationMode();
        return Boolean(
            this.device.getData(
                this.managementPointId,
                'fanControl',
                `/operationModes/${operationMode}/fanSpeed/modes/fixed`,
            ),
        );
    }

    private getCurrentOperationMode(): string {
        const operationModeData = this.device.getData(
            this.managementPointId,
            'operationMode',
            undefined,
        );
        return (operationModeData?.value as string) || 'auto';
    }

    private detectTemperatureCapabilities(): DeviceTemperatureCapabilities {
        const capabilities: DeviceTemperatureCapabilities = {};

        const modes = ['cooling', 'heating', 'auto'] as const;

        for (const mode of modes) {
            const data = this.device.getData(
                this.managementPointId,
                'temperatureControl',
                `/operationModes/${mode}/setpoints/roomTemperature`,
            );

            if (data && data.minValue !== undefined && data.maxValue !== undefined && data.stepValue !== undefined) {
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
            '/operationModes/heating/setpoints/domesticHotWaterTemperature',
        );

        if (hotWaterData && hotWaterData.minValue !== undefined && hotWaterData.maxValue !== undefined && hotWaterData.stepValue !== undefined) {
            capabilities.domesticHotWater = {
                minValue: hotWaterData.minValue,
                maxValue: hotWaterData.maxValue,
                stepValue: hotWaterData.stepValue,
            };
        }

        return capabilities;
    }
}
