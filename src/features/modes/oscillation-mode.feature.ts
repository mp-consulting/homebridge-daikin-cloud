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
 * Uses the same SwingController as the HeaterCooler's SwingMode handlers, so
 * toggling either one keeps both in sync on the next refresh.
 */

import type { CharacteristicValue } from 'homebridge';
import { BaseFeature } from '../base-feature';
import type { FeatureConfigKey } from '../../config/config-manager';
import { SwingController } from '../../services/climate-control/swing-controller';

export class OscillationModeFeature extends BaseFeature {
  private readonly swing = new SwingController(() => this.device, this.managementPointId);

  get featureName(): string {
    return 'Oscillation';
  }

  get serviceSubtype(): string {
    return 'oscillation';
  }

  get configKey(): FeatureConfigKey {
    return 'showOscillationSwitch';
  }

  isSupported(): boolean {
    const supported = this.capabilities.hasSwingModeVertical || this.capabilities.hasSwingModeHorizontal;
    this.log.debug(`[${this.name}] hasOscillationFeature: ${supported}`);
    return supported;
  }

  async handleGet(): Promise<CharacteristicValue> {
    const isOn = this.swing.isSwinging();
    this.log.debug(
      `[${this.name}] GET Oscillation: ${isOn} (${this.swing.describe()}), ` +
            `last update: ${this.device.getLastUpdated()}`,
    );
    return isOn;
  }

  async handleSet(value: CharacteristicValue): Promise<void> {
    const enabled = Boolean(value);
    if (this.swing.axesToWrite(enabled).length === 0) {
      this.log.debug(`[${this.name}] SET Oscillation skipped — already ${enabled ? 'on' : 'off'}`);
      return;
    }
    this.log.debug(`[${this.name}] SET Oscillation to: ${value}`);
    await this.write('Oscillation', () => this.swing.set(enabled));
  }
}
