/**
 * Indoor Silent Mode Feature
 *
 * Enables/disables the indoor silent (quiet) mode on the device.
 * This sets the fan speed to quiet mode.
 */

import {CharacteristicValue} from 'homebridge';
import {BaseFeature} from './base-feature';
import {DaikinFanSpeedModes, DaikinOperationModes} from '../types';

export class IndoorSilentModeFeature extends BaseFeature {
    get featureName(): string {
        return 'Indoor silent mode';
    }

    get serviceSubtype(): string {
        return 'indoor_silent_mode';
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
        const hasQuietMode = fanSpeedValues.includes(DaikinFanSpeedModes.QUIET);
        this.log.debug(`[${this.name}] hasIndoorSilentModeFeature: ${hasQuietMode}`);
        return hasQuietMode;
    }

    async handleGet(): Promise<CharacteristicValue> {
        const data = this.getData(
            'fanControl',
            `/operationModes/${this.getCurrentOperationMode()}/fanSpeed/currentMode`,
        ) as { value: string } | undefined;

        const isOn = data?.value === DaikinFanSpeedModes.QUIET;
        this.log.debug(
            `[${this.name}] GET IndoorSilentMode: ${isOn}, ` +
            `last update: ${this.accessory.context.device.getLastUpdated()}`,
        );
        return isOn;
    }

    async handleSet(value: CharacteristicValue): Promise<void> {
        this.log.debug(`[${this.name}] SET IndoorSilentMode to: ${value}`);
        const mode = value ? DaikinFanSpeedModes.QUIET : DaikinFanSpeedModes.FIXED;
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
