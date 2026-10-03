import type { CharacteristicProps, CharacteristicValue, PartialAllowingNull, PlatformAccessory, Service } from 'homebridge';
import type { DaikinCloudAccessoryContext, DaikinCloudPlatform } from '../platform';
import type { DaikinCloudDevice } from '../api';
import { DaikinOnOffModes, DaikinOperationModes } from '../types';
import { FeatureManager, HOT_WATER_TANK_FEATURES } from '../features';
import { DataPaths } from '../device/data-paths';
import { withHapWrite } from '../utils/hap-write';
import { toMessage } from '../utils/errors';
import {
  HOMEKIT_TEMP_MIN,
  HOMEKIT_TEMP_MAX,
  DEFAULT_HOT_WATER_TEMPERATURE,
  DEFAULT_HOT_WATER_TARGET_TEMPERATURE,
} from '../constants';

const TARGET_TEMPERATURE_PATH = DataPaths.setpoint(DaikinOperationModes.HEATING, 'domesticHotWaterTemperature');

export class HotWaterTankService {
  readonly platform: DaikinCloudPlatform;
  readonly accessory: PlatformAccessory<DaikinCloudAccessoryContext>;
  private readonly managementPointId: string;

  private readonly name: string;

  private readonly hotWaterTankService: Service;

  /**
   * Feature switches of the tank management point (its "Powerful mode"). A
   * FeatureManager of its own, so switch subtypes are namespaced to the tank
   * and gated on the same config keys (showPowerfulMode / showExtraFeatures)
   * as the climateControl features.
   */
  readonly featureManager: FeatureManager;

  constructor(
    platform: DaikinCloudPlatform,
    accessory: PlatformAccessory<DaikinCloudAccessoryContext>,
    managementPointId: string,
  ) {
    this.platform = platform;
    this.accessory = accessory;
    this.managementPointId = managementPointId;
    this.name = 'Hot water tank';

    this.hotWaterTankService = this.accessory.getService('Hot water tank') || accessory.addService(this.platform.Service.Thermostat, 'Hot water tank', 'hot_water_tank');
    this.hotWaterTankService.setCharacteristic(this.platform.Characteristic.Name, 'Hot water tank');

    this.hotWaterTankService
      .addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
    this.hotWaterTankService
      .setCharacteristic(this.platform.Characteristic.ConfiguredName, 'Hot water tank');

    this.hotWaterTankService.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.handleHotWaterTankCurrentHeatingCoolingStateGet.bind(this));

