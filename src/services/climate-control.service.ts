import type { Characteristic, CharacteristicValue, PlatformAccessory, Service, WithUUID } from 'homebridge';
import type { DaikinCloudAccessoryContext, DaikinCloudPlatform } from '../platform';
import type { DaikinCloudDevice, DeviceDataPoint } from '../api';
import { DaikinOnOffModes, DaikinOperationModes } from '../types';
import type { DaikinControlModes } from '../types';
import { FeatureManager } from '../features';
import { withHapWrite } from '../utils/hap-write';
import { toMessage } from '../utils/errors';
import {
  DEFAULT_ROOM_TEMPERATURE,
  HOMEKIT_TEMP_MIN,
  COOLING_TEMP_CLAMP_MAX,
  HEATING_TEMP_CLAMP_MIN,
  HEATING_TEMP_CLAMP_MAX,
} from '../constants';
import { FanSpeedController, percentStep } from './climate-control/fan-speed';
import { SwingController } from './climate-control/swing-controller';
import { AutoSetpointSync, SetpointResolver } from './climate-control/setpoint-resolver';
import type { ThresholdKind } from './climate-control/setpoint-resolver';
import { SeparateFanService } from './climate-control/separate-fan.service';

const DEFAULT_COOLING_TEMPERATURE = 25;

export class ClimateControlService {
  readonly platform: DaikinCloudPlatform;
  readonly accessory: PlatformAccessory<DaikinCloudAccessoryContext>;
  readonly managementPointId: string;

  private readonly name: string;
  private readonly service: Service;
  readonly featureManager: FeatureManager;
  readonly swing: SwingController;
  readonly fanSpeed: FanSpeedController;
  readonly setpoints: SetpointResolver;
  private readonly autoSetpointSync: AutoSetpointSync;
  private readonly separateFan: SeparateFanService;
  private lastOperationMode?: DaikinOperationModes;

  constructor(
    platform: DaikinCloudPlatform,
    accessory: PlatformAccessory<DaikinCloudAccessoryContext>,
    managementPointId: string,
  ) {
    this.platform = platform;
    this.accessory = accessory;
    this.managementPointId = managementPointId;
    this.name = this.accessory.displayName;

    const getDevice = () => this.device;
    this.swing = new SwingController(getDevice, managementPointId);
    this.fanSpeed = new FanSpeedController(getDevice, managementPointId, () => this.getCurrentOperationMode());
    this.setpoints = new SetpointResolver(getDevice, managementPointId, accessory.UUID);
    this.autoSetpointSync = new AutoSetpointSync(getDevice, managementPointId, this.setpoints, platform.log, this.name);
    this.separateFan = new SeparateFanService(platform, accessory, this.name);

    const { Characteristic } = this.platform;
    this.featureManager = new FeatureManager(platform, accessory, managementPointId);
    this.service = this.accessory.getService(this.platform.Service.HeaterCooler)
      || this.accessory.addService(this.platform.Service.HeaterCooler);
    this.service.setCharacteristic(Characteristic.Name, this.name);

    // Required characteristics
    this.service.getCharacteristic(Characteristic.Active)
      .onSet(this.handleActiveStateSet.bind(this))
      .onGet(this.handleActiveStateGet.bind(this));
    this.service.getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(this.handleCurrentTemperatureGet.bind(this));
    this.service.getCharacteristic(Characteristic.TargetHeaterCoolerState)
      .setProps({ minStep: 1, minValue: 0, maxValue: 2 })
      .onGet(this.handleTargetHeaterCoolerStateGet.bind(this))
      .onSet(this.handleTargetHeaterCoolerStateSet.bind(this));

    this.setupThreshold(
      Characteristic.CoolingThresholdTemperature, DaikinOperationModes.COOLING,
      COOLING_TEMP_CLAMP_MAX, HOMEKIT_TEMP_MIN, COOLING_TEMP_CLAMP_MAX,
      this.handleCoolingThresholdTemperatureGet, this.handleCoolingThresholdTemperatureSet,
    );
    this.setupThreshold(
      Characteristic.HeatingThresholdTemperature, DaikinOperationModes.HEATING,
      DEFAULT_ROOM_TEMPERATURE, HEATING_TEMP_CLAMP_MIN, HEATING_TEMP_CLAMP_MAX,
      this.handleHeatingThresholdTemperatureGet, this.handleHeatingThresholdTemperatureSet,
    );

    this.addOrUpdateCharacteristicRotationSpeed();
    this.lastOperationMode = this.getCurrentOperationMode();

    if (this.swing.isSupported()) {
      this.platform.log.debug(`[${this.name}] Device has SwingMode, add Characteristic`);
      this.service.getCharacteristic(Characteristic.SwingMode)
        .onGet(this.handleSwingModeGet.bind(this))
        .onSet(this.handleSwingModeSet.bind(this));
    }

    // Set up optional feature switches (PowerfulMode, EconoMode, etc.)
    this.featureManager.setupFeatures();

    // Set up the optional standalone Fan service (fan speed + oscillation tile)
    this.setupSeparateFanService();
  }

