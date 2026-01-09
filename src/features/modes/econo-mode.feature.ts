/**
 * Econo Mode Feature
 *
 * Enables/disables the economy mode on the device.
 */

import {CharacteristicValue} from 'homebridge';
import {BaseFeature} from '../base-feature';
import {DaikinEconoModes} from '../../types';

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
        const econoMode = this.getData('econoMode');
        this.log.debug(`[${this.name}] hasEconoModeFeature: ${Boolean(econoMode)}`);
        return Boolean(econoMode);
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
