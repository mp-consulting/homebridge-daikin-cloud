/**
 * Dry Operation Mode Feature
 *
 * Enables/disables the dry operation mode on the device.
 * When disabled, switches back to auto mode.
 */

import type { CharacteristicValue } from 'homebridge';
import { BaseFeature } from '../base-feature';
import { DaikinOperationModes } from '../../types';

export class DryOperationModeFeature extends BaseFeature {
  get featureName(): string {
    return 'Dry operation mode';
  }

  get serviceSubtype(): string {
    return 'dry_operation_mode';
  }

  get configKey(): string {
    return 'showDryMode';
  }

  isSupported(): boolean {
    const operationModeData = this.getData('operationMode') as { values?: string[] } | undefined;
    const operationModeValues = operationModeData?.values || [];
    const hasDryMode = operationModeValues.includes(DaikinOperationModes.DRY);
    this.log.debug(`[${this.name}] hasDryOperationModeFeature: ${hasDryMode}`);
    return hasDryMode;
  }

  async handleGet(): Promise<CharacteristicValue> {
    const data = this.getData('operationMode') as { value: string } | undefined;
    const isOn = data?.value === DaikinOperationModes.DRY;
    this.log.debug(
      `[${this.name}] GET DryOperationMode: ${isOn}, ` +
            `last update: ${this.accessory.context.device.getLastUpdated()}`,
    );
    return isOn;
  }

  async handleSet(value: CharacteristicValue): Promise<void> {
    this.log.debug(`[${this.name}] SET DryOperationMode to: ${value}`);
    const mode = value ? DaikinOperationModes.DRY : DaikinOperationModes.AUTO;
    await this.setData('operationMode', mode);
  }
}
