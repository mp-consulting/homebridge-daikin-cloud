import { vi } from 'vitest';
import { HomebridgeAPI } from 'homebridge/lib/api.js';
import { Logger } from 'homebridge/lib/logger.js';
import { DaikinCloudPlatform } from '../../src/platform';
import { MockPlatformConfig } from '../mocks';

/**
 * The HAP library the plugin uses at runtime (homebridge's own hap-nodejs build).
 * Tests must use it rather than the standalone `hap-nodejs` package, whose
 * Service/Characteristic classes are different (and differently typed).
 */
export const hap = new HomebridgeAPI().hap;

/**
 * Registers per-test fake timers, so the platform's setInterval/setTimeout
 * (polling, debounced refreshes) never keep a test alive or leak between tests.
 */
export function useFakeTimersPerTest(): void {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });
}

/**
 * A real HomebridgeAPI. Its storage path is a per-file temp directory set up by
 * test/helpers/isolated-storage.setup.ts, never the real ~/.homebridge.
 */
export function createTestApi(): HomebridgeAPI {
  return new HomebridgeAPI();
}

/**
 * Builds a DaikinCloudPlatform from MockPlatformConfig (showExtraFeatures off by
 * default) with `config` merged on top.
 */
export function createTestPlatform(
  config: Record<string, unknown> = {},
  api: HomebridgeAPI = createTestApi(),
): DaikinCloudPlatform {
  return new DaikinCloudPlatform(new Logger(), Object.assign(new MockPlatformConfig(), config), api);
}
