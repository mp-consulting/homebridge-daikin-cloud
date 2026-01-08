/**
 * Accessory Factory
 *
 * Factory for creating accessories based on device profiles.
 * Replaces hard-coded device type checks in platform.ts.
 */

import {PlatformAccessory, Logger} from 'homebridge';
import {DaikinCloudAccessoryContext, DaikinCloudPlatform} from '../platform';
import {DeviceType, matchDeviceProfile, DeviceProfile} from './profiles/device-profile';
import {AirConditioningAccessory, AlthermaAccessory, BaseAccessory} from '../accessories';

/**
 * Result of accessory creation
 */
export interface AccessoryFactoryResult {
    accessory: BaseAccessory;
    profile: DeviceProfile;
}

/**
 * Factory for creating Daikin accessories based on device profiles
 */
export class AccessoryFactory {
    private readonly platform: DaikinCloudPlatform;
    private readonly log: Logger;

    constructor(platform: DaikinCloudPlatform) {
        this.platform = platform;
        this.log = platform.log;
    }

    /**
     * Create an accessory for the given platform accessory.
     * Uses the device profile to determine which accessory class to instantiate.
     */
    createAccessory(
        platformAccessory: PlatformAccessory<DaikinCloudAccessoryContext>,
    ): AccessoryFactoryResult {
        const device = platformAccessory.context.device;
        const profile = matchDeviceProfile(device);

        this.log.debug(
            `[AccessoryFactory] Creating accessory for device type: ${profile.type}, ` +
            `model: ${device.getDescription().deviceModel}, ` +
            `display name: ${profile.displayName}`,
        );

        let accessory: BaseAccessory;

        switch (profile.type) {
            case DeviceType.ALTHERMA:
                accessory = new AlthermaAccessory(this.platform, platformAccessory);
                break;

            case DeviceType.AIR_CONDITIONING:
            case DeviceType.UNKNOWN:
            default:
                // Default to AC accessory for unknown devices with climateControl
                if (profile.managementPoints.climateControl) {
                    accessory = new AirConditioningAccessory(this.platform, platformAccessory);
                } else {
                    throw new Error(
                        `Unsupported device type: ${device.getDescription().deviceModel}. ` +
                        `Device has no climate control management point.`,
                    );
                }
                break;
        }

        return {accessory, profile};
    }

    /**
     * Get the profile for a device without creating an accessory.
     * Useful for logging and diagnostics.
     */
    getDeviceProfile(
        platformAccessory: PlatformAccessory<DaikinCloudAccessoryContext>,
    ): DeviceProfile {
        return matchDeviceProfile(platformAccessory.context.device);
    }
}
