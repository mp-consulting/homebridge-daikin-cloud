/**
 * Setpoint Resolver
 *
 * Works out which temperatureControl setpoint (roomTemperature,
 * leavingWaterOffset, leavingWaterTemperature) applies to an operation mode,
 * and keeps Daikin's single AUTO setpoint in sync with HomeKit's
 * heating/cooling threshold range.
 */

import type { Logger } from 'homebridge';
import type { DaikinCloudDevice, DeviceDataPoint } from '../../api';
import { DataPaths } from '../../device/data-paths';
import {
  DaikinControlModes,
  DaikinOperationModes,
  DaikinSetpointModes,
  DaikinTemperatureControlSetpoints,
} from '../../types';
import { toMessage } from '../../utils/errors';

export type ThresholdKind = 'heating' | 'cooling';

export class SetpointResolver {
  constructor(
    private readonly getDevice: () => DaikinCloudDevice,
    private readonly managementPointId: string,
    private readonly deviceLabel: string,
  ) {}

  getControlMode(): DaikinControlModes {
    // Only Altherma devices have a controlMode, others have a fixed controlMode of ROOM_TEMPERATURE AFAIK
    const controlMode = this.getDevice().getData(this.managementPointId, 'controlMode', undefined).value;
    return (controlMode || DaikinControlModes.ROOM_TEMPERATURE) as DaikinControlModes;
  }

  getSetpointMode(): DaikinSetpointModes | null {
    const setpointMode = this.getDevice().getData(this.managementPointId, 'setpointMode', undefined).value;
    return (setpointMode || null) as DaikinSetpointModes | null;
  }

  /**
   * Depending on the device settings the temperatureControl is set in different ways.
   * Docs: https://developer.cloud.daikineurope.com/docs/b0dffcaa-7b51-428a-bdff-a7c8a64195c0/supported_features
   * The setpointMode is the most important one, then the controlMode and, for
   * weatherDependentHeatingFixedCooling, also the operation mode. Without a
   * setpointMode (non-Althermas) the controlMode alone decides.
   */
  getSetpoint(operationMode: DaikinOperationModes): DaikinTemperatureControlSetpoints {
    const setpointMode = this.getSetpointMode();
    const controlMode = this.getControlMode();
    const leavingWater = controlMode === DaikinControlModes.LEAVING_WATER_TEMPERATURE;

    if (!setpointMode) {
      return leavingWater ? DaikinTemperatureControlSetpoints.LEAVING_WATER_OFFSET : DaikinTemperatureControlSetpoints.ROOM_TEMPERATURE;
    }

    switch (setpointMode) {
      case DaikinSetpointModes.FIXED:
        return leavingWater ? DaikinTemperatureControlSetpoints.LEAVING_WATER_TEMPERATURE : DaikinTemperatureControlSetpoints.ROOM_TEMPERATURE;
      case DaikinSetpointModes.WEATHER_DEPENDENT:
        return leavingWater ? DaikinTemperatureControlSetpoints.LEAVING_WATER_OFFSET : DaikinTemperatureControlSetpoints.ROOM_TEMPERATURE;
      case DaikinSetpointModes.WEATHER_DEPENDENT_HEATING_FIXED_COOLING:
        if (controlMode === DaikinControlModes.ROOM_TEMPERATURE) {
          return DaikinTemperatureControlSetpoints.ROOM_TEMPERATURE;
        }
        if (leavingWater && operationMode === DaikinOperationModes.HEATING) {
          return DaikinTemperatureControlSetpoints.LEAVING_WATER_OFFSET;
        }
        if (leavingWater && operationMode === DaikinOperationModes.COOLING) {
          return DaikinTemperatureControlSetpoints.LEAVING_WATER_TEMPERATURE;
        }
    }

    throw new Error(
      `Could not determine the TemperatureControlSetpoint for operationMode: ${operationMode}, `
      + `setpointMode: ${setpointMode}, controlMode: ${controlMode}, deviceId: ${this.deviceLabel}`,
    );
  }

