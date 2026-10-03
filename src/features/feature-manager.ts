/**
 * Feature Manager
 *
 * Orchestrates the setup of the feature modules of one management point.
 * Manages feature lifecycle and provides access to features.
 */

import type { PlatformAccessory } from 'homebridge';
import type { DaikinCloudAccessoryContext, DaikinCloudPlatform } from '../platform';
import type { BaseFeature } from './base-feature';
import type { DeviceCapabilities } from '../types';
import { DeviceCapabilityDetector } from '../device/capability-detector';

// Import all features
import {
  PowerfulModeFeature,
  EconoModeFeature,
  StreamerModeFeature,
  OutdoorSilentModeFeature,
  IndoorSilentModeFeature,
  AutoFanModeFeature,
  OscillationModeFeature,
  DryOperationModeFeature,
  FanOnlyOperationModeFeature,
  HolidayModeFeature,
  FirmwareUpdateFeature,
} from './modes';

/**
 * Feature constructor type
 */
export type FeatureConstructor = new (
  platform: DaikinCloudPlatform,
  accessory: PlatformAccessory<DaikinCloudAccessoryContext>,
  managementPointId: string,
  capabilities?: DeviceCapabilities,
) => BaseFeature;

/**
 * Features of a climateControl management point
 */
export const CLIMATE_CONTROL_FEATURES: readonly FeatureConstructor[] = [
  PowerfulModeFeature,
  EconoModeFeature,
  StreamerModeFeature,
  OutdoorSilentModeFeature,
  IndoorSilentModeFeature,
  AutoFanModeFeature,
  OscillationModeFeature,
  DryOperationModeFeature,
  FanOnlyOperationModeFeature,
  HolidayModeFeature,
  FirmwareUpdateFeature,
];

/**
 * Features of an Altherma domesticHotWaterTank management point
 */
export const HOT_WATER_TANK_FEATURES: readonly FeatureConstructor[] = [
  PowerfulModeFeature,
];

/**
 * Manages all features for one management point of an accessory
 */
export class FeatureManager {
  /** Capabilities detected once for the management point; every feature's isSupported reads these. */
  readonly capabilities: DeviceCapabilities;
  private readonly features: BaseFeature[];

  constructor(
    platform: DaikinCloudPlatform,
    accessory: PlatformAccessory<DaikinCloudAccessoryContext>,
    managementPointId: string,
    featureClasses: readonly FeatureConstructor[] = CLIMATE_CONTROL_FEATURES,
  ) {
    this.capabilities = new DeviceCapabilityDetector(accessory.context.device, managementPointId).getCapabilities();
    this.features = featureClasses.map(
      FeatureClass => new FeatureClass(platform, accessory, managementPointId, this.capabilities),
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
   * Called from the services' refreshValues after a poll/WebSocket update so
   * HomeKit reflects mode changes initiated from the Daikin app.
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
