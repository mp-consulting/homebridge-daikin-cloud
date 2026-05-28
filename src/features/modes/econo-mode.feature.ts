/**
 * Econo Mode Feature
 *
 * Enables/disables the economy mode on the device.
 */

import type { CharacteristicValue } from 'homebridge';
import { BaseFeature } from '../base-feature';
import { DaikinEconoModes } from '../../types';

export class EconoModeFeature extends BaseFeature {
  get featureName(): string {
    return 'Econo mode';
  }

  get serviceSubtype(): string {
    return 'econo_mode';
  }

  get configKey(): string {
    return 'showEconoMode';
  }

  isSupported(): boolean {
    // device.getData() returns { value: undefined } when the characteristic is missing,
    // so Boolean(data) is always true. Check the inner value to detect real support.
    const econoMode = this.getData('econoMode') as { value?: unknown } | undefined;
    const supported = econoMode?.value !== undefined;
    this.log.debug(`[${this.name}] hasEconoModeFeature: ${supported}`);
    return supported;
  }

  async handleGet(): Promise<CharacteristicValue> {
    const data = this.getData('econoMode') as { value: string } | undefined;
    const isOn = data?.value === DaikinEconoModes.ON;
    this.log.debug(
      `[${this.name}] GET EconoMode: ${isOn}, ` +
            `last update: ${this.accessory.context.device.getLastUpdated()}`,
    );
    return isOn;
  }

  async handleSet(value: CharacteristicValue): Promise<void> {
    this.log.debug(`[${this.name}] SET EconoMode to: ${value}`);
    const mode = value ? DaikinEconoModes.ON : DaikinEconoModes.OFF;
    await this.setData('econoMode', mode);
  }
}
