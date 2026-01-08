/**
 * Base Feature
 *
 * Abstract base class for all feature modules.
 * Each feature represents an optional capability like PowerfulMode, EconoMode, etc.
 */

import {CharacteristicValue, PlatformAccessory, Service, Logger} from 'homebridge';
import {DaikinCloudAccessoryContext, DaikinCloudPlatform} from '../platform';
import {DaikinCloudRepo} from '../repository/daikinCloudRepo';

/**
 * Abstract base class for feature modules.
 * Features are optional capabilities that can be enabled/disabled via switches.
 */
export abstract class BaseFeature {
    protected readonly platform: DaikinCloudPlatform;
    protected readonly accessory: PlatformAccessory<DaikinCloudAccessoryContext>;
    protected readonly managementPointId: string;
    protected readonly log: Logger;
    protected readonly name: string;

    protected switchService?: Service;

    constructor(
        platform: DaikinCloudPlatform,
        accessory: PlatformAccessory<DaikinCloudAccessoryContext>,
        managementPointId: string,
    ) {
        this.platform = platform;
        this.accessory = accessory;
        this.managementPointId = managementPointId;
        this.log = platform.log;
        this.name = accessory.displayName;
    }

    /**
     * The display name for this feature (used for the switch service).
     */
    abstract get featureName(): string;

    /**
     * The unique identifier for this feature's switch service.
     */
    abstract get serviceSubtype(): string;

    /**
     * Check if this feature is supported by the device.
     */
    abstract isSupported(): boolean;

    /**
     * Get the current state of the feature.
     */
    abstract handleGet(): Promise<CharacteristicValue>;

    /**
     * Set the state of the feature.
     */
    abstract handleSet(value: CharacteristicValue): Promise<void>;

    /**
     * Set up the feature. Creates or removes the switch service based on support and config.
     */
    setup(): void {
        const showExtraFeatures = this.platform.config.showExtraFeatures;

        if (this.isSupported() && showExtraFeatures) {
            this.log.debug(`[${this.name}] Device has ${this.featureName}, add Switch Service`);
            this.createOrUpdateSwitchService();
        } else {
            this.removeServiceIfExists();
        }
    }

    /**
     * Create or update the switch service for this feature.
     */
    protected createOrUpdateSwitchService(): void {
        // Get existing service or create new one
        this.switchService = this.accessory.getService(this.featureName) ||
            this.accessory.addService(
                this.platform.Service.Switch,
                this.featureName,
                this.serviceSubtype,
            );

        // Set the name
        this.switchService.setCharacteristic(
            this.platform.Characteristic.Name,
            this.featureName,
        );

        // Add and set configured name
        this.switchService.addOptionalCharacteristic(
            this.platform.Characteristic.ConfiguredName,
        );
        this.switchService.setCharacteristic(
            this.platform.Characteristic.ConfiguredName,
            this.featureName,
        );

        // Set up handlers
        this.switchService
            .getCharacteristic(this.platform.Characteristic.On)
            .onGet(this.handleGet.bind(this))
            .onSet(this.handleSet.bind(this));
    }

    /**
     * Remove the switch service if it exists.
     */
    protected removeServiceIfExists(): void {
        const existingService = this.accessory.getService(this.featureName);
        if (existingService) {
            this.accessory.removeService(existingService);
            this.switchService = undefined;
        }
    }

    /**
     * Get device data from the Daikin Cloud.
     */
    protected getData(dataPoint: string, path?: string): unknown {
        return this.accessory.context.device.getData(this.managementPointId, dataPoint, path);
    }

    /**
     * Set device data on the Daikin Cloud.
     * Note: device.setData has different parameter order depending on whether path is used:
     * - No path: setData(managementPointId, dataPoint, value, undefined)
     * - With path: setData(managementPointId, dataPoint, path, value)
     */
    protected async setData(dataPoint: string, value: unknown, path?: string): Promise<void> {
        try {
            if (path) {
                await this.accessory.context.device.setData(this.managementPointId, dataPoint, path, value);
            } else {
                await this.accessory.context.device.setData(this.managementPointId, dataPoint, value, undefined);
            }
            this.platform.forceUpdateDevices();
        } catch (e) {
            this.log.error(
                `[${this.name}] Failed to set ${dataPoint}:`,
                e,
                JSON.stringify(DaikinCloudRepo.maskSensitiveCloudDeviceData(this.accessory.context.device.desc), null, 4),
            );
            throw e;
        }
    }
}