  private get device(): DaikinCloudDevice {
    return this.accessory.context.device;
  }

  private getData(dataPoint: string, path?: string): DeviceDataPoint {
    return this.device.getData(this.managementPointId, dataPoint, path);
  }

  private setData(dataPoint: string, pathOrValue: unknown, value?: unknown): Promise<void> {
    return this.device.setData(this.managementPointId, dataPoint, pathOrValue, value);
  }

  private write(characteristic: string, op: () => Promise<void>): Promise<void> {
    return withHapWrite(this.platform, `[${this.name}] ${characteristic}`, op);
  }

  /**
   * Threshold characteristics. getData() always returns a wrapper, so these are
   * always present; the props come from the device's setpoint constraints.
   */
  private setupThreshold(
    characteristic: WithUUID<new () => Characteristic>,
    operationMode: DaikinOperationModes,
    fallback: number,
    clampMin: number,
    clampMax: number,
    onGet: () => Promise<CharacteristicValue>,
    onSet: (value: CharacteristicValue) => Promise<void>,
  ): void {
    const setpoint = this.setpoints.read(operationMode);
    const char = this.service.getCharacteristic(characteristic);
    // Set value within default HomeKit range first to avoid warning when setProps narrows the range
    const value = typeof setpoint.value === 'number' ? setpoint.value : fallback;
    char.updateValue(Math.max(clampMin, Math.min(clampMax, value)));
    char
      .setProps({ minStep: setpoint.stepValue, minValue: setpoint.minValue, maxValue: setpoint.maxValue })
      .onGet(onGet.bind(this))
      .onSet(onSet.bind(this));
  }

  setupSeparateFanService(): void {
    const fixed = this.fanSpeed.fixed();
    this.separateFan.setup(
      { hasFanSpeed: fixed.value !== undefined, fanSpeedMax: fixed.maxValue, hasSwing: this.swing.isSupported() },
      {
        getActive: this.handleActiveStateGet.bind(this),
        setActive: this.handleActiveStateSet.bind(this),
        getRotationSpeed: this.handleRotationSpeedGet.bind(this),
        setRotationSpeed: this.handleRotationSpeedSet.bind(this),
        getSwing: this.handleSwingModeGet.bind(this),
        setSwing: this.handleSwingModeSet.bind(this),
      },
    );
  }

