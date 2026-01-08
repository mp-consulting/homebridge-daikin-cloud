/**
 * Device Profile Catalog
 *
 * Defines device profiles for different Daikin device types.
 * Each profile contains information about how to handle the device.
 */

import {DaikinCloudDevice} from 'daikin-controller-cloud/dist/device';

/**
 * Supported device types
 */
export enum DeviceType {
    AIR_CONDITIONING = 'air_conditioning',
    ALTHERMA = 'altherma',
    UNKNOWN = 'unknown',
}

/**
 * Device profile defining characteristics and behavior for a device type
 */
export interface DeviceProfile {
    type: DeviceType;
    displayName: string;
    managementPoints: {
        climateControl: boolean;
        domesticHotWaterTank: boolean;
    };
    typicalFeatures: string[];
    matcher: (device: DaikinCloudDevice) => boolean;
}

/**
 * Catalog of known device profiles
 */
export const DEVICE_PROFILES: DeviceProfile[] = [
    {
        type: DeviceType.ALTHERMA,
        displayName: 'Daikin Altherma Heat Pump',
        managementPoints: {
            climateControl: true,
            domesticHotWaterTank: true,
        },
        typicalFeatures: [
            'powerfulMode',
            'controlMode',
            'setpointMode',
        ],
        matcher: (device: DaikinCloudDevice) => {
            const deviceModel = device.getDescription().deviceModel;
            return deviceModel === 'Altherma';
        },
    },
    {
        type: DeviceType.AIR_CONDITIONING,
        displayName: 'Daikin Air Conditioning',
        managementPoints: {
            climateControl: true,
            domesticHotWaterTank: false,
        },
        typicalFeatures: [
            'powerfulMode',
            'econoMode',
            'streamerMode',
            'outdoorSilentMode',
            'fanControl',
            'swingMode',
        ],
        matcher: (device: DaikinCloudDevice) => {
            const deviceModel = device.getDescription().deviceModel;
            // Match devices that are not Altherma and have climate control
            if (deviceModel === 'Altherma') {
                return false;
            }
            // Check if device has climate control management point
            return device.desc.managementPoints.some(
                (mp: { managementPointType: string }) =>
                    mp.managementPointType === 'climateControl',
            );
        },
    },
];

/**
 * Find matching device profile for a device.
 * Returns the first matching profile or an unknown profile as fallback.
 */
export function matchDeviceProfile(device: DaikinCloudDevice): DeviceProfile {
    const matched = DEVICE_PROFILES.find(profile => profile.matcher(device));

    if (matched) {
        return matched;
    }

    // Return unknown profile as fallback
    return createUnknownProfile(device);
}

/**
 * Create an unknown device profile based on device capabilities
 */
function createUnknownProfile(device: DaikinCloudDevice): DeviceProfile {
    const hasClimateControl = device.desc.managementPoints.some(
        (mp: { managementPointType: string }) =>
            mp.managementPointType === 'climateControl',
    );
    const hasDomesticHotWaterTank = device.desc.managementPoints.some(
        (mp: { managementPointType: string }) =>
            mp.managementPointType === 'domesticHotWaterTank',
    );

    return {
        type: DeviceType.UNKNOWN,
        displayName: 'Daikin Device',
        managementPoints: {
            climateControl: hasClimateControl,
            domesticHotWaterTank: hasDomesticHotWaterTank,
        },
        typicalFeatures: [],
        matcher: () => true,
    };
}

/**
 * Get device profile by type
 */
export function getProfileByType(type: DeviceType): DeviceProfile | undefined {
    return DEVICE_PROFILES.find(profile => profile.type === type);
}
