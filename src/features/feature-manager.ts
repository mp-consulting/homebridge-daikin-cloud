/**
 * Feature Manager
 *
 * Orchestrates the setup of all feature modules for an accessory.
 * Manages feature lifecycle and provides access to features.
 */

import type { PlatformAccessory } from 'homebridge';
import type { DaikinCloudAccessoryContext, DaikinCloudPlatform } from '../platform';
import type { BaseFeature } from './base-feature';

// Import all features
import {
  PowerfulModeFeature,
  EconoModeFeature,
  StreamerModeFeature,
  OutdoorSilentModeFeature,
  IndoorSilentModeFeature,
  AutoFanModeFeature,
  DryOperationModeFeature,
  FanOnlyOperationModeFeature,
} from './modes';

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
  AutoFanModeFeature,
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
     * Push current device state to every feature switch's On characteristic.
     * Called from ClimateControlService.refreshValues after a poll/WebSocket
     * update so HomeKit reflects mode changes initiated from the Daikin app.
     */
  refreshAll(): void {
    for (const feature of this.features) {
      feature.refresh();
    }
  }

  /**
     * Get a specific feature by class type.
     */
  getFeature<T extends BaseFeature>(
    featureClass: abstract new (...args: never[]) => T,
  ): T | undefined {
    return this.features.find(f => f instanceof featureClass) as T | undefined;
  }
}