  /**
   * Push current device state to all HAP characteristics via updateValue().
   * Called after every poll/WebSocket update so HomeKit has an accurate view of
   * device state. An accurate HAP cache means HomeKit can self-filter redundant
   * scene commands before they ever reach onSet.
   */
  refreshValues(): void {
    const { Characteristic } = this.platform;
    try {
      const isOn = this.getData('onOffMode').value === DaikinOnOffModes.ON;
      const operationMode = this.getCurrentOperationMode();

      // The fixed fan speed range (or its existence) depends on the operation
      // mode, so re-evaluate the RotationSpeed characteristic only when it changes.
      if (operationMode !== this.lastOperationMode) {
        this.lastOperationMode = operationMode;
        this.addOrUpdateCharacteristicRotationSpeed();
      }

      this.service.getCharacteristic(Characteristic.Active)
        .updateValue(isOn ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE);
      this.separateFan.updateActive(isOn);

      let currentState: number = Characteristic.CurrentHeaterCoolerState.IDLE;
      if (!isOn) {
        currentState = Characteristic.CurrentHeaterCoolerState.INACTIVE;
      } else if (operationMode === DaikinOperationModes.COOLING) {
        currentState = Characteristic.CurrentHeaterCoolerState.COOLING;
      } else if (operationMode === DaikinOperationModes.HEATING) {
        currentState = Characteristic.CurrentHeaterCoolerState.HEATING;
      }
      this.service.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(currentState);
      this.service.getCharacteristic(Characteristic.TargetHeaterCoolerState).updateValue(this.targetHeaterCoolerState(operationMode));
      this.service.getCharacteristic(Characteristic.CurrentTemperature).updateValue(this.currentTemperature());

      const coolingTemp = this.setpoints.read(DaikinOperationModes.COOLING).value;
      if (coolingTemp !== undefined) {
        this.service.getCharacteristic(Characteristic.CoolingThresholdTemperature)
          .updateValue(finiteOr(coolingTemp, DEFAULT_COOLING_TEMPERATURE));
      }
      const heatingTemp = this.setpoints.read(DaikinOperationModes.HEATING).value;
      if (heatingTemp !== undefined) {
        this.service.getCharacteristic(Characteristic.HeatingThresholdTemperature)
          .updateValue(finiteOr(heatingTemp, DEFAULT_ROOM_TEMPERATURE));
      }

      // Only push RotationSpeed when the device is in 'fixed' fan mode. In 'auto'
      // or 'quiet' the stored `fixed` value doesn't represent the actual speed;
      // pushing it would seed the HomeKit cache with a value the home hub may
      // replay (as a "cache verification") when another characteristic changes,
      // accidentally switching the device out of auto/quiet. handleRotationSpeedSet
      // guards against that replay too, but an accurate cache prevents it entirely.
      const percent = this.fanSpeed.percentIfFixed(operationMode);
      if (percent !== undefined) {
        this.service.getCharacteristic(Characteristic.RotationSpeed).updateValue(percent);
        this.separateFan.updateRotationSpeed(percent);
      }

      if (this.swing.isSupported()) {
        const swingMode = this.swing.isSwinging() ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED;
        this.service.getCharacteristic(Characteristic.SwingMode).updateValue(swingMode);
        this.separateFan.updateSwing(swingMode);
      }

      // Push feature switches (PowerfulMode, EconoMode, etc.) so toggling
      // these from the Daikin app reaches HomeKit on the next WebSocket update
      // instead of waiting for the user to open the Home app.
      this.featureManager.refreshAll();
    } catch (e) {
      this.platform.log.debug(`[${this.name}] refreshValues error: ${toMessage(e)}`);
    }
  }

  /**
   * Add/refresh RotationSpeed for the current operation mode's fixed fan speed,
   * or remove it when that mode has none (getData() returns `{ value: undefined }`
   * for a missing path; setting it would fail at the API).
   *
   * The characteristic stays in percentage space (see fan-speed.ts). setProps
   * runs FIRST to widen any narrow range left over from a prior session, or the
   * updateValue below trips HAP's validateUserInput; minValue=0 (not
   * stepPercent) keeps HAP happy for cached values below one step —
   * percentToDeviceSpeed clamps writes up to the device minValue anyway.
   */
  addOrUpdateCharacteristicRotationSpeed() {
    const { RotationSpeed } = this.platform.Characteristic;
    const fanControl = this.fanSpeed.fixed();

    if (fanControl.value === undefined) {
      this.service.removeCharacteristic(this.service.getCharacteristic(RotationSpeed));
      return;
    }

    const rotationChar = this.service.getCharacteristic(RotationSpeed);
    rotationChar
      .setProps({ minStep: percentStep(fanControl.maxValue), minValue: 0, maxValue: 100 })
      .onGet(this.handleRotationSpeedGet.bind(this))
      .onSet(this.handleRotationSpeedSet.bind(this));

    // Only seed the cache in 'fixed' fan mode — during construction this runs
    // before refreshValues(), and a misleading seed (e.g. 100% while in auto)
    // may later be replayed by the home hub as a "cache verification" write.
    const percent = this.fanSpeed.percentIfFixed();
    if (percent !== undefined) {
      rotationChar.updateValue(percent);
    }
  }

