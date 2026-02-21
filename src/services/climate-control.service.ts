import {CharacteristicValue, PlatformAccessory, Service} from 'homebridge';
import {DaikinCloudAccessoryContext, DaikinCloudPlatform} from '../platform';
import {DaikinCloudRepo} from '../api/daikin-cloud.repository';
import {
    DaikinControlModes,
    DaikinFanDirectionHorizontalModes,
    DaikinFanDirectionVerticalModes,
    DaikinFanSpeedModes,
    DaikinOnOffModes,
    DaikinOperationModes,
    DaikinSetpointModes,
    DaikinTemperatureControlSetpoints,
} from '../types';
import {FeatureManager} from '../features';
import {
    DEFAULT_ROOM_TEMPERATURE,
    HOMEKIT_TEMP_MIN,
    COOLING_TEMP_CLAMP_MAX,
    HEATING_TEMP_CLAMP_MIN,
    HEATING_TEMP_CLAMP_MAX,
} from '../constants';

export class ClimateControlService {
    readonly platform: DaikinCloudPlatform;
    readonly accessory: PlatformAccessory<DaikinCloudAccessoryContext>;
    readonly managementPointId: string;

    private readonly name: string;
    private readonly service?: Service;
    readonly featureManager: FeatureManager;

    constructor(
        platform: DaikinCloudPlatform,
        accessory: PlatformAccessory<DaikinCloudAccessoryContext>,
        managementPointId: string,
    ) {
        this.platform = platform;
        this.accessory = accessory;
        this.managementPointId = managementPointId;
        this.name = this.accessory.displayName;

        this.service = this.accessory.getService(this.platform.Service.HeaterCooler);
        this.featureManager = new FeatureManager(platform, accessory, managementPointId);

        this.service = this.service || this.accessory.addService(this.platform.Service.HeaterCooler);

        this.service.setCharacteristic(this.platform.Characteristic.Name, this.name);

        // Required characteristic
        this.service.getCharacteristic(this.platform.Characteristic.Active)
            .onSet(this.handleActiveStateSet.bind(this))
            .onGet(this.handleActiveStateGet.bind(this));

        // Required characteristic
        this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
            .onGet(this.handleCurrentTemperatureGet.bind(this));

        // Required characteristic
        this.service.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
            .setProps({
                minStep: 1,
                minValue: 0,
                maxValue: 2,
            })
            .onGet(this.handleTargetHeaterCoolerStateGet.bind(this))
            .onSet(this.handleTargetHeaterCoolerStateSet.bind(this));

        const roomTemperatureControlForCooling = accessory.context.device.getData(this.managementPointId, 'temperatureControl', `/operationModes/${DaikinOperationModes.COOLING}/setpoints/${this.getSetpoint(DaikinOperationModes.COOLING)}`);
        if (roomTemperatureControlForCooling) {
            const coolingChar = this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature);
            // Set value within default HomeKit range first to avoid warning when setProps narrows the range
            const coolingValue = typeof roomTemperatureControlForCooling.value === 'number' ? roomTemperatureControlForCooling.value : COOLING_TEMP_CLAMP_MAX;
            const clampedCoolingValue = Math.max(HOMEKIT_TEMP_MIN, Math.min(COOLING_TEMP_CLAMP_MAX, coolingValue));
            coolingChar.updateValue(clampedCoolingValue);
            coolingChar
                .setProps({
                    minStep: roomTemperatureControlForCooling.stepValue,
                    minValue: roomTemperatureControlForCooling.minValue,
                    maxValue: roomTemperatureControlForCooling.maxValue,
                })
                .onGet(this.handleCoolingThresholdTemperatureGet.bind(this))
                .onSet(this.handleCoolingThresholdTemperatureSet.bind(this));
        } else {
            this.service.removeCharacteristic(this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature));
        }

        const roomTemperatureControlForHeating = accessory.context.device.getData(this.managementPointId, 'temperatureControl', `/operationModes/${DaikinOperationModes.HEATING}/setpoints/${this.getSetpoint(DaikinOperationModes.HEATING)}`);
        if (roomTemperatureControlForHeating) {
            const heatingChar = this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature);
            // Set value within default HomeKit range first to avoid warning when setProps narrows the range
            const heatingValue = typeof roomTemperatureControlForHeating.value === 'number' ? roomTemperatureControlForHeating.value : DEFAULT_ROOM_TEMPERATURE;
            const clampedHeatingValue = Math.max(HEATING_TEMP_CLAMP_MIN, Math.min(HEATING_TEMP_CLAMP_MAX, heatingValue));
            heatingChar.updateValue(clampedHeatingValue);
            heatingChar
                .setProps({
                    minStep: roomTemperatureControlForHeating.stepValue,
                    minValue: roomTemperatureControlForHeating.minValue,
                    maxValue: roomTemperatureControlForHeating.maxValue,
                })
                .onGet(this.handleHeatingThresholdTemperatureGet.bind(this))
                .onSet(this.handleHeatingThresholdTemperatureSet.bind(this));
        } else {
            this.service.removeCharacteristic(this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature));
        }

        this.addOrUpdateCharacteristicRotationSpeed();

        if (this.hasSwingModeFeature()) {
            this.platform.log.debug(`[${this.name}] Device has SwingMode, add Characteristic`);
            this.service.getCharacteristic(this.platform.Characteristic.SwingMode)
                .onGet(this.handleSwingModeGet.bind(this))
                .onSet(this.handleSwingModeSet.bind(this));
        }

        // Set up optional feature switches (PowerfulMode, EconoMode, etc.)
        this.featureManager.setupFeatures();
    }

    addOrUpdateCharacteristicRotationSpeed() {
        if (!this.service) {
            throw Error('Service not initialized');
        }

        const fanControl = this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanSpeed/modes/fixed`);

        if (fanControl) {
            const rotationChar = this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed);
            // Set value within default HomeKit range first to avoid warning when setProps narrows the range
            const rotationValue = typeof fanControl.value === 'number' ? fanControl.value : 1;
            const clampedRotationValue = Math.max(0, Math.min(100, rotationValue));
            rotationChar.updateValue(clampedRotationValue);
            rotationChar
                .setProps({
                    minStep: fanControl.stepValue,
                    minValue: fanControl.minValue,
                    maxValue: fanControl.maxValue,
                })
                .onGet(this.handleRotationSpeedGet.bind(this))
                .onSet(this.handleRotationSpeedSet.bind(this));
        } else {
            this.service.removeCharacteristic(this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed));
        }
    }

    async handleActiveStateGet(): Promise<CharacteristicValue> {
        const state = this.accessory.context.device.getData(this.managementPointId, 'onOffMode', undefined).value;
        this.platform.log.debug(`[${this.name}] GET ActiveState, state: ${state}, last update: ${this.accessory.context.device.getLastUpdated()}`);
        return state === DaikinOnOffModes.ON;
    }

    async handleActiveStateSet(value: CharacteristicValue) {
        this.platform.log.debug(`[${this.name}] SET ActiveState, state: ${value}`);
        const state = value as boolean;
        try {
            await this.accessory.context.device.setData(this.managementPointId, 'onOffMode', state ? DaikinOnOffModes.ON : DaikinOnOffModes.OFF, undefined);
            this.platform.forceUpdateDevices();
        } catch (e) {
            this.platform.log.error('Failed to set', e, JSON.stringify(DaikinCloudRepo.maskSensitiveCloudDeviceData(this.accessory.context.device.desc), null, 4));
            throw e;
        }
    }

    async handleCurrentTemperatureGet(): Promise<CharacteristicValue> {
        const temperature = this.accessory.context.device.getData(this.managementPointId, 'sensoryData', '/' + this.getCurrentControlMode()).value as number | undefined;
        this.platform.log.debug(`[${this.name}] GET CurrentTemperature, temperature: ${temperature}, last update: ${this.accessory.context.device.getLastUpdated()}`);
        // Return a valid temperature value, defaulting to 20 if undefined
        return typeof temperature === 'number' && isFinite(temperature) ? temperature : DEFAULT_ROOM_TEMPERATURE;
    }

    async handleCoolingThresholdTemperatureGet(): Promise<CharacteristicValue> {
        const temperature = this.accessory.context.device.getData(this.managementPointId, 'temperatureControl', `/operationModes/${DaikinOperationModes.COOLING}/setpoints/${this.getSetpoint(DaikinOperationModes.COOLING)}`).value as number | undefined;
        this.platform.log.debug(`[${this.name}] GET CoolingThresholdTemperature, temperature: ${temperature}, last update: ${this.accessory.context.device.getLastUpdated()}`);
        return typeof temperature === 'number' && isFinite(temperature) ? temperature : 25;
    }

    async handleCoolingThresholdTemperatureSet(value: CharacteristicValue) {
        const temperature = Math.round(value as number * 2) / 2;
        this.platform.log.debug(`[${this.name}] SET CoolingThresholdTemperature, temperature to: ${temperature}`);
        try {
            await this.accessory.context.device.setData(this.managementPointId, 'temperatureControl', `/operationModes/${DaikinOperationModes.COOLING}/setpoints/${this.getSetpoint(DaikinOperationModes.COOLING)}`, temperature);
            this.platform.forceUpdateDevices();
        } catch (e) {
            this.platform.log.error('Failed to set', e, JSON.stringify(DaikinCloudRepo.maskSensitiveCloudDeviceData(this.accessory.context.device.desc), null, 4));
            throw e;
        }
    }

    async handleRotationSpeedGet(): Promise<CharacteristicValue> {
        const speed = this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanSpeed/modes/fixed`).value as number | undefined;
        this.platform.log.debug(`[${this.name}] GET RotationSpeed, speed: ${speed}, last update: ${this.accessory.context.device.getLastUpdated()}`);
        return typeof speed === 'number' && isFinite(speed) ? speed : 1;
    }

    async handleRotationSpeedSet(value: CharacteristicValue) {
        const speed = value as number;
        this.platform.log.debug(`[${this.name}] SET RotationSpeed, speed to: ${speed}`);
        try {
            await this.accessory.context.device.setData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanSpeed/currentMode`, 'fixed');
            await this.accessory.context.device.setData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanSpeed/modes/fixed`, speed);
            this.platform.forceUpdateDevices();
        } catch (e) {
            this.platform.log.error('Failed to set', e, JSON.stringify(DaikinCloudRepo.maskSensitiveCloudDeviceData(this.accessory.context.device.desc), null, 4));
            throw e;
        }
    }

    async handleHeatingThresholdTemperatureGet(): Promise<CharacteristicValue> {
        const temperature = this.accessory.context.device.getData(this.managementPointId, 'temperatureControl', `/operationModes/${DaikinOperationModes.HEATING}/setpoints/${this.getSetpoint(DaikinOperationModes.HEATING)}`).value as number | undefined;
        this.platform.log.debug(`[${this.name}] GET HeatingThresholdTemperature, temperature: ${temperature}, last update: ${this.accessory.context.device.getLastUpdated()}`);
        return typeof temperature === 'number' && isFinite(temperature) ? temperature : DEFAULT_ROOM_TEMPERATURE;
    }

    async handleHeatingThresholdTemperatureSet(value: CharacteristicValue) {
        try {
            const temperature = Math.round(value as number * 2) / 2;
            this.platform.log.debug(`[${this.name}] SET HeatingThresholdTemperature, temperature to: ${temperature}`);
            await this.accessory.context.device.setData(this.managementPointId, 'temperatureControl', `/operationModes/${DaikinOperationModes.HEATING}/setpoints/${this.getSetpoint(DaikinOperationModes.HEATING)}`, temperature);
            this.platform.forceUpdateDevices();
        } catch (e) {
            this.platform.log.error('Failed to set', e, JSON.stringify(DaikinCloudRepo.maskSensitiveCloudDeviceData(this.accessory.context.device.desc), null, 4));
            throw e;
        }
    }

    async handleTargetHeaterCoolerStateGet(): Promise<CharacteristicValue> {
        const operationMode: DaikinOperationModes = this.getCurrentOperationMode();
        this.platform.log.debug(`[${this.name}] GET TargetHeaterCoolerState, operationMode: ${operationMode}, last update: ${this.accessory.context.device.getLastUpdated()}`);

        switch (operationMode) {
            case DaikinOperationModes.COOLING:
                return this.platform.Characteristic.TargetHeaterCoolerState.COOL;
            case DaikinOperationModes.HEATING:
                return this.platform.Characteristic.TargetHeaterCoolerState.HEAT;
            case DaikinOperationModes.DRY:
                this.addOrUpdateCharacteristicRotationSpeed();
                return this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
            default:
                return this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
        }
    }

    async handleTargetHeaterCoolerStateSet(value: CharacteristicValue) {
        const operationMode = value as number;
        this.platform.log.debug(`[${this.name}] SET TargetHeaterCoolerState, OperationMode to: ${value}`);
        let daikinOperationMode: DaikinOperationModes = DaikinOperationModes.COOLING;

        switch (operationMode) {
            case this.platform.Characteristic.TargetHeaterCoolerState.COOL:
                daikinOperationMode = DaikinOperationModes.COOLING;
                break;
            case this.platform.Characteristic.TargetHeaterCoolerState.HEAT:
                daikinOperationMode = DaikinOperationModes.HEATING;
                break;
            case this.platform.Characteristic.TargetHeaterCoolerState.AUTO:
                daikinOperationMode = DaikinOperationModes.AUTO;
                break;
        }

        try {
            this.platform.log.debug(`[${this.name}] SET TargetHeaterCoolerState, daikinOperationMode to: ${daikinOperationMode}`);
            await this.accessory.context.device.setData(this.managementPointId, 'operationMode', daikinOperationMode, undefined);
            await this.accessory.context.device.setData(this.managementPointId, 'onOffMode', DaikinOnOffModes.ON, undefined);
            this.platform.forceUpdateDevices();
        } catch (e) {
            this.platform.log.error('Failed to set', e, JSON.stringify(DaikinCloudRepo.maskSensitiveCloudDeviceData(this.accessory.context.device.desc), null, 4));
            throw e;
        }
    }

    async handleSwingModeSet(value: CharacteristicValue) {
        try {
            const swingMode = value as number;
            const daikinSwingMode = swingMode === 1 ? DaikinFanDirectionHorizontalModes.SWING : DaikinFanDirectionHorizontalModes.STOP;
            this.platform.log.debug(`[${this.name}] SET SwingMode, swingmode to: ${swingMode}/${daikinSwingMode}`);

            if (this.hasSwingModeHorizontalFeature()) {
                await this.accessory.context.device.setData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanDirection/horizontal/currentMode`, daikinSwingMode);
            }

            if (this.hasSwingModeVerticalFeature()) {
                await this.accessory.context.device.setData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanDirection/vertical/currentMode`, daikinSwingMode);
            }

            this.platform.forceUpdateDevices();
        } catch (e) {
            this.platform.log.error('Failed to set', e, JSON.stringify(DaikinCloudRepo.maskSensitiveCloudDeviceData(this.accessory.context.device.desc), null, 4));
            throw e;
        }
    }

    async handleSwingModeGet(): Promise<CharacteristicValue> {
        const verticalSwingMode = this.hasSwingModeVerticalFeature() ? this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanDirection/vertical/currentMode`).value : null;
        const horizontalSwingMode = this.hasSwingModeHorizontalFeature() ? this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanDirection/horizontal/currentMode`).value : null;
        this.platform.log.debug(`[${this.name}] GET SwingMode, verticalSwingMode: ${verticalSwingMode}, last update: ${this.accessory.context.device.getLastUpdated()}`);
        this.platform.log.debug(`[${this.name}] GET SwingMode, horizontalSwingMode: ${horizontalSwingMode}, last update: ${this.accessory.context.device.getLastUpdated()}`);

        if (horizontalSwingMode === DaikinFanDirectionHorizontalModes.STOP || verticalSwingMode === DaikinFanDirectionVerticalModes.STOP) {
            return this.platform.Characteristic.SwingMode.SWING_DISABLED;
        }

        return this.platform.Characteristic.SwingMode.SWING_ENABLED;
    }

    getCurrentOperationMode(): DaikinOperationModes {
        return this.accessory.context.device.getData(this.managementPointId, 'operationMode', undefined).value as DaikinOperationModes;
    }

    getCurrentControlMode(): DaikinControlModes {
        const controlMode = this.accessory.context.device.getData(this.managementPointId, 'controlMode', undefined);

        // Only Altherma devices have a controlMode, others have a fixed controlMode of ROOM_TEMPERATURE AFAIK
        if (!controlMode.value) {
            return DaikinControlModes.ROOM_TEMPERATURE;
        }

        return controlMode.value as DaikinControlModes;
    }

    getSetpointMode(): DaikinSetpointModes | null {
        const setpointMode = this.accessory.context.device.getData(this.managementPointId, 'setpointMode', undefined);
        if (!setpointMode.value) {
            return null;
        }
        return setpointMode.value as DaikinSetpointModes;
    }

    getSetpoint(operationMode: DaikinOperationModes): DaikinTemperatureControlSetpoints {
        // depending on the settings of the device the temperatureControl can be set in different ways "DaikinTemperatureControlSetpoints"
        // Docs: https://developer.cloud.daikineurope.com/docs/b0dffcaa-7b51-428a-bdff-a7c8a64195c0/supported_features
        // Looks like the setpointMode is the most important one to determine the setpoint,
        // then the controleMode and in case of weatherDependentHeatingFixedCooling also the operation mode
        // If the setpointMode is not available (in case on non-Althermas), we can use the controlMode to determine the setpoint

        const setpointMode = this.getSetpointMode();
        const controlMode = this.getCurrentControlMode();

        if (setpointMode) {
            switch (setpointMode) {
                case DaikinSetpointModes.FIXED:
                    switch (controlMode) {
                        case DaikinControlModes.LEAVING_WATER_TEMPERATURE:
                            return DaikinTemperatureControlSetpoints.LEAVING_WATER_TEMPERATURE;
                        default:
                            return DaikinTemperatureControlSetpoints.ROOM_TEMPERATURE;
                    }
                case DaikinSetpointModes.WEATHER_DEPENDENT:
                    switch (controlMode) {
                        case DaikinControlModes.LEAVING_WATER_TEMPERATURE:
                            return DaikinTemperatureControlSetpoints.LEAVING_WATER_OFFSET;
                        default:
                            return DaikinTemperatureControlSetpoints.ROOM_TEMPERATURE;
                    }
                case DaikinSetpointModes.WEATHER_DEPENDENT_HEATING_FIXED_COOLING:
                    switch (controlMode) {
                        case DaikinControlModes.ROOM_TEMPERATURE:
                            return DaikinTemperatureControlSetpoints.ROOM_TEMPERATURE;
                        case DaikinControlModes.LEAVING_WATER_TEMPERATURE:
                            switch (operationMode) {
                                case DaikinOperationModes.HEATING:
                                    return DaikinTemperatureControlSetpoints.LEAVING_WATER_OFFSET;
                                case DaikinOperationModes.COOLING:
                                    return DaikinTemperatureControlSetpoints.LEAVING_WATER_TEMPERATURE;
                            }
                    }
            }


            throw new Error(`Could not determine the TemperatureControlSetpoint for operationMode: ${operationMode}, setpointMode: ${setpointMode}, controlMode: ${controlMode}, for device: ${JSON.stringify(DaikinCloudRepo.maskSensitiveCloudDeviceData(this.accessory.context.device.desc), null, 4)}`);
        }

        switch (controlMode) {
            case DaikinControlModes.LEAVING_WATER_TEMPERATURE:
                return DaikinTemperatureControlSetpoints.LEAVING_WATER_OFFSET;
            default:
                return DaikinTemperatureControlSetpoints.ROOM_TEMPERATURE;
        }
    }

    hasSwingModeVerticalFeature() {
        const verticalSwing = this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanDirection/vertical/currentMode`);
        this.platform.log.debug(`[${this.name}] hasSwingModeFeature, verticalSwing: ${Boolean(verticalSwing)}`);
        return Boolean(verticalSwing);
    }

    hasSwingModeHorizontalFeature() {
        const horizontalSwing = this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanDirection/horizontal/currentMode`);
        this.platform.log.debug(`[${this.name}] hasSwingModeFeature, horizontalSwing: ${Boolean(horizontalSwing)}`);
        return Boolean(horizontalSwing);
    }

    hasSwingModeFeature() {
        return Boolean(this.hasSwingModeVerticalFeature() || this.hasSwingModeHorizontalFeature());
    }

    hasPowerfulModeFeature() {
        const powerfulMode = this.accessory.context.device.getData(this.managementPointId, 'powerfulMode', undefined);
        this.platform.log.debug(`[${this.name}] hasPowerfulModeFeature, powerfulMode: ${Boolean(powerfulMode)}`);
        return Boolean(powerfulMode);
    }

    hasEconoModeFeature() {
        const econoMode = this.accessory.context.device.getData(this.managementPointId, 'econoMode', undefined);
        this.platform.log.debug(`[${this.name}] hasEconoModeFeature, econoMode: ${Boolean(econoMode)}`);
        return Boolean(econoMode);
    }

    hasStreamerModeFeature() {
        const streamerMode = this.accessory.context.device.getData(this.managementPointId, 'streamerMode', undefined);
        this.platform.log.debug(`[${this.name}] hasStreamerModeFeature, streamerMode: ${Boolean(streamerMode)}`);
        return Boolean(streamerMode);
    }

    hasOutdoorSilentModeFeature() {
        const OutdoorSilentMode = this.accessory.context.device.getData(this.managementPointId, 'outdoorSilentMode', undefined);
        this.platform.log.debug(`[${this.name}] hasOutdoorSilentModeFeature, outdoorSilentMode: ${Boolean(OutdoorSilentMode)}`);
        return Boolean(OutdoorSilentMode);
    }

    hasIndoorSilentModeFeature() {
        const currentModeFanControl = this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanSpeed/currentMode`);
        if (!currentModeFanControl) {
            return false;
        }
        const fanSpeedValues: Array<string> = currentModeFanControl.values || [];
        this.platform.log.debug(`[${this.name}] hasIndoorSilentModeFeature, indoorSilentMode: ${fanSpeedValues.includes(DaikinFanSpeedModes.QUIET)}`);
        return fanSpeedValues.includes(DaikinFanSpeedModes.QUIET);
    }

    hasOperationMode(operationMode: DaikinOperationModes) {
        const operationModeValues: Array<string> = this.accessory.context.device.getData(this.managementPointId, 'operationMode', undefined).values || [];
        this.platform.log.debug(`[${this.name}] has ${operationMode}: ${operationModeValues.includes(operationMode)}`);
        return operationModeValues.includes(operationMode);
    }

    hasDryOperationModeFeature() {
        return this.hasOperationMode(DaikinOperationModes.DRY);
    }

    hasFanOnlyOperationModeFeature() {
        return this.hasOperationMode(DaikinOperationModes.FAN_ONLY);
    }
}
