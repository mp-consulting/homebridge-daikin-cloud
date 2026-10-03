/**
 * Powerful Mode Feature
 *
 * Enables/disables the powerful mode on the device. Used for both the
 * climateControl and the Altherma domesticHotWaterTank management points.
 */

import { OnOffDataPointFeature } from '../on-off-data-point-feature';
import { DaikinPowerfulModes } from '../../types';

export class PowerfulModeFeature extends OnOffDataPointFeature {
  protected readonly spec = {
    name: 'Powerful mode',
    subtype: 'powerful_mode',
    configKey: 'showPowerfulMode',
    dataPoint: 'powerfulMode',
    onValue: DaikinPowerfulModes.ON,
    offValue: DaikinPowerfulModes.OFF,
    capability: 'hasPowerfulMode',
  } as const;
}
