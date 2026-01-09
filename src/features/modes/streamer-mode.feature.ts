/**
 * Streamer Mode Feature
 *
 * Enables/disables the streamer mode on the device.
 */

import {CharacteristicValue} from 'homebridge';
import {BaseFeature} from '../base-feature';
import {DaikinStreamerModes} from '../../types';

export class StreamerModeFeature extends BaseFeature {
    get featureName(): string {
        return 'Streamer mode';
    }

    get serviceSubtype(): string {
        return 'streamer_mode';
    }

    get configKey(): string {
        return 'showStreamerMode';
    }

    isSupported(): boolean {
        const streamerMode = this.getData('streamerMode');
        this.log.debug(`[${this.name}] hasStreamerModeFeature: ${Boolean(streamerMode)}`);
        return Boolean(streamerMode);
    }

    async handleGet(): Promise<CharacteristicValue> {
        const data = this.getData('streamerMode') as { value: string } | undefined;
        const isOn = data?.value === DaikinStreamerModes.ON;
        this.log.debug(
            `[${this.name}] GET StreamerMode: ${isOn}, ` +
            `last update: ${this.accessory.context.device.getLastUpdated()}`,
        );
        return isOn;
    }

    async handleSet(value: CharacteristicValue): Promise<void> {
        this.log.debug(`[${this.name}] SET StreamerMode to: ${value}`);
        const mode = value ? DaikinStreamerModes.ON : DaikinStreamerModes.OFF;
        await this.setData('streamerMode', mode);
    }
}
