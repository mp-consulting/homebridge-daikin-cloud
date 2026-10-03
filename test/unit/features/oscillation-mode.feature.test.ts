import { vi } from 'vitest';
import { OscillationModeFeature } from '../../../src/features/modes';
import type { DaikinApi } from '../../../src/api';
import { DaikinCloudDevice } from '../../../src/api';
import type { DaikinCloudAccessoryContext } from '../../../src/platform';
import { PlatformAccessory } from 'homebridge/lib/platformAccessory';
import { dx4Airco } from '../../fixtures/dx4-airco';
import { dx23Airco } from '../../fixtures/dx23-airco';
import { createTestPlatform, hap, useFakeTimersPerTest } from '../../helpers/platform';

const { Service, uuid } = hap;

useFakeTimersPerTest();

const buildFeature = (
  fixture: unknown,
  showOscillationSwitch: boolean,
): { feature: OscillationModeFeature; accessory: PlatformAccessory<DaikinCloudAccessoryContext>; setDataMock: ReturnType<typeof vi.fn> } => {
  const setDataMock = vi.fn().mockResolvedValue(undefined);
  const mockApi = { updateDevice: vi.fn().mockResolvedValue(undefined) } as unknown as DaikinApi;
  const device = new DaikinCloudDevice(JSON.parse(JSON.stringify(fixture)) as any, mockApi);
  device.setData = setDataMock as unknown as typeof device.setData;

  const accessory = new PlatformAccessory<DaikinCloudAccessoryContext>('TEST', uuid.generate(device.getId()));
  accessory.context.device = device;

  const platform = createTestPlatform({ showOscillationSwitch });
  const feature = new OscillationModeFeature(platform, accessory, 'climateControl');
  return { feature, accessory, setDataMock };
};

describe('OscillationModeFeature — support detection', () => {
  it('is supported on a device with fanDirection data (dx4)', () => {
    const { feature } = buildFeature(dx4Airco, true);
    expect(feature.isSupported()).toBe(true);
  });

  it('is not supported on a device without fanDirection data (dx23)', () => {
    const { feature } = buildFeature(dx23Airco, false);
    expect(feature.isSupported()).toBe(false);
  });

  it('exposes a Switch service when supported and enabled (dx4)', () => {
    const { feature, accessory } = buildFeature(dx4Airco, true);
    feature.setup();
    expect(accessory.getService('Oscillation')).toBeDefined();
    expect(accessory.getService('Oscillation')!.UUID).toBe(Service.Switch.UUID);
  });

  it('does not expose a Switch service when disabled (dx4)', () => {
    const { feature, accessory } = buildFeature(dx4Airco, false);
    feature.setup();
    expect(accessory.getService('Oscillation')).toBeUndefined();
  });
});

describe('OscillationModeFeature — get/set', () => {
  it('reports OFF when both axes are stopped (dx4 default)', async () => {
    const { feature } = buildFeature(dx4Airco, true);
    await expect(feature.handleGet()).resolves.toBe(false);
  });

  it('turns oscillation on by writing swing to both axes (dx4)', async () => {
    const { feature, setDataMock } = buildFeature(dx4Airco, true);
    setDataMock.mockClear();

    await feature.handleSet(true);

    expect(setDataMock).toHaveBeenCalledWith(
      'climateControl', 'fanControl',
      '/operationModes/heating/fanDirection/horizontal/currentMode', 'swing',
    );
    expect(setDataMock).toHaveBeenCalledWith(
      'climateControl', 'fanControl',
      '/operationModes/heating/fanDirection/vertical/currentMode', 'swing',
    );
  });

  it('turns oscillation off by writing stop to both axes (dx4 swinging)', async () => {
    const fixture = JSON.parse(JSON.stringify(dx4Airco));
    const heating = fixture.managementPoints[1].fanControl.value.operationModes.heating.fanDirection;
    heating.horizontal.currentMode.value = 'swing';
    heating.vertical.currentMode.value = 'swing';
    const { feature, setDataMock } = buildFeature(fixture, true);
    setDataMock.mockClear();

    await expect(feature.handleGet()).resolves.toBe(true);
    await feature.handleSet(false);

    expect(setDataMock).toHaveBeenCalledWith(
      'climateControl', 'fanControl',
      '/operationModes/heating/fanDirection/horizontal/currentMode', 'stop',
    );
    expect(setDataMock).toHaveBeenCalledWith(
      'climateControl', 'fanControl',
      '/operationModes/heating/fanDirection/vertical/currentMode', 'stop',
    );
  });

  it('skips the write when oscillation is already off (dx4 default)', async () => {
    const { feature, setDataMock } = buildFeature(dx4Airco, true);
    setDataMock.mockClear();

    await feature.handleSet(false);

    expect(setDataMock).not.toHaveBeenCalled();
  });

  it('only writes the axis that differs from the requested state', async () => {
    const fixture = JSON.parse(JSON.stringify(dx4Airco));
    fixture.managementPoints[1].fanControl.value.operationModes.heating.fanDirection.vertical.currentMode.value = 'swing';
    const { feature, setDataMock } = buildFeature(fixture, true);
    setDataMock.mockClear();

    await feature.handleSet(true);

    expect(setDataMock).toHaveBeenCalledTimes(1);
    expect(setDataMock).toHaveBeenCalledWith(
      'climateControl', 'fanControl',
      '/operationModes/heating/fanDirection/horizontal/currentMode', 'swing',
    );
  });
});
