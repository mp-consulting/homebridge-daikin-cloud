import { vi } from 'vitest';
import { HolidayModeFeature } from '../../../src/features/modes';
import type { DaikinApi } from '../../../src/api';
import { DaikinCloudDevice } from '../../../src/api';
import { MockPlatformConfig } from '../../mocks';
import type { DaikinCloudAccessoryContext } from '../../../src/platform';
import { DaikinCloudPlatform } from '../../../src/platform';
import { PlatformAccessory } from 'homebridge/lib/platformAccessory';
import { Service, uuid } from 'hap-nodejs';
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

const buildFeature = (
  fixture: unknown,
  showHolidayMode: boolean,
): {
  feature: HolidayModeFeature;
  accessory: PlatformAccessory<DaikinCloudAccessoryContext>;
  setHolidayModeMock: ReturnType<typeof vi.fn>;
} => {
  const setHolidayModeMock = vi.fn().mockResolvedValue(undefined);
  const mockApi = { updateDevice: vi.fn().mockResolvedValue(undefined) } as unknown as DaikinApi;
  const device = new DaikinCloudDevice(JSON.parse(JSON.stringify(fixture)) as any, mockApi);
  device.setHolidayMode = setHolidayModeMock as unknown as typeof device.setHolidayMode;

  const accessory = new PlatformAccessory<DaikinCloudAccessoryContext>('TEST', uuid.generate(device.getId()));
  accessory.context.device = device;

  const config = new MockPlatformConfig(false);
  (config as any).showHolidayMode = showHolidayMode;

  const platform = new DaikinCloudPlatform(new Logger(), config, new HomebridgeAPI());
  const feature = new HolidayModeFeature(platform, accessory, 'climateControl');
  return { feature, accessory, setHolidayModeMock };
};

/** Deep-clone dx4 and strip the holidayMode characteristic to simulate an unsupported device. */
const dx4WithoutHolidayMode = (): unknown => {
  const clone = JSON.parse(JSON.stringify(dx4Airco));
  const mp = clone.managementPoints.find((m: any) => m.embeddedId === 'climateControl');
  delete mp.holidayMode;
  return clone;
};

describe('HolidayModeFeature — support detection', () => {
  it('is supported on a device with holidayMode data (dx4)', () => {
    const { feature } = buildFeature(dx4Airco, true);
    expect(feature.isSupported()).toBe(true);
  });

  it('is not supported on a device without holidayMode data', () => {
    const { feature } = buildFeature(dx4WithoutHolidayMode(), true);
    expect(feature.isSupported()).toBe(false);
  });

  it('exposes a Switch service when supported and enabled (dx4)', () => {
    const { feature, accessory } = buildFeature(dx4Airco, true);
    feature.setup();
    expect(accessory.getService('Holiday mode')).toBeDefined();
    expect(accessory.getService('Holiday mode')!.UUID).toBe(Service.Switch.UUID);
  });

  it('does not expose a Switch service when disabled (dx4)', () => {
    const { feature, accessory } = buildFeature(dx4Airco, false);
    feature.setup();
    expect(accessory.getService('Holiday mode')).toBeUndefined();
  });
});

describe('HolidayModeFeature — get/set', () => {
  it('reports OFF when holiday mode is disabled (dx4 default)', async () => {
    const { feature } = buildFeature(dx4Airco, true);
    await expect(feature.handleGet()).resolves.toBe(false);
  });

  it('reports ON when holiday mode is enabled', async () => {
    const fixture = JSON.parse(JSON.stringify(dx4Airco));
    const mp = fixture.managementPoints.find((m: any) => m.embeddedId === 'climateControl');
    mp.holidayMode.value.enabled = true;
    const { feature } = buildFeature(fixture, true);
    await expect(feature.handleGet()).resolves.toBe(true);
  });

  it('turns holiday mode on via device.setHolidayMode (dx4)', async () => {
    const { feature, setHolidayModeMock } = buildFeature(dx4Airco, true);
    setHolidayModeMock.mockClear();

    await feature.handleSet(true);

    expect(setHolidayModeMock).toHaveBeenCalledWith('climateControl', true);
  });

  it('turns holiday mode off via device.setHolidayMode (dx4)', async () => {
    const { feature, setHolidayModeMock } = buildFeature(dx4Airco, true);
    setHolidayModeMock.mockClear();

    await feature.handleSet(false);

    expect(setHolidayModeMock).toHaveBeenCalledWith('climateControl', false);
  });

  it('surfaces a HAP communication error when the write fails', async () => {
    const { feature, setHolidayModeMock } = buildFeature(dx4Airco, true);
    setHolidayModeMock.mockRejectedValueOnce(new Error('boom'));

    await expect(feature.handleSet(true)).rejects.toThrow();
  });
});
