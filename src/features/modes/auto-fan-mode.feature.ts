/**
 * Auto Fan Mode Feature
 *
 * Enables/disables the automatic fan speed mode on the device.
 *
 * HomeKit's HeaterCooler RotationSpeed is a single 0-100% slider with no native
 * concept of an "Auto" fan mode, so we expose Auto as its own switch:
 *   - ON  -> fanSpeed/currentMode = 'auto'
 *   - OFF -> fanSpeed/currentMode = 'fixed' (back to manual speed control)
 *
 * Only supported when the device can toggle between 'auto' and 'fixed' —
 * otherwise the switch would have nothing to turn off to.
 *
 * Moving the RotationSpeed slider switches currentMode back to 'fixed'
 * (see ClimateControlService.handleRotationSpeedSet), which turns this switch off
 * on the next refresh. Mutually exclusive with the Indoor silent (quiet) switch:
 * turning one on flips currentMode, so the other reconciles to off on refresh.
 */

import { OnOffDataPointFeature } from '../on-off-data-point-feature';
import { DaikinFanSpeedModes } from '../../types';
import { DataPaths } from '../../device/data-paths';

export class AutoFanModeFeature extends OnOffDataPointFeature {
  protected readonly spec = {
    name: 'Auto fan mode',
    subtype: 'auto_fan_mode',
    configKey: 'showAutoFanMode',
    dataPoint: 'fanControl',
    path: DataPaths.fanSpeedCurrentMode,
    onValue: DaikinFanSpeedModes.AUTO,
    offValue: DaikinFanSpeedModes.FIXED,
    capability: 'hasAutoFanMode',
  } as const;
}
