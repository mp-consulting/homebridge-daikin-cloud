/**
 * Device Documentation
 *
 * Utility for generating human-readable capability documentation from device data.
 * Useful for debugging and understanding what features a device supports.
 */

import type { DeviceCapabilities } from '../types';

/**
 * Generate a compact summary of device capabilities.
 */
export function getCapabilitySummary(capabilities: DeviceCapabilities): string {
  const features: string[] = [];

  if (capabilities.hasPowerfulMode) {
    features.push('powerful');
  }
  if (capabilities.hasEconoMode) {
    features.push('econo');
  }
  if (capabilities.hasStreamerMode) {
    features.push('streamer');
  }
  if (capabilities.hasOutdoorSilentMode) {
    features.push('outdoor-silent');
  }
  if (capabilities.hasIndoorSilentMode) {
    features.push('indoor-silent');
  }
  if (capabilities.hasFanControl) {
    features.push('fan-speed');
  }
  if (capabilities.hasSwingModeVertical || capabilities.hasSwingModeHorizontal) {
    features.push('swing');
  }
  if (capabilities.hasDryOperationMode) {
    features.push('dry-mode');
  }
  if (capabilities.hasFanOnlyOperationMode) {
    features.push('fan-only');
  }

  return features.length > 0 ? features.join(', ') : 'basic';
}
