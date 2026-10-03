/**
 * Base Feature
 *
 * Abstract base class for all feature modules.
 * Each feature represents an optional capability like PowerfulMode, EconoMode, etc.
 */

import type { CharacteristicValue, PlatformAccessory, Service, Logger } from 'homebridge';
import type { DaikinCloudAccessoryContext, DaikinCloudPlatform } from '../platform';
import type { DaikinCloudDevice, DeviceDataPoint } from '../api';
import type { DeviceCapabilities } from '../types';
import type { FeatureConfigKey } from '../config/config-manager';
import { DeviceCapabilityDetector } from '../device/capability-detector';
import { withHapWrite } from '../utils/hap-write';
import { toMessage } from '../utils/errors';

/** Management point types that host feature switches, in legacy-ownership order. */
const FEATURE_HOST_TYPES = ['climateControl', 'domesticHotWaterTank'];

/**
 * Abstract base class for feature modules.
 * Features are optional capabilities that can be enabled/disabled via switches.
 *
 * Switch services are identified by (Service.Switch, subtype), never by display
 * name, and the subtype is namespaced per management point
 * (`<managementPointId>:<serviceSubtype>`), so features of different management
 * points (e.g. the Altherma climateControl and domesticHotWaterTank, which both
 * know a "Powerful mode") can never find or remove each other's switches.
 *
 * Backwards compatibility: accessories cached before namespacing carry switches
 * with the bare `serviceSubtype`. HomeKit identifies a service by its type and
 * subtype, so renaming the subtype would show up as a brand-new switch and break
 * existing automations/scenes. Instead the legacy switch is adopted as-is by the
 * single management point that owns it (see ownsLegacyService), and only new
 * switches get the namespaced subtype.
 */
export abstract class BaseFeature {
  protected readonly platform: DaikinCloudPlatform;
  protected readonly accessory: PlatformAccessory<DaikinCloudAccessoryContext>;
  protected readonly managementPointId: string;
  protected readonly log: Logger;
  protected readonly name: string;

  protected switchService?: Service;
  private detectedCapabilities?: DeviceCapabilities;

  constructor(
    platform: DaikinCloudPlatform,
    accessory: PlatformAccessory<DaikinCloudAccessoryContext>,
    managementPointId: string,
    capabilities?: DeviceCapabilities,
  ) {
    this.platform = platform;
    this.accessory = accessory;
    this.managementPointId = managementPointId;
    this.log = platform.log;
    this.name = accessory.displayName;
    this.detectedCapabilities = capabilities;
  }

  /**
   * The display name for this feature (used for the switch service).
   */
  abstract get featureName(): string;

  /**
   * The (un-namespaced) identifier for this feature's switch service.
   */
  abstract get serviceSubtype(): string;

  /**
   * The config key for this feature (e.g., 'showPowerfulMode'), one of
   * FEATURE_CONFIG_KEYS. Used to enable/disable individual features.
   */
  abstract get configKey(): FeatureConfigKey;

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

  /** Subtype of switches created by this feature: namespaced per management point. */
  get namespacedSubtype(): string {
    return `${this.managementPointId}:${this.serviceSubtype}`;
  }

  /**
   * Capabilities detected once for this management point (passed in by the
   * FeatureManager; detected lazily when the feature is constructed on its own).
   */
  protected get capabilities(): DeviceCapabilities {
    if (!this.detectedCapabilities) {
      this.detectedCapabilities = new DeviceCapabilityDetector(this.device, this.managementPointId).getCapabilities();
    }
    return this.detectedCapabilities;
  }

  protected get device(): DaikinCloudDevice {
    return this.accessory.context.device;
  }

  /**
   * Check if this feature is enabled in config: the per-feature toggle, with the
   * legacy `showExtraFeatures` fallback for extra features (see ConfigManager).
   */
  protected isEnabledInConfig(): boolean {
    return this.platform.configManager.isFeatureEnabled(this.configKey);
  }

