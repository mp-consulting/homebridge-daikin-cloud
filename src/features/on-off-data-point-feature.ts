/**
 * On/Off Data Point Feature
 *
 * Base for features that are a plain switch over one Daikin data point:
 * ON writes `onValue`, OFF writes `offValue`, and the switch reads ON when the
 * data point equals `onValue`. Concrete features only declare a spec.
 */

import type { CharacteristicValue } from 'homebridge';
import { BaseFeature } from './base-feature';
import type { DeviceCapabilities } from '../types';
import type { ExtraFeatureConfigKey } from '../config/config-manager';
import { DaikinOperationModes } from '../types';

type BooleanCapability = {
  [K in keyof DeviceCapabilities]: DeviceCapabilities[K] extends boolean ? K : never;
}[keyof DeviceCapabilities];

export interface OnOffDataPointSpec {
  /** Switch display name. */
  name: string;
  /** Un-namespaced switch subtype. */
  subtype: string;
  /** Per-feature config toggle, e.g. 'showPowerfulMode'. */
  configKey: ExtraFeatureConfigKey;
  /** Data point name, e.g. 'powerfulMode'. */
  dataPoint: string;
  /** Optional path inside the data point, built from the current operation mode. */
  path?: (operationMode: string) => string;
  onValue: string;
  offValue: string;
  /** Detected capability that decides isSupported(). */
  capability: BooleanCapability;
}

export abstract class OnOffDataPointFeature extends BaseFeature {
  protected abstract readonly spec: OnOffDataPointSpec;

  get featureName(): string {
    return this.spec.name;
  }

  get serviceSubtype(): string {
    return this.spec.subtype;
  }

  get configKey(): ExtraFeatureConfigKey {
    return this.spec.configKey;
  }

  protected get legacyOwnershipDataPoint(): string | undefined {
    return this.spec.dataPoint;
  }

  isSupported(): boolean {
    const supported = this.capabilities[this.spec.capability];
    this.log.debug(`[${this.name}] ${this.spec.capability}: ${supported}`);
    return supported;
  }

  async handleGet(): Promise<CharacteristicValue> {
    const isOn = this.getData(this.spec.dataPoint, this.currentPath()).value === this.spec.onValue;
    this.log.debug(
      `[${this.name}] GET ${this.featureName}: ${isOn}, last update: ${this.device.getLastUpdated()}`,
    );
    return isOn;
  }

  async handleSet(value: CharacteristicValue): Promise<void> {
    this.log.debug(`[${this.name}] SET ${this.featureName} to: ${value}`);
    await this.setData(this.spec.dataPoint, value ? this.spec.onValue : this.spec.offValue, this.currentPath());
  }

  private currentPath(): string | undefined {
    if (!this.spec.path) {
      return undefined;
    }
    const operationMode = this.getData('operationMode').value;
    return this.spec.path(typeof operationMode === 'string' && operationMode ? operationMode : DaikinOperationModes.AUTO);
  }
}