  /** temperatureControl path of the setpoint used by an operation mode. */
  path(operationMode: DaikinOperationModes): string {
    return DataPaths.setpoint(operationMode, this.getSetpoint(operationMode));
  }

  /** temperatureControl data point of the setpoint used by an operation mode. */
  read(operationMode: DaikinOperationModes): DeviceDataPoint {
    return this.getDevice().getData(this.managementPointId, 'temperatureControl', this.path(operationMode));
  }
}

/**
 * Daikin's auto operationMode uses a SINGLE setpoint, not a range like
 * HomeKit's HeaterCooler (heating threshold + cooling threshold). Without this
 * sync the Daikin app keeps showing whatever auto setpoint was there when the
 * device was last in auto mode. The midpoint of the heating/cooling thresholds
 * is mirrored to /operationModes/auto/setpoints/<setpoint>.
 *
 * When HomeKit changes the range it writes both thresholds in one request and
 * Homebridge runs both onSet handlers concurrently. Threshold writes are
 * therefore tracked: the sync runs once, after the last in-flight threshold
 * write settles, using the final values of both thresholds.
 */
export class AutoSetpointSync {
  private inFlight = 0;
  private pending: Partial<Record<ThresholdKind, number>> = {};

  constructor(
    private readonly getDevice: () => DaikinCloudDevice,
    private readonly managementPointId: string,
    private readonly resolver: SetpointResolver,
    private readonly log: Logger,
    private readonly name: string,
  ) {}

  /**
   * Run a threshold write, then sync the auto setpoint once no other threshold
   * write is in flight. Rethrows the write's error after the sync bookkeeping.
   */
  async writeThreshold(kind: ThresholdKind, value: number, write: () => Promise<void>): Promise<void> {
    this.inFlight++;
    this.pending[kind] = value;
    let failure: { error: unknown } | undefined;
    try {
      await write();
    } catch (error) {
      failure = { error };
      if (this.pending[kind] === value) {
        delete this.pending[kind];
      }
    }
    this.inFlight--;

    if (this.inFlight === 0 && Object.keys(this.pending).length > 0) {
      const overrides = this.pending;
      this.pending = {};
      await this.sync(overrides);
    }
    if (failure) {
      throw failure.error;
    }
  }

  /**
   * Best-effort: failures (e.g. getSetpoint throwing for Altherma's
   * weatherDependentHeatingFixedCooling + leavingWaterTemperature combo, or any
   * PATCH error) must not propagate — the threshold write already succeeded,
   * and a missed sync only leaves the Daikin app with a stale auto setpoint.
   * No-op when the device exposes no auto setpoint.
   */
  async sync(overrides: Partial<Record<ThresholdKind, number>> = {}): Promise<void> {
    try {
      const autoPath = this.resolver.path(DaikinOperationModes.AUTO);
      const autoData = this.getDevice().getData(this.managementPointId, 'temperatureControl', autoPath);
      if (autoData.value === undefined) {
        return;
      }

      const heating = overrides.heating ?? this.resolver.read(DaikinOperationModes.HEATING).value;
      const cooling = overrides.cooling ?? this.resolver.read(DaikinOperationModes.COOLING).value;
      if (typeof heating !== 'number' || typeof cooling !== 'number') {
        return;
      }

      // Midpoint rounded to nearest 0.5° — matches the threshold setters' step
      // and the stepValue Daikin returns.
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

      this.log.debug(`[${this.name}] SYNC AutoSetpoint, heating=${heating} cooling=${cooling} → auto=${midpoint}`);
      await this.getDevice().setData(this.managementPointId, 'temperatureControl', autoPath, midpoint);
    } catch (e) {
      this.log.debug(`[${this.name}] AutoSetpoint sync skipped: ${toMessage(e)}`);
    }
  }
}
