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

export class HolidayModeFeature extends BaseFeature {
  get featureName(): string {
    return 'Holiday mode';
  }

  get serviceSubtype(): string {
    return 'holiday_mode';
  }

  get configKey(): string {
    return 'showHolidayMode';
  }

  isSupported(): boolean {
    // device.getData() returns { value: undefined } when the characteristic is
    // missing, so check the inner enabled flag to detect real support.
    const holidayMode = this.getData('holidayMode') as { value?: { enabled?: unknown } } | undefined;
    const supported = holidayMode?.value?.enabled !== undefined;
    this.log.debug(`[${this.name}] hasHolidayModeFeature: ${supported}`);
    return supported;
  }

  async handleGet(): Promise<CharacteristicValue> {
    const data = this.getData('holidayMode') as { value?: { enabled?: boolean } } | undefined;
    const isOn = data?.value?.enabled === true;
    this.log.debug(
      `[${this.name}] GET HolidayMode: ${isOn}, ` +
            `last update: ${this.accessory.context.device.getLastUpdated()}`,
    );
    return isOn;
  }

  async handleSet(value: CharacteristicValue): Promise<void> {
    this.log.debug(`[${this.name}] SET HolidayMode to: ${value}`);
    try {
      await this.accessory.context.device.setHolidayMode(this.managementPointId, Boolean(value));
      this.platform.forceUpdateDevices();
    } catch (e) {
      this.log.warn(`[${this.name}] Failed to set holidayMode: ${e instanceof Error ? e.message : e}`);
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }
}
