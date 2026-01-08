/**
 * Fan Only Operation Mode Feature
 *
 * Enables/disables the fan only operation mode on the device.
 * When disabled, switches back to auto mode.
 */

import {CharacteristicValue} from 'homebridge';
import {BaseFeature} from './base-feature';
import {DaikinOperationModes} from '../types';

export class FanOnlyOperationModeFeature extends BaseFeature {
    get featureName(): string {
        return 'Fan only operation mode';
    }

    get serviceSubtype(): string {
        return 'fan_only_operation_mode';
    }

    isSupported(): boolean {
        const operationModeData = this.getData('operationMode') as { values?: string[] } | undefined;
        const operationModeValues = operationModeData?.values || [];
        const hasFanOnlyMode = operationModeValues.includes(DaikinOperationModes.FAN_ONLY);
        this.log.debug(`[${this.name}] hasFanOnlyOperationModeFeature: ${hasFanOnlyMode}`);
        return hasFanOnlyMode;
    }

    async handleGet(): Promise<CharacteristicValue> {
        const data = this.getData('operationMode') as { value: string } | undefined;
        const isOn = data?.value === DaikinOperationModes.FAN_ONLY;
        this.log.debug(
            `[${this.name}] GET FanOnlyOperationMode: ${isOn}, ` +
            `last update: ${this.accessory.context.device.getLastUpdated()}`,
        );
        return isOn;
    }

    async handleSet(value: CharacteristicValue): Promise<void> {
        this.log.debug(`[${this.name}] SET FanOnlyOperationMode to: ${value}`);
        const mode = value ? DaikinOperationModes.FAN_ONLY : DaikinOperationModes.AUTO;
        await this.setData('operationMode', mode);
    }
}
