/**
 * Indoor Silent Mode Feature
 *
 * Enables/disables the indoor silent (quiet) mode on the device by switching
 * fanSpeed/currentMode of the current operation mode between 'quiet' and 'fixed'.
 */

import { OnOffDataPointFeature } from '../on-off-data-point-feature';
import { DaikinFanSpeedModes } from '../../types';
import { DataPaths } from '../../device/data-paths';

export class IndoorSilentModeFeature extends OnOffDataPointFeature {
  protected readonly spec = {
    name: 'Indoor silent mode',
    subtype: 'indoor_silent_mode',
    configKey: 'showIndoorSilentMode',
    dataPoint: 'fanControl',
    path: DataPaths.fanSpeedCurrentMode,
    onValue: DaikinFanSpeedModes.QUIET,
    offValue: DaikinFanSpeedModes.FIXED,
    capability: 'hasIndoorSilentMode',
  } as const;
}
