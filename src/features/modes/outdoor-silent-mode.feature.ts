/**
 * Outdoor Silent Mode Feature
 *
 * Enables/disables the outdoor silent mode on the device.
 */

import { OnOffDataPointFeature } from '../on-off-data-point-feature';
import { DaikinOutdoorSilentModes } from '../../types';

export class OutdoorSilentModeFeature extends OnOffDataPointFeature {
  protected readonly spec = {
    name: 'Outdoor silent mode',
    subtype: 'outdoor_silent_mode',
    configKey: 'showOutdoorSilentMode',
    dataPoint: 'outdoorSilentMode',
    onValue: DaikinOutdoorSilentModes.ON,
    offValue: DaikinOutdoorSilentModes.OFF,
    capability: 'hasOutdoorSilentMode',
  } as const;
}
