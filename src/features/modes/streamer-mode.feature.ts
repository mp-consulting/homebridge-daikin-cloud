/**
 * Streamer Mode Feature
 *
 * Enables/disables the streamer mode on the device.
 */

import { OnOffDataPointFeature } from '../on-off-data-point-feature';
import { DaikinStreamerModes } from '../../types';

export class StreamerModeFeature extends OnOffDataPointFeature {
  protected readonly spec = {
    name: 'Streamer mode',
    subtype: 'streamer_mode',
    configKey: 'showStreamerMode',
    dataPoint: 'streamerMode',
    onValue: DaikinStreamerModes.ON,
    offValue: DaikinStreamerModes.OFF,
    capability: 'hasStreamerMode',
  } as const;
}
