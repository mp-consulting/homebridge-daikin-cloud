import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { DaikinCloudAccessoryContext, DaikinCloudPlatform } from '../platform';
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
import { FeatureManager } from '../features';
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
  private fanService?: Service;
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

    // Set up the optional standalone Fan service (fan speed + oscillation tile)
    this.setupSeparateFanService();
  }

  /**
   * Optional standalone Fan (Fanv2) service.
   *
   * HomeKit hides the HeaterCooler's RotationSpeed slider and SwingMode toggle
   * when the accessory is grouped into a single tile in the Home app — they're
   * only reachable by opening the device directly. Exposing a separate Fanv2
   * service gives the fan speed slider and oscillation toggle their own tile that
   * stays visible even when grouped.
   *
   * Gated behind the `showSeparateFanControl` config option, and only added when
   * the device actually exposes a fixed fan speed and/or a swing mode. The fan's
   * Active characteristic mirrors the unit on/off state, and its RotationSpeed /
   * SwingMode reuse the same handlers as the HeaterCooler so both services stay
   * in sync.
   */
  setupSeparateFanService(): void {
    if (!this.service) {
      return;
    }

    const subtype = 'separate_fan';
    const existing = this.accessory.getServiceById(this.platform.Service.Fanv2, subtype);

    const fanControl = this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanSpeed/modes/fixed`);
    const hasFanSpeed = fanControl.value !== undefined;
    const hasSwing = this.hasSwingModeFeature();
    const enabled = this.platform.config.showSeparateFanControl === true;

    if (!enabled || (!hasFanSpeed && !hasSwing)) {
      if (existing) {
        this.platform.log.debug(`[${this.name}] Removing separate Fan service`);
        this.accessory.removeService(existing);
      }
      this.fanService = undefined;
      return;
    }

    const fanName = `${this.name} Fan`;
    this.platform.log.debug(`[${this.name}] Adding separate Fan service`);
    this.fanService = existing || this.accessory.addService(this.platform.Service.Fanv2, fanName, subtype);
    this.fanService.setCharacteristic(this.platform.Characteristic.Name, fanName);
    this.fanService.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
    this.fanService.setCharacteristic(this.platform.Characteristic.ConfiguredName, fanName);

    // Active mirrors the unit on/off (same handlers as the HeaterCooler Active).
    this.fanService.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.handleActiveStateGet.bind(this))
      .onSet(this.handleActiveStateSet.bind(this));

    if (hasFanSpeed) {
      this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
        .setProps({
          minStep: percentStep(fanControl.maxValue),
          minValue: 0,
          maxValue: 100,
        })
        .onGet(this.handleRotationSpeedGet.bind(this))
        .onSet(this.handleRotationSpeedSet.bind(this));
    } else {
      this.fanService.removeCharacteristic(this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed));
    }

    if (hasSwing) {
      this.fanService.getCharacteristic(this.platform.Characteristic.SwingMode)
        .onGet(this.handleSwingModeGet.bind(this))
        .onSet(this.handleSwingModeSet.bind(this));
    }
  }

  /**
   * Execute a device write operation with proper HAP error handling.
   * Catches errors, logs a warning, and throws HapStatusError(SERVICE_COMMUNICATION_FAILURE)
   * so HomeKit shows "No Response" instead of Homebridge logging "plugin threw an error".
   */
  private async setDeviceData(characteristic: string, operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
      this.platform.forceUpdateDevices();
    } catch (e) {
      this.platform.log.warn(`[${this.name}] Failed to set ${characteristic}: ${e instanceof Error ? e.message : e}`);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /**
   * Push current device state to all HAP characteristics via updateValue().
   * Called after every poll/WebSocket update so HomeKit has an accurate view of
   * device state. An accurate HAP cache means HomeKit can self-filter redundant
   * scene commands before they ever reach onSet.
   */
  refreshValues(): void {
    if (!this.service) {
      return;
    }
    try {
      const onOff = this.accessory.context.device.getData(this.managementPointId, 'onOffMode', undefined).value;
      const operationMode = this.getCurrentOperationMode();
      const isOn = onOff === DaikinOnOffModes.ON;

      this.service.getCharacteristic(this.platform.Characteristic.Active)
        .updateValue(isOn ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE);
      this.fanService?.getCharacteristic(this.platform.Characteristic.Active)
        .updateValue(isOn ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE);

      let currentState: number;
      if (!isOn) {
        currentState = this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE;
      } else if (operationMode === DaikinOperationModes.COOLING) {
        currentState = this.platform.Characteristic.CurrentHeaterCoolerState.COOLING;
      } else if (operationMode === DaikinOperationModes.HEATING) {
        currentState = this.platform.Characteristic.CurrentHeaterCoolerState.HEATING;
      } else {
        currentState = this.platform.Characteristic.CurrentHeaterCoolerState.IDLE;
      }
      this.service.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
        .updateValue(currentState);

      let targetState: number;
      switch (operationMode) {
        case DaikinOperationModes.COOLING:
          targetState = this.platform.Characteristic.TargetHeaterCoolerState.COOL;
          break;
        case DaikinOperationModes.HEATING:
          targetState = this.platform.Characteristic.TargetHeaterCoolerState.HEAT;
          break;
        default:
          targetState = this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
      }
      this.service.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
        .updateValue(targetState);

      const temperature = this.accessory.context.device.getData(this.managementPointId, 'sensoryData', '/' + this.getCurrentControlMode()).value as number | undefined;
      this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .updateValue(typeof temperature === 'number' && isFinite(temperature) ? temperature : DEFAULT_ROOM_TEMPERATURE);

      const coolingTemp = this.accessory.context.device.getData(
        this.managementPointId, 'temperatureControl',
        `/operationModes/${DaikinOperationModes.COOLING}/setpoints/${this.getSetpoint(DaikinOperationModes.COOLING)}`,
      ).value as number | undefined;
      if (coolingTemp !== undefined) {
        this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
          .updateValue(typeof coolingTemp === 'number' && isFinite(coolingTemp) ? coolingTemp : 25);
      }

      const heatingTemp = this.accessory.context.device.getData(
        this.managementPointId, 'temperatureControl',
        `/operationModes/${DaikinOperationModes.HEATING}/setpoints/${this.getSetpoint(DaikinOperationModes.HEATING)}`,
      ).value as number | undefined;
      if (heatingTemp !== undefined) {
        this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
          .updateValue(typeof heatingTemp === 'number' && isFinite(heatingTemp) ? heatingTemp : DEFAULT_ROOM_TEMPERATURE);
      }

      // Only push RotationSpeed to HomeKit when the device is in 'fixed' fan mode.
      // When in 'auto' or 'quiet' mode, the stored `fixed` value doesn't represent
      // the actual fan speed — it's just a fallback for when the user switches back.
      // Pushing it would seed the HomeKit cache with a misleading value, which the
      // home hub may then replay (as a "cache verification") when another characteristic
      // on this service is changed — accidentally switching the device out of auto/quiet
      // mode. The onSet guard in handleRotationSpeedSet catches the replay, but keeping
      // the cache accurate from the start prevents the scenario entirely.
      const fanSpeedCurrentMode = this.accessory.context.device.getData(
        this.managementPointId, 'fanControl',
        `/operationModes/${operationMode}/fanSpeed/currentMode`,
      );
      if (fanSpeedCurrentMode.value === DaikinFanSpeedModes.FIXED) {
        const fanSpeedData = this.accessory.context.device.getData(
          this.managementPointId, 'fanControl',
          `/operationModes/${operationMode}/fanSpeed/modes/fixed`,
        );
        if (fanSpeedData.value !== undefined) {
          const percent = deviceSpeedToPercent(fanSpeedData.value as number, fanSpeedData.maxValue);
          this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed)
            .updateValue(percent);
          if (this.fanService?.testCharacteristic(this.platform.Characteristic.RotationSpeed)) {
            this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed).updateValue(percent);
          }
        }
      }

      if (this.hasSwingModeFeature()) {
        const verticalSwingMode = this.hasSwingModeVerticalFeature()
          ? this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${operationMode}/fanDirection/vertical/currentMode`).value
          : null;
        const horizontalSwingMode = this.hasSwingModeHorizontalFeature()
          ? this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${operationMode}/fanDirection/horizontal/currentMode`).value
          : null;
        const swingEnabled = horizontalSwingMode !== DaikinFanDirectionHorizontalModes.STOP
          && verticalSwingMode !== DaikinFanDirectionVerticalModes.STOP;
        this.service.getCharacteristic(this.platform.Characteristic.SwingMode)
          .updateValue(swingEnabled ? this.platform.Characteristic.SwingMode.SWING_ENABLED : this.platform.Characteristic.SwingMode.SWING_DISABLED);
        this.fanService?.getCharacteristic(this.platform.Characteristic.SwingMode)
          .updateValue(swingEnabled ? this.platform.Characteristic.SwingMode.SWING_ENABLED : this.platform.Characteristic.SwingMode.SWING_DISABLED);
      }

      // Push feature switches (PowerfulMode, EconoMode, etc.) so toggling
      // these from the Daikin app reaches HomeKit on the next WebSocket update
      // instead of waiting for the user to open the Home app.
      this.featureManager.refreshAll();
    } catch (e) {
      this.platform.log.debug(`[${this.name}] refreshValues error: ${e instanceof Error ? e.message : e}`);
    }
  }

  addOrUpdateCharacteristicRotationSpeed() {
    if (!this.service) {
      throw Error('Service not initialized');
    }

    // getData() returns { value: undefined } when the path is missing — checking the
    // wrapper for truthiness always succeeds, so the characteristic was being added
    // (with undefined min/max/step) even for devices that don't support a fixed fan
    // speed in the current operation mode. Setting it would then fail at the API.
    const fanControl = this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanSpeed/modes/fixed`);

    if (fanControl.value !== undefined) {
      // Daikin units expose a small integer fan-speed scale (typically 1-5 or 1-3).
      // iOS Home renders RotationSpeed as a 0-100% slider regardless of setProps,
      // so we keep the characteristic in percentage space and map both directions:
      // device 5/5 → HomeKit 100% (full bar), device 1/5 → 20%, etc.
      // minStep = 100/maxValue gives the discrete positions that round-trip cleanly.
      //
      // Order matters: setProps FIRST to widen any narrow range left over from a
      // prior session (e.g. an old build that capped at maxValue=5). Otherwise the
      // updateValue below trips HAP's validateUserInput. minValue=0 (not stepPercent)
      // keeps HAP happy when the cached value is below stepPercent — the slider's
      // 0 position is harmless since percentToDeviceSpeed clamps writes up to the
      // device minValue anyway.
      const rotationChar = this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed);
      const stepPercent = percentStep(fanControl.maxValue);
      const percent = deviceSpeedToPercent(fanControl.value as number, fanControl.maxValue);
      rotationChar
        .setProps({
          minStep: stepPercent,
          minValue: 0,
          maxValue: 100,
        })
        .onGet(this.handleRotationSpeedGet.bind(this))
        .onSet(this.handleRotationSpeedSet.bind(this));

      // Only seed the HomeKit cache with the stored fixed percentage when the
      // device is actually in 'fixed' fan mode. During construction this runs
      // before refreshValues() — without this guard, the initial seed would
      // push a misleading value (e.g. 100% when the device is in auto mode)
      // that the home hub may later replay as a "cache verification" write.
      const operationMode = this.getCurrentOperationMode();
      const currentMode = this.accessory.context.device.getData(
        this.managementPointId, 'fanControl',
        `/operationModes/${operationMode}/fanSpeed/currentMode`,
      );
      if (currentMode.value === DaikinFanSpeedModes.FIXED) {
        rotationChar.updateValue(percent);
      }
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
    // HAP sends Active as 0 (INACTIVE) or 1 (ACTIVE), not a boolean
    const desired = value === this.platform.Characteristic.Active.ACTIVE;
    const current = this.accessory.context.device.getData(this.managementPointId, 'onOffMode', undefined).value;
    if ((current === DaikinOnOffModes.ON) === desired) {
      this.platform.log.debug(`[${this.name}] SET ActiveState skipped — already ${desired ? 'on' : 'off'}`);
      return;
    }
    this.platform.log.debug(`[${this.name}] SET ActiveState, state: ${value}`);
    await this.setDeviceData('ActiveState', async () => {
      await this.accessory.context.device.setData(this.managementPointId, 'onOffMode', desired ? DaikinOnOffModes.ON : DaikinOnOffModes.OFF, undefined);
    });
  }

  async handleCurrentTemperatureGet(): Promise<CharacteristicValue> {
    const temperature = this.accessory.context.device.getData(this.managementPointId, 'sensoryData', '/' + this.getCurrentControlMode()).value as number | undefined;
    const lastUpdate = this.accessory.context.device.getLastUpdated();
    this.platform.log.debug(
      `[${this.name}] GET CurrentTemperature, temperature: ${temperature}, last update: ${lastUpdate}`,
    );
    // Return a valid temperature value, defaulting to 20 if undefined
    return typeof temperature === 'number' && isFinite(temperature) ? temperature : DEFAULT_ROOM_TEMPERATURE;
  }

  async handleCoolingThresholdTemperatureGet(): Promise<CharacteristicValue> {
    const setpoint = this.getSetpoint(DaikinOperationModes.COOLING);
    const path = `/operationModes/${DaikinOperationModes.COOLING}/setpoints/${setpoint}`;
    const temperature = this.accessory.context.device.getData(
      this.managementPointId, 'temperatureControl', path,
    ).value as number | undefined;
    const lastUpdate = this.accessory.context.device.getLastUpdated();
    this.platform.log.debug(
      `[${this.name}] GET CoolingThresholdTemperature, temperature: ${temperature}, last update: ${lastUpdate}`,
    );
    return typeof temperature === 'number' && isFinite(temperature) ? temperature : 25;
  }

  async handleCoolingThresholdTemperatureSet(value: CharacteristicValue) {
    const temperature = Math.round(value as number * 2) / 2;
    this.platform.log.debug(`[${this.name}] SET CoolingThresholdTemperature, temperature to: ${temperature}`);
    await this.setDeviceData('CoolingThresholdTemperature', async () => {
      await this.accessory.context.device.setData(this.managementPointId, 'temperatureControl', `/operationModes/${DaikinOperationModes.COOLING}/setpoints/${this.getSetpoint(DaikinOperationModes.COOLING)}`, temperature);
      await this.syncAutoSetpointIfSupported({ cooling: temperature });
    });
  }

  async handleRotationSpeedGet(): Promise<CharacteristicValue> {
    const fanSpeedData = this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanSpeed/modes/fixed`);
    const speed = fanSpeedData.value as number | undefined;
    const percent = typeof speed === 'number' && isFinite(speed)
      ? deviceSpeedToPercent(speed, fanSpeedData.maxValue)
      : percentStep(fanSpeedData.maxValue);
    this.platform.log.debug(
      `[${this.name}] GET RotationSpeed, device speed: ${speed} → ${percent}%, ` +
        `last update: ${this.accessory.context.device.getLastUpdated()}`,
    );
    return percent;
  }

  async handleRotationSpeedSet(value: CharacteristicValue) {
    const operationMode = this.getCurrentOperationMode();

    // Skip if the current operation mode doesn't support a fixed fan speed.
    // Without this check, we'd PATCH a non-existent path and the Daikin API would
    // respond with a 422 (visible to the user as "No Response" in HomeKit).
    const fixedFanSpeed = this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${operationMode}/fanSpeed/modes/fixed`);
    if (fixedFanSpeed.value === undefined) {
      this.platform.log.debug(`[${this.name}] SET RotationSpeed skipped — operationMode ${operationMode} does not support fixed fan speed`);
      return;
    }

    const deviceSpeed = percentToDeviceSpeed(value as number, fixedFanSpeed.minValue, fixedFanSpeed.maxValue);
    this.platform.log.debug(`[${this.name}] SET RotationSpeed, ${value}% → device speed ${deviceSpeed}`);

    const currentMode = this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${operationMode}/fanSpeed/currentMode`);

    // Guard: skip when the device is in auto or quiet fan mode and the incoming
    // speed matches the stored fixed value. HomeKit may replay the cached
    // RotationSpeed when another characteristic (e.g. temperature setpoint)
    // changes on the same service. Without this guard, a simple temperature
    // adjustment would accidentally switch the fan from auto/quiet to fixed mode
    // at the stored speed (often 5/5).
    if (
      currentMode.value !== undefined &&
      currentMode.value !== DaikinFanSpeedModes.FIXED &&
      deviceSpeed === fixedFanSpeed.value
    ) {
      this.platform.log.debug(
        `[${this.name}] SET RotationSpeed skipped — device is in "${currentMode.value}" mode ` +
        `and speed ${deviceSpeed} already matches the stored fixed value. ` +
        'This is likely a HomeKit cache replay, not a user fan-speed change.',
      );
      return;
    }

    const allowedModes = (currentMode.values ?? []) as string[];

    await this.setDeviceData('RotationSpeed', async () => {
      // Only switch currentMode to 'fixed' when needed (and when supported). Some
      // operation modes (e.g. dry on some units) restrict currentMode to 'auto' only.
      if (currentMode.value !== DaikinFanSpeedModes.FIXED && allowedModes.includes(DaikinFanSpeedModes.FIXED)) {
        await this.accessory.context.device.setData(this.managementPointId, 'fanControl', `/operationModes/${operationMode}/fanSpeed/currentMode`, DaikinFanSpeedModes.FIXED);
      }
      await this.accessory.context.device.setData(this.managementPointId, 'fanControl', `/operationModes/${operationMode}/fanSpeed/modes/fixed`, deviceSpeed);
    });

    // Moving the slider flips fanSpeed/currentMode to 'fixed', which means any
    // fan-mode switches (Auto fan mode, Indoor silent) are now off. Push their
    // state immediately so HomeKit reflects it without waiting for the next poll
    // — setData has already updated the in-memory cache optimistically.
    this.featureManager.refreshAll();
  }

  async handleHeatingThresholdTemperatureGet(): Promise<CharacteristicValue> {
    const setpoint = this.getSetpoint(DaikinOperationModes.HEATING);
    const path = `/operationModes/${DaikinOperationModes.HEATING}/setpoints/${setpoint}`;
    const temperature = this.accessory.context.device.getData(
      this.managementPointId, 'temperatureControl', path,
    ).value as number | undefined;
    const lastUpdate = this.accessory.context.device.getLastUpdated();
    this.platform.log.debug(
      `[${this.name}] GET HeatingThresholdTemperature, temperature: ${temperature}, last update: ${lastUpdate}`,
    );
    return typeof temperature === 'number' && isFinite(temperature) ? temperature : DEFAULT_ROOM_TEMPERATURE;
  }

  async handleHeatingThresholdTemperatureSet(value: CharacteristicValue) {
    const temperature = Math.round(value as number * 2) / 2;
    this.platform.log.debug(`[${this.name}] SET HeatingThresholdTemperature, temperature to: ${temperature}`);
    await this.setDeviceData('HeatingThresholdTemperature', async () => {
      await this.accessory.context.device.setData(this.managementPointId, 'temperatureControl', `/operationModes/${DaikinOperationModes.HEATING}/setpoints/${this.getSetpoint(DaikinOperationModes.HEATING)}`, temperature);
      await this.syncAutoSetpointIfSupported({ heating: temperature });
    });
  }

  /**
   * Daikin's auto operationMode uses a SINGLE setpoint, not a range like
   * HomeKit's HeaterCooler (heating threshold + cooling threshold). Without
   * this sync the Daikin app keeps showing whatever auto setpoint was there
   * when the device was last in auto mode, regardless of what the user picks
   * in HomeKit. Mirror the midpoint of the current heating/cooling thresholds
   * to /operationModes/auto/setpoints/roomTemperature whenever either
   * threshold is set, so the Daikin app and HomeKit stay in sync.
   *
   * No-op when the device doesn't expose an auto setpoint (e.g. devices
   * without an auto operationMode at all).
   */
  private async syncAutoSetpointIfSupported(
    overrides: { heating?: number; cooling?: number } = {},
  ): Promise<void> {
    // Best-effort. Failures here (e.g. getSetpoint throwing for Altherma's
    // weatherDependentHeatingFixedCooling + leavingWaterTemperature combo, or
    // any PATCH error) must not propagate — the primary heating/cooling write
    // already succeeded by this point, and a missing auto-sync just leaves
    // the Daikin app showing a slightly stale auto setpoint.
    try {
      const autoSetpointKey = this.getSetpoint(DaikinOperationModes.AUTO);
      const autoPath = `/operationModes/${DaikinOperationModes.AUTO}/setpoints/${autoSetpointKey}`;
      const autoData = this.accessory.context.device.getData(this.managementPointId, 'temperatureControl', autoPath);
      if (autoData.value === undefined) {
        return;
      }

      const heatingKey = this.getSetpoint(DaikinOperationModes.HEATING);
      const coolingKey = this.getSetpoint(DaikinOperationModes.COOLING);
      const heating = overrides.heating ?? (this.accessory.context.device.getData(
        this.managementPointId, 'temperatureControl',
        `/operationModes/${DaikinOperationModes.HEATING}/setpoints/${heatingKey}`,
      ).value as number | undefined);
      const cooling = overrides.cooling ?? (this.accessory.context.device.getData(
        this.managementPointId, 'temperatureControl',
        `/operationModes/${DaikinOperationModes.COOLING}/setpoints/${coolingKey}`,
      ).value as number | undefined);
      if (typeof heating !== 'number' || typeof cooling !== 'number') {
        return;
      }

      // Midpoint rounded to nearest 0.5° — matches the step used by the
      // heating/cooling setters above, and the stepValue Daikin returns.
      let midpoint = Math.round(heating + cooling) / 2;
      if (typeof autoData.minValue === 'number') {
        midpoint = Math.max(autoData.minValue, midpoint);
      }
      if (typeof autoData.maxValue === 'number') {
        midpoint = Math.min(autoData.maxValue, midpoint);
      }

      if (typeof autoData.value === 'number' && Math.abs(autoData.value - midpoint) < 0.01) {
        return;
      }

      this.platform.log.debug(
        `[${this.name}] SYNC AutoSetpoint, heating=${heating} cooling=${cooling} → auto=${midpoint}`,
      );
      await this.accessory.context.device.setData(this.managementPointId, 'temperatureControl', autoPath, midpoint);
    } catch (e) {
      this.platform.log.debug(
        `[${this.name}] AutoSetpoint sync skipped: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  async handleTargetHeaterCoolerStateGet(): Promise<CharacteristicValue> {
    const operationMode: DaikinOperationModes = this.getCurrentOperationMode();
    const lastUpdate = this.accessory.context.device.getLastUpdated();
    this.platform.log.debug(
      `[${this.name}] GET TargetHeaterCoolerState, operationMode: ${operationMode}, last update: ${lastUpdate}`,
    );

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

    this.platform.log.debug(`[${this.name}] SET TargetHeaterCoolerState, daikinOperationMode to: ${daikinOperationMode}`);
    await this.setDeviceData('TargetHeaterCoolerState', async () => {
      await this.accessory.context.device.setData(this.managementPointId, 'operationMode', daikinOperationMode, undefined);
      // Note: onOffMode is intentionally NOT set here — the Active characteristic
      // exclusively controls on/off. iOS always sends Active=1 alongside a mode
      // change, so forcing onOffMode=ON here races against a concurrent Active=0
      // (e.g. a "turn off" scene) and can leave devices ON.
    });
  }

  async handleSwingModeSet(value: CharacteristicValue) {
    const swingMode = value as number;
    const daikinSwingMode = swingMode === 1 ? DaikinFanDirectionHorizontalModes.SWING : DaikinFanDirectionHorizontalModes.STOP;
    this.platform.log.debug(`[${this.name}] SET SwingMode, swingmode to: ${swingMode}/${daikinSwingMode}`);
    await this.setDeviceData('SwingMode', async () => {
      if (this.hasSwingModeHorizontalFeature()) {
        await this.accessory.context.device.setData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanDirection/horizontal/currentMode`, daikinSwingMode);
      }

      if (this.hasSwingModeVerticalFeature()) {
        await this.accessory.context.device.setData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanDirection/vertical/currentMode`, daikinSwingMode);
      }
    });
  }

  async handleSwingModeGet(): Promise<CharacteristicValue> {
    const verticalSwingMode = this.hasSwingModeVerticalFeature() ? this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanDirection/vertical/currentMode`).value : null;
    const horizontalSwingMode = this.hasSwingModeHorizontalFeature() ? this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanDirection/horizontal/currentMode`).value : null;
    const lastUpdate = this.accessory.context.device.getLastUpdated();
    this.platform.log.debug(
      `[${this.name}] GET SwingMode, verticalSwingMode: ${verticalSwingMode}, last update: ${lastUpdate}`,
    );
    this.platform.log.debug(
      `[${this.name}] GET SwingMode, horizontalSwingMode: ${horizontalSwingMode}, last update: ${lastUpdate}`,
    );

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


      throw new Error(
        `Could not determine the TemperatureControlSetpoint for operationMode: ${operationMode}, `
        + `setpointMode: ${setpointMode}, controlMode: ${controlMode}, deviceId: ${this.accessory.UUID}`,
      );
    }

    switch (controlMode) {
      case DaikinControlModes.LEAVING_WATER_TEMPERATURE:
        return DaikinTemperatureControlSetpoints.LEAVING_WATER_OFFSET;
      default:
        return DaikinTemperatureControlSetpoints.ROOM_TEMPERATURE;
    }
  }

  hasSwingModeVerticalFeature() {
    // getData() returns { value: undefined } when the path is missing — checking the
    // wrapper for truthiness always succeeds. We need to confirm the value itself is set.
    const verticalSwing = this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanDirection/vertical/currentMode`);
    return verticalSwing.value !== undefined;
  }

  hasSwingModeHorizontalFeature() {
    const horizontalSwing = this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanDirection/horizontal/currentMode`);
    return horizontalSwing.value !== undefined;
  }

  hasSwingModeFeature() {
    return this.hasSwingModeVerticalFeature() || this.hasSwingModeHorizontalFeature();
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

// Daikin's fan speed scale (e.g. 1..5) → HomeKit's 0..100% percentage slider.
// Pulled to module scope so refreshValues / addOrUpdate / get / set use the
// same math and the same fallback for missing maxValue.
const DEFAULT_FAN_MAX = 5;

function percentStep(maxValue: number | undefined): number {
  return 100 / (maxValue && maxValue > 0 ? maxValue : DEFAULT_FAN_MAX);
}

function deviceSpeedToPercent(speed: number, maxValue: number | undefined): number {
  const max = maxValue && maxValue > 0 ? maxValue : DEFAULT_FAN_MAX;
  const percent = Math.round((speed / max) * 100);
  return Math.max(0, Math.min(100, percent));
}

function percentToDeviceSpeed(
  percent: number,
  minValue: number | undefined,
  maxValue: number | undefined,
): number {
  const min = minValue && minValue > 0 ? minValue : 1;
  const max = maxValue && maxValue > 0 ? maxValue : DEFAULT_FAN_MAX;
  const raw = Math.round((percent / 100) * max);
  return Math.max(min, Math.min(max, raw));
}