  async handleActiveStateGet(): Promise<CharacteristicValue> {
    const state = this.getData('onOffMode').value;
    this.platform.log.debug(`[${this.name}] GET ActiveState, state: ${state}, last update: ${this.device.getLastUpdated()}`);
    return state === DaikinOnOffModes.ON;
  }

  async handleActiveStateSet(value: CharacteristicValue) {
    // HAP sends Active as 0 (INACTIVE) or 1 (ACTIVE), not a boolean
    const desired = value === this.platform.Characteristic.Active.ACTIVE;
    if ((this.getData('onOffMode').value === DaikinOnOffModes.ON) === desired) {
      this.platform.log.debug(`[${this.name}] SET ActiveState skipped — already ${desired ? 'on' : 'off'}`);
      return;
    }
    this.platform.log.debug(`[${this.name}] SET ActiveState, state: ${value}`);
    await this.write('ActiveState', () => this.setData('onOffMode', desired ? DaikinOnOffModes.ON : DaikinOnOffModes.OFF, undefined));
  }

  async handleCurrentTemperatureGet(): Promise<CharacteristicValue> {
    const temperature = this.currentTemperature();
    this.platform.log.debug(`[${this.name}] GET CurrentTemperature, temperature: ${temperature}, last update: ${this.device.getLastUpdated()}`);
    return temperature;
  }

  private currentTemperature(): number {
    return finiteOr(this.getData('sensoryData', '/' + this.getCurrentControlMode()).value, DEFAULT_ROOM_TEMPERATURE);
  }

  async handleCoolingThresholdTemperatureGet(): Promise<CharacteristicValue> {
    return this.thresholdGet('cooling', DEFAULT_COOLING_TEMPERATURE);
  }

  async handleCoolingThresholdTemperatureSet(value: CharacteristicValue) {
    await this.thresholdSet('cooling', value);
  }

  async handleHeatingThresholdTemperatureGet(): Promise<CharacteristicValue> {
    return this.thresholdGet('heating', DEFAULT_ROOM_TEMPERATURE);
  }

  async handleHeatingThresholdTemperatureSet(value: CharacteristicValue) {
    await this.thresholdSet('heating', value);
  }

  private thresholdGet(kind: ThresholdKind, fallback: number): number {
    const temperature = this.setpoints.read(thresholdMode(kind)).value;
    const label = kind === 'cooling' ? 'CoolingThresholdTemperature' : 'HeatingThresholdTemperature';
    this.platform.log.debug(`[${this.name}] GET ${label}, temperature: ${temperature}, last update: ${this.device.getLastUpdated()}`);
    return finiteOr(temperature, fallback);
  }

  /**
   * Write a threshold, then mirror the heating/cooling midpoint to Daikin's
   * single AUTO setpoint — once, after concurrent threshold writes settle
   * (see AutoSetpointSync).
   */
  private async thresholdSet(kind: ThresholdKind, value: CharacteristicValue): Promise<void> {
    const temperature = Math.round(value as number * 2) / 2;
    const label = kind === 'cooling' ? 'CoolingThresholdTemperature' : 'HeatingThresholdTemperature';
    const operationMode = thresholdMode(kind);
    if (this.setpoints.read(operationMode).value === temperature) {
      this.platform.log.debug(`[${this.name}] SET ${label} skipped — already ${temperature}`);
      return;
    }
    this.platform.log.debug(`[${this.name}] SET ${label}, temperature to: ${temperature}`);
    await this.write(label, () => this.autoSetpointSync.writeThreshold(kind, temperature,
      () => this.setData('temperatureControl', this.setpoints.path(operationMode), temperature)));
  }

  async handleRotationSpeedGet(): Promise<CharacteristicValue> {
    const { speed, percent } = this.fanSpeed.read();
    this.platform.log.debug(
      `[${this.name}] GET RotationSpeed, device speed: ${speed} → ${percent}%, last update: ${this.device.getLastUpdated()}`,
    );
    return percent;
  }

