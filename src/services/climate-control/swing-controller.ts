/**
 * Swing Controller
 *
 * Reads and writes the fan swing (fanDirection vertical/horizontal) state for
 * the current operation mode. Shared by the HeaterCooler SwingMode, the
 * separate Fan service and the Oscillation switch so all three agree on what
 * "swinging" means and which axes get written.
 */

import type { DaikinCloudDevice } from '../../api';
import type { FanAxis } from '../../device/data-paths';
import { DataPaths } from '../../device/data-paths';
import { DaikinFanDirectionHorizontalModes, DaikinOperationModes } from '../../types';

const SWING = DaikinFanDirectionHorizontalModes.SWING;
const STOP = DaikinFanDirectionHorizontalModes.STOP;

// Horizontal first: matches the historical PATCH order.
const AXES: readonly FanAxis[] = ['horizontal', 'vertical'];

export class SwingController {
  constructor(
    private readonly getDevice: () => DaikinCloudDevice,
    private readonly managementPointId: string,
  ) {}

  /** Current swing value of an axis, or undefined when the axis doesn't exist in this mode. */
  axisValue(axis: FanAxis): string | undefined {
    const value = this.getDevice().getData(
      this.managementPointId, 'fanControl', DataPaths.fanDirection(this.operationMode(), axis),
    ).value;
    return value === undefined ? undefined : String(value);
  }

  hasAxis(axis: FanAxis): boolean {
    return this.axisValue(axis) !== undefined;
  }

  isSupported(): boolean {
    return this.hasAxis('vertical') || this.hasAxis('horizontal');
  }

  /** Off only when an axis that exists is stopped. */
  isSwinging(): boolean {
    return AXES.every(axis => this.axisValue(axis) !== STOP);
  }

  describe(): string {
    return `vertical: ${this.axisValue('vertical') ?? null}, horizontal: ${this.axisValue('horizontal') ?? null}`;
  }

  /** Axes whose current value differs from the requested state (equality guard). */
  axesToWrite(enabled: boolean): FanAxis[] {
    const target = enabled ? SWING : STOP;
    return AXES.filter(axis => {
      const current = this.axisValue(axis);
      return current !== undefined && current !== target;
    });
  }

  /** Write the requested swing state to every axis that isn't already there. */
  async set(enabled: boolean): Promise<void> {
    const target = enabled ? SWING : STOP;
    const operationMode = this.operationMode();
    for (const axis of this.axesToWrite(enabled)) {
      await this.getDevice().setData(
        this.managementPointId, 'fanControl', DataPaths.fanDirection(operationMode, axis), target,
      );
    }
  }

  private operationMode(): string {
    const value = this.getDevice().getData(this.managementPointId, 'operationMode', undefined).value;
    return typeof value === 'string' && value ? value : DaikinOperationModes.AUTO;
  }
}
