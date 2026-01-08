/**
 * Outdoor Silent Mode Feature
 *
 * Enables/disables the outdoor silent mode on the device.
 */

import {CharacteristicValue} from 'homebridge';
import {BaseFeature} from './base-feature';
import {DaikinOutdoorSilentModes} from '../types';

export class OutdoorSilentModeFeature extends BaseFeature {
    get featureName(): string {
        return 'Outdoor silent mode';
    }

    get serviceSubtype(): string {
        return 'outdoor_silent_mode';
    }

    isSupported(): boolean {
        const outdoorSilentMode = this.getData('outdoorSilentMode');
        this.log.debug(`[${this.name}] hasOutdoorSilentModeFeature: ${Boolean(outdoorSilentMode)}`);
        return Boolean(outdoorSilentMode);
    }

    async handleGet(): Promise<CharacteristicValue> {
        const data = this.getData('outdoorSilentMode') as { value: string } | undefined;
        const isOn = data?.value === DaikinOutdoorSilentModes.ON;
        this.log.debug(
            `[${this.name}] GET OutdoorSilentMode: ${isOn}, ` +
            `last update: ${this.accessory.context.device.getLastUpdated()}`,
        );
        return isOn;
    }

    async handleSet(value: CharacteristicValue): Promise<void> {
        this.log.debug(`[${this.name}] SET OutdoorSilentMode to: ${value}`);
        const mode = value ? DaikinOutdoorSilentModes.ON : DaikinOutdoorSilentModes.OFF;
        await this.setData('outdoorSilentMode', mode);
    }
}
