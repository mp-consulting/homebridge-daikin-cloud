/**
 * Auto Fan Mode Feature
 *
 * Enables/disables the automatic fan speed mode on the device.
 *
 * HomeKit's HeaterCooler RotationSpeed is a single 0-100% slider with no native
 * concept of an "Auto" fan mode, so we expose Auto as its own switch:
 *   - ON  -> fanSpeed/currentMode = 'auto'
 *   - OFF -> fanSpeed/currentMode = 'fixed' (back to manual speed control)
 *
 * Moving the RotationSpeed slider switches currentMode back to 'fixed'
 * (see ClimateControlService.handleRotationSpeedSet), which turns this switch off
 * on the next refresh. Mutually exclusive with the Indoor silent (quiet) switch:
 * turning one on flips currentMode, so the other reconciles to off on refresh.
 */

import type { CharacteristicValue } from 'homebridge';
import { BaseFeature } from '../base-feature';
import { DaikinFanSpeedModes, DaikinOperationModes } from '../../types';

export class AutoFanModeFeature extends BaseFeature {
  get featureName(): string {
    return 'Auto fan mode';
  }

  get serviceSubtype(): string {
    return 'auto_fan_mode';
  }

  get configKey(): string {
    return 'showAutoFanMode';
  }

  isSupported(): boolean {
    const currentModeFanControl = this.getData(
      'fanControl',
      `/operationModes/${this.getCurrentOperationMode()}/fanSpeed/currentMode`,
    ) as { values?: string[] } | undefined;

    if (!currentModeFanControl) {
      return false;
    }

    const fanSpeedValues = currentModeFanControl.values || [];
    // Only meaningful when the device can toggle between 'auto' and a manual
    // ('fixed') speed — otherwise the switch would have nothing to turn off to.
    const hasAutoMode =
      fanSpeedValues.includes(DaikinFanSpeedModes.AUTO) &&
      fanSpeedValues.includes(DaikinFanSpeedModes.FIXED);
    this.log.debug(`[${this.name}] hasAutoFanModeFeature: ${hasAutoMode}`);
    return hasAutoMode;
  }

  async handleGet(): Promise<CharacteristicValue> {
    const data = this.getData(
      'fanControl',
      `/operationModes/${this.getCurrentOperationMode()}/fanSpeed/currentMode`,
    ) as { value: string } | undefined;

    const isOn = data?.value === DaikinFanSpeedModes.AUTO;
    this.log.debug(
      `[${this.name}] GET AutoFanMode: ${isOn}, ` +
            `last update: ${this.accessory.context.device.getLastUpdated()}`,
    );
    return isOn;
  }

  async handleSet(value: CharacteristicValue): Promise<void> {
    this.log.debug(`[${this.name}] SET AutoFanMode to: ${value}`);
    const mode = value ? DaikinFanSpeedModes.AUTO : DaikinFanSpeedModes.FIXED;
    await this.setData(
      'fanControl',
      mode,
      `/operationModes/${this.getCurrentOperationMode()}/fanSpeed/currentMode`,
    );
  }

  private getCurrentOperationMode(): DaikinOperationModes {
    const data = this.getData('operationMode') as { value: DaikinOperationModes } | undefined;
    return data?.value || DaikinOperationModes.AUTO;
  }
}