  /**
   * Set up the feature. Creates or removes the switch service based on support and config.
   */
  setup(): void {
    if (this.isSupported() && this.isEnabledInConfig()) {
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
    const { Characteristic } = this.platform;
    this.switchService = this.findExistingServices()[0] ||
      this.accessory.addService(this.platform.Service.Switch, this.featureName, this.namespacedSubtype);

    this.switchService.setCharacteristic(Characteristic.Name, this.featureName);
    this.switchService.addOptionalCharacteristic(Characteristic.ConfiguredName);
    this.switchService.setCharacteristic(Characteristic.ConfiguredName, this.featureName);

    this.switchService
      .getCharacteristic(Characteristic.On)
      .onGet(this.handleGet.bind(this))
      .onSet(this.handleSet.bind(this));
  }

  /**
   * Remove this feature's switch service(s) if they exist.
   */
  protected removeServiceIfExists(): void {
    for (const service of this.findExistingServices()) {
      this.accessory.removeService(service);
    }
    this.switchService = undefined;
  }

  /** This feature's switches on the accessory: the namespaced one first, then an owned legacy one. */
  private findExistingServices(): Service[] {
    const { Switch } = this.platform.Service;
    const services = [this.accessory.getServiceById(Switch, this.namespacedSubtype)];
    if (this.ownsLegacyService()) {
      services.push(this.accessory.getServiceById(Switch, this.serviceSubtype));
    }
    return services.filter((service): service is Service => service !== undefined);
  }

  /**
   * Data point that decides which management point owns the legacy
   * (un-namespaced) switch. Undefined ⇒ climateControl owns it, as every legacy
   * feature switch was created for climateControl — except the Altherma
   * "Powerful mode", which lives on the domesticHotWaterTank.
   */
  protected get legacyOwnershipDataPoint(): string | undefined {
    return undefined;
  }

  /**
   * Whether the legacy un-namespaced switch belongs to this management point.
   * Owner: the first feature-hosting management point (climateControl before
   * domesticHotWaterTank) that supports legacyOwnershipDataPoint; otherwise the
   * climateControl management point. Exactly one management point owns it, so
   * features of different management points never adopt or remove the same switch.
   */
  protected ownsLegacyService(): boolean {
    const hosts = FEATURE_HOST_TYPES.flatMap(type =>
      (this.device.desc?.managementPoints ?? []).filter(mp => mp.managementPointType === type),
    );
    const dataPoint = this.legacyOwnershipDataPoint;
    const owner = (dataPoint && hosts.find(mp => this.device.getData(mp.embeddedId, dataPoint, undefined).value !== undefined))
      || hosts[0];
    return (owner?.embeddedId ?? this.managementPointId) === this.managementPointId;
  }

  /**
   * Push current device state to the switch's On characteristic.
   * Called after every poll / WebSocket update so HomeKit reflects state
   * changes initiated from the Daikin app without waiting for the next onGet.
   * No-op if the switch service isn't registered (feature unsupported/disabled).
   */
  refresh(): void {
    if (!this.switchService) {
      return;
    }
    void Promise.resolve(this.handleGet()).then(
      (value) => {
        this.switchService?.getCharacteristic(this.platform.Characteristic.On).updateValue(value);
      },
      // handleGet is just a getData read in practice — but guard against custom
      // implementations throwing so one bad feature can't break the refresh loop.
      (err) => this.log.debug(`[${this.name}] ${this.featureName} refresh failed: ${toMessage(err)}`),
    );
  }

  /**
   * Get device data from the Daikin Cloud.
   */
  protected getData(dataPoint: string, path?: string): DeviceDataPoint {
    return this.device.getData(this.managementPointId, dataPoint, path);
  }

  /**
   * Set device data on the Daikin Cloud.
   * Note: device.setData has different parameter order depending on whether path is used:
   * - No path: setData(managementPointId, dataPoint, value, undefined)
   * - With path: setData(managementPointId, dataPoint, path, value)
   */
  protected async setData(dataPoint: string, value: unknown, path?: string): Promise<void> {
    await this.write(dataPoint, () => path
      ? this.device.setData(this.managementPointId, dataPoint, path, value)
      : this.device.setData(this.managementPointId, dataPoint, value, undefined));
  }

  /** Run a device write with HAP error handling (see withHapWrite). */
  protected write<T>(what: string, op: () => Promise<T>, refresh = true): Promise<T> {
    return withHapWrite(this.platform, `[${this.name}] ${what}`, op, { refresh });
  }
}
