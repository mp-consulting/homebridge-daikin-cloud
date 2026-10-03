/**
 * Holiday Mode Feature
 *
 * Enables/disables holiday (away) mode on the device. Unlike the other mode
 * switches, holiday mode is written through a dedicated endpoint rather than the
 * per-characteristic PATCH, so handleSet calls device.setHolidayMode directly
 * instead of the inherited setData helper.
 */

import type { CharacteristicValue } from 'homebridge';
import { BaseFeature } from '../base-feature';
import type { FeatureConfigKey } from '../../config/config-manager';

export class HolidayModeFeature extends BaseFeature {
  get featureName(): string {
    return 'Holiday mode';
  }

  get serviceSubtype(): string {
    return 'holiday_mode';
  }

  get configKey(): FeatureConfigKey {
    return 'showHolidayMode';
  }

  isSupported(): boolean {
    const supported = this.capabilities.hasHolidayMode;
    this.log.debug(`[${this.name}] hasHolidayModeFeature: ${supported}`);
    return supported;
  }

  async handleGet(): Promise<CharacteristicValue> {
    const value = this.getData('holidayMode').value as { enabled?: boolean } | undefined;
    const isOn = value?.enabled === true;
    this.log.debug(
      `[${this.name}] GET HolidayMode: ${isOn}, ` +
            `last update: ${this.device.getLastUpdated()}`,
    );
    return isOn;
  }

  async handleSet(value: CharacteristicValue): Promise<void> {
    this.log.debug(`[${this.name}] SET HolidayMode to: ${value}`);
    await this.write('holidayMode', () => this.device.setHolidayMode(this.managementPointId, Boolean(value)));
  }
}
