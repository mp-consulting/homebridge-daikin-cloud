/**
 * Oscillation Mode Feature
 *
 * Exposes the fan oscillation (swing) as its own HomeKit switch.
 *
 * The HeaterCooler already carries a SwingMode characteristic, but HomeKit hides
 * it when the accessory is grouped into a single tile in the Home app. A standalone
 * switch keeps oscillation toggleable from the grouped view:
 *   - ON  -> fanDirection vertical/horizontal currentMode = 'swing'
 *   - OFF -> fanDirection vertical/horizontal currentMode = 'stop'
 *
 * Mirrors the same paths the HeaterCooler's SwingMode handlers use, so toggling
 * either one keeps both in sync on the next refresh.
 */

import type { CharacteristicValue } from 'homebridge';
import { BaseFeature } from '../base-feature';
import {
  DaikinFanDirectionHorizontalModes,
  DaikinFanDirectionVerticalModes,
  DaikinOperationModes,
} from '../../types';

export class OscillationModeFeature extends BaseFeature {
  get featureName(): string {
    return 'Oscillation';
  }

  get serviceSubtype(): string {
    return 'oscillation';
  }

  get configKey(): string {
    return 'showOscillationSwitch';
  }

  isSupported(): boolean {
    const supported = this.hasVerticalSwing() || this.hasHorizontalSwing();
    this.log.debug(`[${this.name}] hasOscillationFeature: ${supported}`);
    return supported;
  }

  async handleGet(): Promise<CharacteristicValue> {
    const operationMode = this.getCurrentOperationMode();
    const vertical = this.hasVerticalSwing()
      ? (this.getData('fanControl', `/operationModes/${operationMode}/fanDirection/vertical/currentMode`) as { value: string }).value
      : null;
    const horizontal = this.hasHorizontalSwing()
      ? (this.getData('fanControl', `/operationModes/${operationMode}/fanDirection/horizontal/currentMode`) as { value: string }).value
      : null;

    // Off only when an axis that exists is stopped — matches the HeaterCooler SwingMode logic.
    const isOn = horizontal !== DaikinFanDirectionHorizontalModes.STOP
      && vertical !== DaikinFanDirectionVerticalModes.STOP;
    this.log.debug(
      `[${this.name}] GET Oscillation: ${isOn} (vertical: ${vertical}, horizontal: ${horizontal}), ` +
            `last update: ${this.accessory.context.device.getLastUpdated()}`,
    );
    return isOn;
  }

  async handleSet(value: CharacteristicValue): Promise<void> {
    this.log.debug(`[${this.name}] SET Oscillation to: ${value}`);
    const operationMode = this.getCurrentOperationMode();
    const mode = value ? DaikinFanDirectionHorizontalModes.SWING : DaikinFanDirectionHorizontalModes.STOP;

    if (this.hasHorizontalSwing()) {
      await this.setData('fanControl', mode, `/operationModes/${operationMode}/fanDirection/horizontal/currentMode`);
    }
    if (this.hasVerticalSwing()) {
      await this.setData('fanControl', mode, `/operationModes/${operationMode}/fanDirection/vertical/currentMode`);
    }
  }

  private hasVerticalSwing(): boolean {
    const data = this.getData(
      'fanControl',
      `/operationModes/${this.getCurrentOperationMode()}/fanDirection/vertical/currentMode`,
    ) as { value?: string } | undefined;
    return data?.value !== undefined;
  }

  private hasHorizontalSwing(): boolean {
    const data = this.getData(
      'fanControl',
      `/operationModes/${this.getCurrentOperationMode()}/fanDirection/horizontal/currentMode`,
    ) as { value?: string } | undefined;
    return data?.value !== undefined;
  }

  private getCurrentOperationMode(): DaikinOperationModes {
    const data = this.getData('operationMode') as { value: DaikinOperationModes } | undefined;
    return data?.value || DaikinOperationModes.AUTO;
  }
}
