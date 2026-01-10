/**
 * Update Mapper
 *
 * Maps WebSocket device updates to HomeKit characteristic updates.
 * Extracts update mapping logic from the platform class.
 */

import {PlatformAccessory, Service, Characteristic, WithUUID} from 'homebridge';
import {DaikinCloudAccessoryContext} from '../platform';
import type {Logger} from 'homebridge';

export interface DeviceUpdate {
    deviceId: string;
    embeddedId: string;
    characteristicName: string;
    data: { value: unknown };
}

export interface UpdateResult {
    success: boolean;
    updated: string[];
}

/**
 * Update Mapper for WebSocket device updates
 */
export class UpdateMapper {
    constructor(
        private readonly logger: Logger,
        private readonly Service: typeof Service,
        private readonly Characteristic: WithUUID<new () => Characteristic>,
    ) {}

    /**
     * Map and apply a device update to an accessory
     */
    applyUpdate(
        accessory: PlatformAccessory<DaikinCloudAccessoryContext>,
        update: DeviceUpdate,
    ): UpdateResult {
        const result: UpdateResult = {
            success: false,
            updated: [],
        };

        // Determine which service type is being used
        const heaterCoolerService = accessory.getService(this.Service.HeaterCooler);
        const thermostatService = accessory.getService(this.Service.Thermostat);
        const service = heaterCoolerService || thermostatService;

        if (!service) {
            return result;
        }

        const isHeaterCooler = !!heaterCoolerService;

        // Map WebSocket characteristic names to HomeKit characteristics
        switch (update.characteristicName) {
            case 'onOffMode':
                this.handleOnOffModeUpdate(service, accessory, update, isHeaterCooler, result);
                break;

            case 'operationMode':
                this.handleOperationModeUpdate(service, accessory, update, isHeaterCooler, result);
                break;

            case 'sensoryData':
                this.handleSensoryDataUpdate(service, update, result);
                break;

            case 'temperatureControl':
                this.handleTemperatureControlUpdate(service, update, result);
                break;

            default:
                this.logger.debug(`[UpdateMapper] Unhandled characteristic: ${update.characteristicName}`);
        }

        result.success = result.updated.length > 0;
        return result;
    }

    /**
     * Handle onOffMode updates
     */
    private handleOnOffModeUpdate(
        service: Service,
        accessory: PlatformAccessory<DaikinCloudAccessoryContext>,
        update: DeviceUpdate,
        isHeaterCooler: boolean,
        result: UpdateResult,
    ): void {
        const isOn = update.data.value === 'on';

        if (isHeaterCooler) {
            // HeaterCooler uses Active characteristic
            service.updateCharacteristic(
                this.Characteristic.Active,
                isOn ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE,
            );
            result.updated.push(`Active=${isOn ? 'ACTIVE' : 'INACTIVE'}`);

            // Also update CurrentHeaterCoolerState
            if (!isOn) {
                service.updateCharacteristic(
                    this.Characteristic.CurrentHeaterCoolerState,
                    this.Characteristic.CurrentHeaterCoolerState.INACTIVE,
                );
                result.updated.push('CurrentHeaterCoolerState=INACTIVE');
            }
        } else {
            // Thermostat uses CurrentHeatingCoolingState
            const operationMode = accessory.context.device.getData(
                update.embeddedId,
                'operationMode',
                undefined,
            ).value as string;

            let currentState: number;
            if (!isOn) {
                currentState = this.Characteristic.CurrentHeatingCoolingState.OFF;
            } else {
                switch (operationMode) {
                    case 'cooling':
                        currentState = this.Characteristic.CurrentHeatingCoolingState.COOL;
                        break;
                    case 'heating':
                        currentState = this.Characteristic.CurrentHeatingCoolingState.HEAT;
                        break;
                    default:
                        currentState = this.Characteristic.CurrentHeatingCoolingState.HEAT;
                }
            }

            service.updateCharacteristic(this.Characteristic.CurrentHeatingCoolingState, currentState);
            result.updated.push(`CurrentHeatingCoolingState=${currentState}`);
        }
    }