    this.hotWaterTankService.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.handleHotWaterTankCurrentTemperatureGet.bind(this));

    const temperatureControl = this.getData('temperatureControl', TARGET_TEMPERATURE_PATH);
    const targetTemperature = this.hotWaterTankService.getCharacteristic(this.platform.Characteristic.TargetTemperature);
    // Set value within default HomeKit range first to avoid warning when setProps expands the range
    const tempValue = typeof temperatureControl.value === 'number' ? temperatureControl.value : DEFAULT_HOT_WATER_TARGET_TEMPERATURE;
    const clampedTempValue = Math.max(HOMEKIT_TEMP_MIN, Math.min(HOMEKIT_TEMP_MAX, tempValue));
    targetTemperature.updateValue(clampedTempValue);
    targetTemperature.setProps({
      minStep: temperatureControl.stepValue,
      minValue: temperatureControl.minValue,
      maxValue: temperatureControl.maxValue,
    })
      .onGet(this.handleHotWaterTankHeatingTargetTemperatureGet.bind(this))
      .onSet(this.handleHotWaterTankHeatingTargetTemperatureSet.bind(this));

    // remove the set handler if the temperature is not settable
    if (temperatureControl.settable === false) {
      targetTemperature.removeOnSet();
    }

    this.hotWaterTankService.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .setProps(this.getTargetHeatingCoolingStateProps())
      .onGet(this.handleHotWaterTankTargetHeatingCoolingStateGet.bind(this))
      .onSet(this.handleHotWaterTankTargetHeatingCoolingStateSet.bind(this));

    this.featureManager = new FeatureManager(platform, accessory, managementPointId, HOT_WATER_TANK_FEATURES);
    this.featureManager.setupFeatures();
  }

  private get device(): DaikinCloudDevice {
    return this.accessory.context.device;
  }

  private getData(dataPoint: string, path?: string) {
    return this.device.getData(this.managementPointId, dataPoint, path);
  }

  private write(characteristic: string, op: () => Promise<void>): Promise<void> {
    return withHapWrite(this.platform, `[${this.name}] ${characteristic}`, op);
  }

  /**
   * Push current device state to all HAP characteristics via updateValue().
   * Called after every poll/WebSocket update so HomeKit has an accurate view of
   * device state.
   */
  refreshValues(): void {
    try {
      const isOff = this.getData('onOffMode').value === DaikinOnOffModes.OFF;

      this.hotWaterTankService.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
        .updateValue(isOff
          ? this.platform.Characteristic.CurrentHeatingCoolingState.OFF
          : this.platform.Characteristic.CurrentHeatingCoolingState.HEAT);

      this.hotWaterTankService.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
        .updateValue(this.targetHeatingCoolingState());

      const tankTemp = this.getData('sensoryData', '/tankTemperature').value;
      this.hotWaterTankService.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .updateValue(typeof tankTemp === 'number' && isFinite(tankTemp) ? tankTemp : DEFAULT_HOT_WATER_TEMPERATURE);

      const targetTemp = this.getData('temperatureControl', TARGET_TEMPERATURE_PATH).value;
      if (targetTemp !== undefined) {
        this.hotWaterTankService.getCharacteristic(this.platform.Characteristic.TargetTemperature)
          .updateValue(typeof targetTemp === 'number' && isFinite(targetTemp) ? targetTemp : DEFAULT_HOT_WATER_TARGET_TEMPERATURE);
      }

      this.featureManager.refreshAll();
    } catch (e) {
      this.platform.log.debug(`[${this.name}] refreshValues error: ${toMessage(e)}`);
    }
  }

  async handleHotWaterTankCurrentHeatingCoolingStateGet(): Promise<CharacteristicValue> {
    const state = this.getData('onOffMode').value;
    this.platform.log.debug(`[${this.name}] GET ActiveState, state: ${state}, last update: ${this.device.getLastUpdated()}`);
    const val = state === DaikinOnOffModes.ON
      ? this.platform.Characteristic.CurrentHeatingCoolingState.HEAT
      : this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    this.platform.log.debug(`[${this.name}] GET ActiveState going to return ${val}`);
    return val;
  }

  async handleHotWaterTankCurrentTemperatureGet(): Promise<CharacteristicValue> {
    const temperature = this.getData('sensoryData', '/tankTemperature').value;
    this.platform.log.debug(`[${this.name}] GET CurrentTemperature for hot water tank, temperature: ${temperature}`);
    // Return a valid temperature value, defaulting to 40 if undefined (reasonable for hot water)
    return typeof temperature === 'number' && isFinite(temperature) ? temperature : DEFAULT_HOT_WATER_TEMPERATURE;
  }

  async handleHotWaterTankHeatingTargetTemperatureGet(): Promise<CharacteristicValue> {
    const temperature = this.getData('temperatureControl', TARGET_TEMPERATURE_PATH).value;
    this.platform.log.debug(`[${this.name}] GET HeatingThresholdTemperature domesticHotWaterTank, temperature: ${temperature}`);
    // Return a valid temperature value, defaulting to 50 if undefined
    return typeof temperature === 'number' && isFinite(temperature) ? temperature : DEFAULT_HOT_WATER_TARGET_TEMPERATURE;
  }

  async handleHotWaterTankHeatingTargetTemperatureSet(value: CharacteristicValue) {
    const temperature = Math.round(value as number * 2) / 2;
    const temperatureControl = this.getData('temperatureControl', TARGET_TEMPERATURE_PATH);
    if (temperatureControl.value === temperature) {
      this.platform.log.debug(`[${this.name}] SET HeatingTargetTemperature skipped — already ${temperature}`);
      return;
    }
    this.platform.log.debug(`[${this.name}] SET HeatingTargetTemperature domesticHotWaterTank, temperature to: ${temperature}`);
    if (temperatureControl.settable === false) {
      this.platform.log.warn(
        `[${this.name}] SET HeatingTargetTemperature domesticHotWaterTank is not possible because temperatureControl isn't settable`,
        temperatureControl,
      );
    }
    await this.write('HeatingTargetTemperature', async () => {
      await this.device.setData(this.managementPointId, 'temperatureControl', TARGET_TEMPERATURE_PATH, temperature);
    });
  }

  async handleHotWaterTankTargetHeatingCoolingStateGet(): Promise<CharacteristicValue> {
    this.platform.log.debug(
      `[${this.name}] GET TankTargetHeatingCoolingState, operationMode: ${this.getData('operationMode').value}, ` +
      `state: ${this.getData('onOffMode').value}`,
    );
    return this.targetHeatingCoolingState();
  }

  /**
   * OFF ⇒ onOffMode 'off'. HEAT/COOL/AUTO ⇒ onOffMode 'on' when the tank is off
   * (a Thermostat has no separate Active characteristic, so this is the only
   * way to turn the tank back on from HomeKit), then operationMode when it
   * differs and is settable. Each write is skipped when already in that state.
   */
  async handleHotWaterTankTargetHeatingCoolingStateSet(value: CharacteristicValue) {
    const { TargetHeatingCoolingState } = this.platform.Characteristic;
    this.platform.log.debug(`[${this.name}] SET TargetHeatingCoolingState, OperationMode to: ${value}`);
    const isOff = this.getData('onOffMode').value === DaikinOnOffModes.OFF;

    if (value === TargetHeatingCoolingState.OFF) {
      if (isOff) {
        this.platform.log.debug(`[${this.name}] SET TargetHeatingCoolingState skipped — already off`);
        return;
      }
      await this.write('TargetHeatingCoolingState', async () => {
        await this.device.setData(this.managementPointId, 'onOffMode', DaikinOnOffModes.OFF, undefined);
      });
      return;
    }

    const daikinOperationMode = value === TargetHeatingCoolingState.HEAT ? DaikinOperationModes.HEATING
      : value === TargetHeatingCoolingState.AUTO ? DaikinOperationModes.AUTO
        : DaikinOperationModes.COOLING;
    const operationMode = this.getData('operationMode');
    const changeMode = operationMode.value !== daikinOperationMode;
    if (changeMode && operationMode.settable === false) {
      this.platform.log.warn(`[${this.name}] SET TargetHeatingCoolingState is not possible because operationMode isn't settable`, operationMode);
    }
    const writeMode = changeMode && operationMode.settable !== false;
    if (!isOff && !writeMode) {
      this.platform.log.debug(`[${this.name}] SET TargetHeatingCoolingState skipped — already ${daikinOperationMode}`);
      return;
    }

    this.platform.log.debug(`[${this.name}] SET TargetHeatingCoolingState, daikinOperationMode to: ${daikinOperationMode}`);
    await this.write('TargetHeatingCoolingState', async () => {
      if (isOff) {
        await this.device.setData(this.managementPointId, 'onOffMode', DaikinOnOffModes.ON, undefined);
      }
      if (writeMode) {
        await this.device.setData(this.managementPointId, 'operationMode', daikinOperationMode, undefined);
      }
    });
  }

  getTargetHeatingCoolingStateProps(): PartialAllowingNull<CharacteristicProps> {
    const { TargetHeatingCoolingState } = this.platform.Characteristic;
    const operationMode = this.getData('operationMode');
    this.platform.log.debug('OperationMode', JSON.stringify(operationMode, null, 4));

    const fixedModes: Record<string, number> = {
      [DaikinOperationModes.HEATING]: TargetHeatingCoolingState.HEAT,
      [DaikinOperationModes.COOLING]: TargetHeatingCoolingState.COOL,
      [DaikinOperationModes.AUTO]: TargetHeatingCoolingState.AUTO,
    };
    const fixedMode = typeof operationMode.value === 'string' ? fixedModes[operationMode.value] : undefined;
    if (operationMode.settable === false && fixedMode !== undefined) {
      return { validValues: [TargetHeatingCoolingState.OFF, fixedMode] };
    }

    return {
      minValue: 0,
      maxValue: 3,
      minStep: 1,
    };
  }

  private targetHeatingCoolingState(): number {
    const { TargetHeatingCoolingState } = this.platform.Characteristic;
    if (this.getData('onOffMode').value === DaikinOnOffModes.OFF) {
      return TargetHeatingCoolingState.OFF;
    }
    switch (this.getData('operationMode').value) {
      case DaikinOperationModes.COOLING:
        return TargetHeatingCoolingState.COOL;
      case DaikinOperationModes.HEATING:
        return TargetHeatingCoolingState.HEAT;
      default:
        return TargetHeatingCoolingState.AUTO;
    }
  }
}
