/**
 * Econo Mode Feature
 *
 * Enables/disables the economy mode on the device.
 */

import { OnOffDataPointFeature } from '../on-off-data-point-feature';
import { DaikinEconoModes } from '../../types';

export class EconoModeFeature extends OnOffDataPointFeature {
  protected readonly spec = {
    name: 'Econo mode',
    subtype: 'econo_mode',
    configKey: 'showEconoMode',
    dataPoint: 'econoMode',
    onValue: DaikinEconoModes.ON,
    offValue: DaikinEconoModes.OFF,
    capability: 'hasEconoMode',
  } as const;
}
