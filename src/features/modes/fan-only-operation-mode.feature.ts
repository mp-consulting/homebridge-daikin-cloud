/**
 * Fan Only Operation Mode Feature
 *
 * Enables/disables the fan only operation mode on the device.
 * When disabled, switches back to auto mode.
 */

import { OnOffDataPointFeature } from '../on-off-data-point-feature';
import { DaikinOperationModes } from '../../types';

export class FanOnlyOperationModeFeature extends OnOffDataPointFeature {
  protected readonly spec = {
    name: 'Fan only operation mode',
    subtype: 'fan_only_operation_mode',
    configKey: 'showFanOnlyMode',
    dataPoint: 'operationMode',
    onValue: DaikinOperationModes.FAN_ONLY,
    offValue: DaikinOperationModes.AUTO,
    capability: 'hasFanOnlyOperationMode',
  } as const;
}
