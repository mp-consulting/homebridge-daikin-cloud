/**
 * Feature Manager
 *
 * Orchestrates the setup of all feature modules for an accessory.
 * Manages feature lifecycle and provides access to features.
 */

import {PlatformAccessory} from 'homebridge';
import {DaikinCloudAccessoryContext, DaikinCloudPlatform} from '../platform';
import {BaseFeature} from './base-feature';

// Import all features
import {PowerfulModeFeature} from './powerful-mode-feature';
import {EconoModeFeature} from './econo-mode-feature';
import {StreamerModeFeature} from './streamer-mode-feature';
import {OutdoorSilentModeFeature} from './outdoor-silent-mode-feature';
import {IndoorSilentModeFeature} from './indoor-silent-mode-feature';
import {DryOperationModeFeature} from './dry-operation-mode-feature';
import {FanOnlyOperationModeFeature} from './fan-only-operation-mode-feature';

/**
 * Feature constructor type
 */
type FeatureConstructor = new (
    platform: DaikinCloudPlatform,
    accessory: PlatformAccessory<DaikinCloudAccessoryContext>,
    managementPointId: string,
) => BaseFeature;

/**
 * List of all available feature classes
 */
const FEATURE_CLASSES: FeatureConstructor[] = [
    PowerfulModeFeature,
    EconoModeFeature,
    StreamerModeFeature,
    OutdoorSilentModeFeature,
    IndoorSilentModeFeature,
    DryOperationModeFeature,
    FanOnlyOperationModeFeature,
];

/**
 * Manages all features for an accessory
 */
export class FeatureManager {
    private readonly platform: DaikinCloudPlatform;
    private readonly accessory: PlatformAccessory<DaikinCloudAccessoryContext>;
    private readonly managementPointId: string;
    private readonly features: BaseFeature[] = [];

    constructor(
        platform: DaikinCloudPlatform,
        accessory: PlatformAccessory<DaikinCloudAccessoryContext>,
        managementPointId: string,
    ) {
        this.platform = platform;
        this.accessory = accessory;
        this.managementPointId = managementPointId;

        // Create all feature instances
        this.features = FEATURE_CLASSES.map(
            FeatureClass => new FeatureClass(platform, accessory, managementPointId),
        );
    }

    /**
     * Set up all features. Each feature will create or remove its switch service
     * based on device support and configuration.
     */
    setupFeatures(): void {
        for (const feature of this.features) {
            feature.setup();
        }
    }

    /**
     * Get a specific feature by class type.
     */
    getFeature<T extends BaseFeature>(
        featureClass: new (...args: unknown[]) => T,
    ): T | undefined {
        return this.features.find(f => f instanceof featureClass) as T | undefined;
    }

    /**
     * Get all supported features.
     */
    getSupportedFeatures(): BaseFeature[] {
        return this.features.filter(f => f.isSupported());
    }

    /**
     * Get all features.
     */
    getAllFeatures(): BaseFeature[] {
        return [...this.features];
    }
}