    /**
     * Handle operationMode updates
     */
    private handleOperationModeUpdate(
        service: Service,
        accessory: PlatformAccessory<DaikinCloudAccessoryContext>,
        update: DeviceUpdate,
        isHeaterCooler: boolean,
        result: UpdateResult,
    ): void {
        const isOn = accessory.context.device.getData(update.embeddedId, 'onOffMode', undefined).value === 'on';
        if (!isOn) {
            return; // Don't update target state if device is off
        }

        if (isHeaterCooler) {
            // HeaterCooler uses TargetHeaterCoolerState and CurrentHeaterCoolerState
            const mapping = this.mapOperationModeToHeaterCooler(update.data.value as string);
            if (mapping) {
                service.updateCharacteristic(this.Characteristic.TargetHeaterCoolerState, mapping.target);
                service.updateCharacteristic(this.Characteristic.CurrentHeaterCoolerState, mapping.current);
                result.updated.push(
                    `TargetHeaterCoolerState=${mapping.target}`,
                    `CurrentHeaterCoolerState=${mapping.current}`,
                );
            }
        } else {
            // Thermostat uses TargetHeatingCoolingState
            const mapping = this.mapOperationModeToThermostat(update.data.value as string);
            if (mapping !== null) {
                service.updateCharacteristic(this.Characteristic.TargetHeatingCoolingState, mapping);
                result.updated.push(`TargetHeatingCoolingState=${mapping}`);
            }
        }
    }

    /**
     * Handle sensoryData updates
     */
    private handleSensoryDataUpdate(
        service: Service,
        update: DeviceUpdate,
        result: UpdateResult,
    ): void {
        const data = update.data.value as {
            roomTemperature?: { value: number };
            outdoorTemperature?: { value: number };
        };

        if (data.roomTemperature?.value !== undefined) {
            service.updateCharacteristic(
                this.Characteristic.CurrentTemperature,
                data.roomTemperature.value,
            );
            result.updated.push(`CurrentTemperature=${data.roomTemperature.value}`);
        }
    }

    /**
     * Handle temperatureControl updates
     */
    private handleTemperatureControlUpdate(
        service: Service,
        update: DeviceUpdate,
        result: UpdateResult,
    ): void {
        const data = update.data.value as {
            operationModes?: {
                heating?: { setpoints?: { roomTemperature?: { value: number } } };
                cooling?: { setpoints?: { roomTemperature?: { value: number } } };
            };
        };

        const heatingTemp = data.operationModes?.heating?.setpoints?.roomTemperature?.value;
        const coolingTemp = data.operationModes?.cooling?.setpoints?.roomTemperature?.value;

        if (heatingTemp !== undefined) {
            service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, heatingTemp);
            result.updated.push(`HeatingThresholdTemperature=${heatingTemp}`);
        }

        if (coolingTemp !== undefined) {
            service.updateCharacteristic(this.Characteristic.CoolingThresholdTemperature, coolingTemp);
            result.updated.push(`CoolingThresholdTemperature=${coolingTemp}`);
        }
    }

    /**
     * Map operation mode to HeaterCooler states
     */
    private mapOperationModeToHeaterCooler(
        mode: string,
    ): { target: number; current: number } | null {
        switch (mode) {
            case 'cooling':
                return {
                    target: this.Characteristic.TargetHeaterCoolerState.COOL,
                    current: this.Characteristic.CurrentHeaterCoolerState.COOLING,
                };
            case 'heating':
                return {
                    target: this.Characteristic.TargetHeaterCoolerState.HEAT,
                    current: this.Characteristic.CurrentHeaterCoolerState.HEATING,
                };
            case 'auto':
                return {
                    target: this.Characteristic.TargetHeaterCoolerState.AUTO,
                    current: this.Characteristic.CurrentHeaterCoolerState.IDLE,
                };
            default:
                return null;
        }
    }

    /**
     * Map operation mode to Thermostat state
     */
    private mapOperationModeToThermostat(mode: string): number | null {
        switch (mode) {
            case 'cooling':
                return this.Characteristic.TargetHeatingCoolingState.COOL;
            case 'heating':
                return this.Characteristic.TargetHeatingCoolingState.HEAT;
            case 'auto':
                return this.Characteristic.TargetHeatingCoolingState.AUTO;
            default:
                return null;
        }
    }
}
