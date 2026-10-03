import { vi, describe, it, expect, afterEach } from 'vitest';
import type { PlatformAccessory } from 'homebridge/lib/platformAccessory';
import type { DaikinCloudAccessoryContext } from '../../../src/platform';
import { AirConditioningAccessory } from '../../../src/accessories';
import type { DaikinApi } from '../../../src/api';
import { DaikinCloudDevice } from '../../../src/api';
import { dx4Airco } from '../../fixtures/dx4-airco';
import { createTestApi, createTestPlatform, useFakeTimersPerTest } from '../../helpers/platform';

useFakeTimersPerTest();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AirConditioningAccessory', () => {
  it('pushes current device state into HAP characteristics on construction so HomeKit is correct after a restart', () => {
    const mockApi = { updateDevice: vi.fn().mockResolvedValue(undefined) } as unknown as DaikinApi;
    // The dx4 fixture has the unit powered on (climateControl.onOffMode === 'on').
    const device = new DaikinCloudDevice(JSON.parse(JSON.stringify(dx4Airco)) as never, mockApi);

    const api = createTestApi();
    const platform = createTestPlatform({ showExtraFeatures: true }, api);

    const uuid = api.hap.uuid.generate(device.getId());
    const accessory = new api.platformAccessory('NAME_FOR_TEST', uuid);
    accessory.context.device = device;

    new AirConditioningAccessory(platform, accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);

    // Assert on the cached HAP value (.value) - this is what HomeKit shows on a
    // freshly restored accessory without issuing a fresh read. The device is ON,
    // so Active must already read ACTIVE. Before the startup refresh fix this
    // stayed INACTIVE until the first poll/WebSocket update or a manual toggle.
    const heaterCooler = accessory.getService(api.hap.Service.HeaterCooler);
    expect(heaterCooler).toBeDefined();
    expect(heaterCooler!.getCharacteristic(api.hap.Characteristic.Active).value)
      .toBe(api.hap.Characteristic.Active.ACTIVE);
  });
});
