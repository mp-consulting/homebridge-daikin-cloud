/**
 * Powerful Mode Feature
 *
 * Enables/disables the powerful mode on the device.
 */

import {CharacteristicValue} from 'homebridge';
import {BaseFeature} from '../base-feature';
import {DaikinPowerfulModes} from '../../types';

export class PowerfulModeFeature extends BaseFeature {
    get featureName(): string {
        return 'Powerful mode';
    }

    get serviceSubtype(): string {
        return 'powerful_mode';
    }

    isSupported(): boolean {
        const powerfulMode = this.getData('powerfulMode');
        this.log.debug(`[${this.name}] hasPowerfulModeFeature: ${Boolean(powerfulMode)}`);
        return Boolean(powerfulMode);
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
