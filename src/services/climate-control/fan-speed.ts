/**
 * Fan speed mapping and control
 *
 * Daikin units expose a small integer fan-speed scale (typically 1-5 or 1-3),
 * while iOS Home renders RotationSpeed as a 0-100% slider regardless of
 * setProps. These helpers map both directions: device 5/5 → 100%, 1/5 → 20%,
 * and minStep = 100/maxValue gives discrete positions that round-trip cleanly.
 */

import type { DaikinCloudDevice, DeviceDataPoint } from '../../api';
import { DataPaths } from '../../device/data-paths';
import { DaikinFanSpeedModes } from '../../types';

export const DEFAULT_FAN_MAX = 5;

function fanMax(maxValue: number | undefined): number {
  return maxValue && maxValue > 0 ? maxValue : DEFAULT_FAN_MAX;
}

/** Slider step (in %) matching one device speed step. */
export function percentStep(maxValue: number | undefined): number {
  return 100 / fanMax(maxValue);
}

export function deviceSpeedToPercent(speed: number, maxValue: number | undefined): number {
  const percent = Math.round((speed / fanMax(maxValue)) * 100);
  return Math.max(0, Math.min(100, percent));
}

export function percentToDeviceSpeed(
  percent: number,
  minValue: number | undefined,
  maxValue: number | undefined,
): number {
  const min = minValue && minValue > 0 ? minValue : 1;
  const max = fanMax(maxValue);
  const raw = Math.round((percent / 100) * max);
  return Math.max(min, Math.min(max, raw));
}

export type FanSpeedWritePlan =
  | { skip: string }
  | { deviceSpeed: number; writes: Array<{ path: string; value: string | number }> };

/**
 * Reads the fixed fan speed of the current operation mode as a HomeKit
 * percentage and plans the fanControl writes for a RotationSpeed change.
 */
export class FanSpeedController {
  constructor(
    private readonly getDevice: () => DaikinCloudDevice,
    private readonly managementPointId: string,
    private readonly operationMode: () => string,
  ) {}

  /** fanControl fixed fan speed data point of an operation mode (default: the current one). */
  fixed(operationMode = this.operationMode()): DeviceDataPoint {
    return this.fanControl(DataPaths.fanSpeedFixed(operationMode));
  }

  /** The fixed fan speed as a percentage, only while the device is in 'fixed' fan mode. */
  percentIfFixed(operationMode = this.operationMode()): number | undefined {
    if (this.fanControl(DataPaths.fanSpeedCurrentMode(operationMode)).value !== DaikinFanSpeedModes.FIXED) {
      return undefined;
    }
    const fixed = this.fixed(operationMode);
    return typeof fixed.value === 'number' ? deviceSpeedToPercent(fixed.value, fixed.maxValue) : undefined;
  }

  /** The stored fixed speed as a percentage (one step when unknown). */
  read(): { speed: unknown; percent: number } {
    const fixed = this.fixed();
    const speed = fixed.value;
    const percent = typeof speed === 'number' && isFinite(speed)
      ? deviceSpeedToPercent(speed, fixed.maxValue)
      : percentStep(fixed.maxValue);
    return { speed, percent };
  }

  plan(percent: number): FanSpeedWritePlan {
    const operationMode = this.operationMode();

    // The current operation mode has no fixed fan speed: PATCHing a
    // non-existent path makes the API answer 422 ("No Response" in HomeKit).
    const fixed = this.fixed(operationMode);
    if (fixed.value === undefined) {
      return { skip: `operationMode ${operationMode} does not support fixed fan speed` };
    }

    const deviceSpeed = percentToDeviceSpeed(percent, fixed.minValue, fixed.maxValue);
    const currentModePath = DataPaths.fanSpeedCurrentMode(operationMode);
    const currentMode = this.fanControl(currentModePath);

    // In auto/quiet fan mode a speed equal to the stored fixed value is the
    // signature of a HomeKit cache replay (fired when another characteristic,
    // e.g. the setpoint, changes on the same service) — not a user change.
    // Writing it would flip the fan from auto/quiet to fixed at the stored speed.
    if (currentMode.value !== undefined && currentMode.value !== DaikinFanSpeedModes.FIXED && deviceSpeed === fixed.value) {
      return {
        skip: `device is in "${currentMode.value}" mode and speed ${deviceSpeed} already matches the stored fixed value. ` +
          'This is likely a HomeKit cache replay, not a user fan-speed change.',
      };
    }

    const writes: Array<{ path: string; value: string | number }> = [];
    // Only switch currentMode to 'fixed' when needed (and when supported). Some
    // operation modes (e.g. dry on some units) restrict currentMode to 'auto' only.
    if (currentMode.value !== DaikinFanSpeedModes.FIXED && (currentMode.values ?? []).includes(DaikinFanSpeedModes.FIXED)) {
      writes.push({ path: currentModePath, value: DaikinFanSpeedModes.FIXED });
    }
    writes.push({ path: DataPaths.fanSpeedFixed(operationMode), value: deviceSpeed });
    return { deviceSpeed, writes };
  }

  private fanControl(path: string): DeviceDataPoint {
    return this.getDevice().getData(this.managementPointId, 'fanControl', path);
  }
}
