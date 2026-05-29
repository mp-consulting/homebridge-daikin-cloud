import { vi } from 'vitest';
import { ClimateControlService } from '../../../src/services';
import type { DaikinApi } from '../../../src/api';
import { DaikinCloudDevice } from '../../../src/api';
import { MockPlatformConfig } from '../../mocks';
import type { DaikinCloudAccessoryContext } from '../../../src/platform';
import { DaikinCloudPlatform } from '../../../src/platform';
import { PlatformAccessory } from 'homebridge/lib/platformAccessory';
import { Characteristic, uuid } from 'hap-nodejs';
import { dx4Airco } from '../../fixtures/dx4-airco';

import { HomebridgeAPI } from 'homebridge/lib/api.js';
import { Logger } from 'homebridge/lib/logger.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

// Note: setData is NOT mocked here — we want the real optimistic cache write to
// run so the Auto fan mode switch reconciles. Only the underlying API call is mocked.
const buildService = (): { service: ClimateControlService; accessory: PlatformAccessory<DaikinCloudAccessoryContext> } => {
  const fixture = JSON.parse(JSON.stringify(dx4Airco));
  // Start in auto fan mode so the Auto fan switch is ON before we move the slider.
  fixture.managementPoints[1].fanControl.value.operationModes.heating.fanSpeed.currentMode.value = 'auto';

  const mockApi = { updateDevice: vi.fn().mockResolvedValue(undefined) } as unknown as DaikinApi;
  const device = new DaikinCloudDevice(fixture as any, mockApi);

  const accessory = new PlatformAccessory<DaikinCloudAccessoryContext>('TEST', uuid.generate(device.getId()));
  accessory.context.device = device;

  // showExtraFeatures = true → the Auto fan mode switch is created.
  const platform = new DaikinCloudPlatform(new Logger(), new MockPlatformConfig(true), new HomebridgeAPI());
  const service = new ClimateControlService(platform, accessory, 'climateControl');
  return { service, accessory };
};

describe('ClimateControlService — Auto fan switch syncs when the slider moves', () => {
  it('Auto fan mode switch turns off immediately after a RotationSpeed change', async () => {
    const { service, accessory } = buildService();
    const autoSwitch = accessory.getService('Auto fan mode');
    expect(autoSwitch).toBeDefined();

    // Precondition: switch reflects auto mode (on).
    autoSwitch!.getCharacteristic(Characteristic.On).updateValue(true);
    expect(autoSwitch!.getCharacteristic(Characteristic.On).value).toBe(true);

    // Move the fan speed slider — this flips currentMode to 'fixed'.
    await service.handleRotationSpeedSet(60);

    // The switch must reflect the change right away, without waiting for a poll.
    expect(autoSwitch!.getCharacteristic(Characteristic.On).value).toBe(false);
  });
});
