/**
 * HAP write helper
 *
 * Every HomeKit setter that talks to the Daikin cloud follows the same shape:
 * run the write, schedule a (debounced) device refresh so the cache catches up
 * with the cloud, and on failure log a warning and throw
 * HapStatusError(SERVICE_COMMUNICATION_FAILURE) so HomeKit shows "No Response"
 * instead of Homebridge logging "plugin threw an error".
 */

import type { DaikinCloudPlatform } from '../platform';
import { toMessage } from './errors';

export type HapWritePlatform = Pick<DaikinCloudPlatform, 'log' | 'api' | 'forceUpdateDevices'>;

export interface HapWriteOptions {
  /** Schedule a device refresh after a successful write (default: true). */
  refresh?: boolean;
}

/**
 * Run `op` as a HomeKit-initiated device write.
 *
 * @param label - Prefix for the failure log line, e.g. `[Living room] CoolingThresholdTemperature`.
 */
export async function withHapWrite<T>(
  platform: HapWritePlatform,
  label: string,
  op: () => Promise<T>,
  options: HapWriteOptions = {},
): Promise<T> {
  let result: T;
  try {
    result = await op();
  } catch (e) {
    platform.log.warn(`${label}: write failed: ${toMessage(e)}`);
    throw new platform.api.hap.HapStatusError(platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }
  if (options.refresh !== false) {
    platform.forceUpdateDevices();
  }
  return result;
}