  async handleRotationSpeedSet(value: CharacteristicValue) {
    const plan = this.fanSpeed.plan(value as number);
    if ('skip' in plan) {
      this.platform.log.debug(`[${this.name}] SET RotationSpeed skipped — ${plan.skip}`);
      return;
    }
    this.platform.log.debug(`[${this.name}] SET RotationSpeed, ${value}% → device speed ${plan.deviceSpeed}`);
    await this.write('RotationSpeed', async () => {
      for (const { path, value: speedValue } of plan.writes) {
        await this.setData('fanControl', path, speedValue);
      }
    });

    // Moving the slider flips fanSpeed/currentMode to 'fixed', so the fan-mode
    // switches (Auto fan mode, Indoor silent) are now off. Push their state now —
    // setData has already updated the in-memory cache optimistically.
    this.featureManager.refreshAll();
  }

  async handleTargetHeaterCoolerStateGet(): Promise<CharacteristicValue> {
    const operationMode = this.getCurrentOperationMode();
    this.platform.log.debug(
      `[${this.name}] GET TargetHeaterCoolerState, operationMode: ${operationMode}, last update: ${this.device.getLastUpdated()}`,
    );
    return this.targetHeaterCoolerState(operationMode);
  }

  private targetHeaterCoolerState(operationMode: DaikinOperationModes): number {
    const { TargetHeaterCoolerState } = this.platform.Characteristic;
    switch (operationMode) {
      case DaikinOperationModes.COOLING:
        return TargetHeaterCoolerState.COOL;
      case DaikinOperationModes.HEATING:
        return TargetHeaterCoolerState.HEAT;
      default:
        return TargetHeaterCoolerState.AUTO;
    }
  }

  async handleTargetHeaterCoolerStateSet(value: CharacteristicValue) {
    const { TargetHeaterCoolerState } = this.platform.Characteristic;
    this.platform.log.debug(`[${this.name}] SET TargetHeaterCoolerState, OperationMode to: ${value}`);
    const daikinOperationMode = value === TargetHeaterCoolerState.HEAT ? DaikinOperationModes.HEATING
      : value === TargetHeaterCoolerState.AUTO ? DaikinOperationModes.AUTO
        : DaikinOperationModes.COOLING;

    // Compared against the Daikin mode, not the HomeKit state: AUTO while the
    // unit is in dry/fanOnly (which read back as AUTO) must still switch to auto.
    if (this.getCurrentOperationMode() === daikinOperationMode) {
      this.platform.log.debug(`[${this.name}] SET TargetHeaterCoolerState skipped — already ${daikinOperationMode}`);
      return;
    }
    this.platform.log.debug(`[${this.name}] SET TargetHeaterCoolerState, daikinOperationMode to: ${daikinOperationMode}`);
    // Note: onOffMode is intentionally NOT set here — the Active characteristic
    // exclusively controls on/off. iOS always sends Active=1 alongside a mode
    // change, so forcing onOffMode=ON here races against a concurrent Active=0
    // (e.g. a "turn off" scene) and can leave devices ON.
    await this.write('TargetHeaterCoolerState', () => this.setData('operationMode', daikinOperationMode, undefined));
  }

  async handleSwingModeSet(value: CharacteristicValue) {
    const enabled = value === this.platform.Characteristic.SwingMode.SWING_ENABLED;
    if (this.swing.axesToWrite(enabled).length === 0) {
      this.platform.log.debug(`[${this.name}] SET SwingMode skipped — already ${enabled ? 'swinging' : 'stopped'}`);
      return;
    }
    this.platform.log.debug(`[${this.name}] SET SwingMode, swingmode to: ${value}`);
    await this.write('SwingMode', () => this.swing.set(enabled));
  }

  async handleSwingModeGet(): Promise<CharacteristicValue> {
    this.platform.log.debug(`[${this.name}] GET SwingMode, ${this.swing.describe()}, last update: ${this.device.getLastUpdated()}`);
    return this.swing.isSwinging()
      ? this.platform.Characteristic.SwingMode.SWING_ENABLED
      : this.platform.Characteristic.SwingMode.SWING_DISABLED;
  }

  getCurrentOperationMode(): DaikinOperationModes {
    return this.getData('operationMode').value as DaikinOperationModes;
  }

  getCurrentControlMode(): DaikinControlModes {
    return this.setpoints.getControlMode();
  }
}

function thresholdMode(kind: ThresholdKind): DaikinOperationModes {
  return kind === 'cooling' ? DaikinOperationModes.COOLING : DaikinOperationModes.HEATING;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && isFinite(value) ? value : fallback;
}
