import { vi } from 'vitest';
import { HomebridgeAPI } from 'homebridge/lib/api.js';
import { withHapWrite } from '../../../src/utils/hap-write';
import type { HapWritePlatform } from '../../../src/utils/hap-write';

const buildPlatform = () => {
  const api = new HomebridgeAPI();
  const platform = {
    log: { warn: vi.fn() },
    api,
    forceUpdateDevices: vi.fn(),
  };
  return { platform, typed: platform as unknown as HapWritePlatform, api };
};

describe('withHapWrite', () => {
  it('returns the result and schedules a device refresh on success', async () => {
    const { platform, typed } = buildPlatform();
    await expect(withHapWrite(typed, '[Room] Active', async () => 42)).resolves.toBe(42);
    expect(platform.forceUpdateDevices).toHaveBeenCalledTimes(1);
    expect(platform.log.warn).not.toHaveBeenCalled();
  });

  it('skips the refresh when asked to', async () => {
    const { platform, typed } = buildPlatform();
    await withHapWrite(typed, '[Room] Firmware', async () => undefined, { refresh: false });
    expect(platform.forceUpdateDevices).not.toHaveBeenCalled();
  });

  it('logs the error message and throws SERVICE_COMMUNICATION_FAILURE on failure', async () => {
    const { platform, typed, api } = buildPlatform();
    const error = await withHapWrite(typed, '[Room] Active', async () => {
      throw new Error('offline');
    }).catch(e => e);

    expect(error).toBeInstanceOf(api.hap.HapStatusError);
    expect(error.hapStatus).toBe(api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    expect(platform.log.warn).toHaveBeenCalledWith('[Room] Active: write failed: offline');
    expect(platform.forceUpdateDevices).not.toHaveBeenCalled();
  });
});
