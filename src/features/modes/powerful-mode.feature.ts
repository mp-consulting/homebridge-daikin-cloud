/**
 * Powerful Mode Feature
 *
 * Enables/disables the powerful mode on the device.
 */

import type { CharacteristicValue } from 'homebridge';
import { BaseFeature } from '../base-feature';
import { DaikinPowerfulModes } from '../../types';

export class PowerfulModeFeature extends BaseFeature {
  get featureName(): string {
    return 'Powerful mode';
  }

  get serviceSubtype(): string {
    return 'powerful_mode';
  }

  get configKey(): string {
    return 'showPowerfulMode';
  }

  isSupported(): boolean {
    // device.getData() returns { value: undefined } when the characteristic is missing,
    // so Boolean(data) is always true. Check the inner value to detect real support.
    const powerfulMode = this.getData('powerfulMode') as { value?: unknown } | undefined;
    const supported = powerfulMode?.value !== undefined;
    this.log.debug(`[${this.name}] hasPowerfulModeFeature: ${supported}`);
    return supported;
  }

  async handleGet(): Promise<CharacteristicValue> {
    const data = this.getData('powerfulMode') as { value: string } | undefined;
    const isOn = data?.value === DaikinPowerfulModes.ON;
    this.log.debug(
      `[${this.name}] GET PowerfulMode: ${isOn}, ` +
            `last update: ${this.accessory.context.device.getLastUpdated()}`,
    );
    return isOn;
  }

  async handleSet(value: CharacteristicValue): Promise<void> {
    this.log.debug(`[${this.name}] SET PowerfulMode to: ${value}`);
    const mode = value ? DaikinPowerfulModes.ON : DaikinPowerfulModes.OFF;
    await this.setData('powerfulMode', mode);
  }
}
