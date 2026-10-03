/**
 * Dry Operation Mode Feature
 *
 * Enables/disables the dry operation mode on the device.
 * When disabled, switches back to auto mode.
 */

import { OnOffDataPointFeature } from '../on-off-data-point-feature';
import { DaikinOperationModes } from '../../types';

export class DryOperationModeFeature extends OnOffDataPointFeature {
  protected readonly spec = {
    name: 'Dry operation mode',
    subtype: 'dry_operation_mode',
    configKey: 'showDryMode',
    dataPoint: 'operationMode',
    onValue: DaikinOperationModes.DRY,
    offValue: DaikinOperationModes.AUTO,
    capability: 'hasDryOperationMode',
  } as const;
}
