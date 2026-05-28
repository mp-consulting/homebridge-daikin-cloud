import { vi } from 'vitest';
import { ClimateControlService } from '../../../src/services';
import type { DaikinApi } from '../../../src/api';
import { DaikinCloudDevice } from '../../../src/api';
import { MockPlatformConfig } from '../../mocks';
import type { DaikinCloudAccessoryContext } from '../../../src/platform';
import { DaikinCloudPlatform } from '../../../src/platform';
import { PlatformAccessory } from 'homebridge/lib/platformAccessory';
import { Characteristic, Service, uuid } from 'hap-nodejs';
import { dx23Airco } from '../../fixtures/dx23-airco';
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

const buildService = (fixture: unknown): { service: ClimateControlService; accessory: PlatformAccessory<DaikinCloudAccessoryContext>; setDataMock: ReturnType<typeof vi.fn> } => {
  const setDataMock = vi.fn().mockResolvedValue(undefined);
  const mockApi = { updateDevice: vi.fn().mockResolvedValue(undefined) } as unknown as DaikinApi;
  const device = new DaikinCloudDevice(JSON.parse(JSON.stringify(fixture)) as any, mockApi);
  // Spy on setData to capture writes; the underlying API is mocked too so this is doubly safe.
  device.setData = setDataMock as unknown as typeof device.setData;

  const accessory = new PlatformAccessory<DaikinCloudAccessoryContext>('TEST', uuid.generate(device.getId()));
  accessory.context.device = device;

  const platform = new DaikinCloudPlatform(new Logger(), new MockPlatformConfig(true), new HomebridgeAPI());
  const service = new ClimateControlService(platform, accessory, 'climateControl');
  return { service, accessory, setDataMock };
};

describe('ClimateControlService — SwingMode support detection', () => {
  it('does NOT add the SwingMode characteristic when the device has no fanDirection data (dx23)', () => {
    const { accessory } = buildService(dx23Airco);
    const heaterCooler = accessory.getService(Service.HeaterCooler);
    expect(heaterCooler).toBeDefined();
    // dx23-airco fixture has no fanDirection — SwingMode must not be exposed.
    expect(heaterCooler!.testCharacteristic(Characteristic.SwingMode)).toBe(false);
  });

  it('adds the SwingMode characteristic when the device has fanDirection data (dx4)', () => {
    const { accessory } = buildService(dx4Airco);
    const heaterCooler = accessory.getService(Service.HeaterCooler);
    expect(heaterCooler).toBeDefined();
    expect(heaterCooler!.testCharacteristic(Characteristic.SwingMode)).toBe(true);
  });

  it('hasSwingModeFeature returns false on dx23 (no fanDirection)', () => {
    const { service } = buildService(dx23Airco);
    expect(service.hasSwingModeFeature()).toBe(false);
    expect(service.hasSwingModeVerticalFeature()).toBe(false);
    expect(service.hasSwingModeHorizontalFeature()).toBe(false);
  });

  it('hasSwingModeFeature returns true on dx4 (has both axes)', () => {
    const { service } = buildService(dx4Airco);
    expect(service.hasSwingModeFeature()).toBe(true);
    expect(service.hasSwingModeVerticalFeature()).toBe(true);
    expect(service.hasSwingModeHorizontalFeature()).toBe(true);
  });
});

describe('ClimateControlService — RotationSpeed setter', () => {
  // dx4 fanSpeed.modes.fixed → minValue:1, maxValue:5, stepValue:1.
  // HomeKit sends a 0-100 percentage; we round to the nearest device speed.
  // 60% → 3, 40% → 2, 100% → 5.
  it('skips the redundant currentMode write when currentMode is already "fixed" (dx4 heating)', async () => {
    const { service, setDataMock } = buildService(dx4Airco);
    setDataMock.mockClear();

    // 60% of 5 = 3 → device speed 3.
    await service.handleRotationSpeedSet(60);

    expect(setDataMock).toHaveBeenCalledTimes(1);
    expect(setDataMock).toHaveBeenCalledWith(
      'climateControl',
      'fanControl',
      '/operationModes/heating/fanSpeed/modes/fixed',
      3,
    );
  });

  it('writes currentMode then the speed when the device is not yet in fixed mode', async () => {
    const fixture = JSON.parse(JSON.stringify(dx4Airco));
    fixture.managementPoints[1].operationMode.value = 'auto';
    const { service, setDataMock } = buildService(fixture);
    setDataMock.mockClear();

    // 40% of 5 = 2 → device speed 2.
    await service.handleRotationSpeedSet(40);

    expect(setDataMock).toHaveBeenCalledTimes(2);
    expect(setDataMock).toHaveBeenNthCalledWith(
      1,
      'climateControl',
      'fanControl',
      '/operationModes/auto/fanSpeed/currentMode',
      'fixed',
    );
    expect(setDataMock).toHaveBeenNthCalledWith(
      2,
      'climateControl',
      'fanControl',
      '/operationModes/auto/fanSpeed/modes/fixed',
      2,
    );
  });

  it('maps 100% to the device max (5 on dx4)', async () => {
    const { service, setDataMock } = buildService(dx4Airco);
    setDataMock.mockClear();

    await service.handleRotationSpeedSet(100);

    expect(setDataMock).toHaveBeenCalledWith(
      'climateControl',
      'fanControl',
      '/operationModes/heating/fanSpeed/modes/fixed',
      5,
    );
  });

  it('clamps low percentages to the device minValue', async () => {
    const { service, setDataMock } = buildService(dx4Airco);
    setDataMock.mockClear();

    // 5% of 5 ≈ 0 → clamped up to minValue=1.
    await service.handleRotationSpeedSet(5);

    expect(setDataMock).toHaveBeenCalledWith(
      'climateControl',
      'fanControl',
      '/operationModes/heating/fanSpeed/modes/fixed',
      1,
    );
  });

  it('skips any write when the current operation mode does not support a fixed fan speed (dry on dx4)', async () => {
    const fixture = JSON.parse(JSON.stringify(dx4Airco));
    delete fixture.managementPoints[1].fanControl.value.operationModes.dry.fanSpeed.modes;
    fixture.managementPoints[1].operationMode.value = 'dry';

    const { service, setDataMock } = buildService(fixture);
    setDataMock.mockClear();

    await service.handleRotationSpeedSet(60);

    expect(setDataMock).not.toHaveBeenCalled();
  });
});

describe('ClimateControlService — RotationSpeed getter', () => {
  it('returns the device speed mapped to a percentage of maxValue (dx4 heating)', async () => {
    const { service } = buildService(dx4Airco);
    // dx4 heating fanSpeed.modes.fixed.value = 2, maxValue = 5 → 40%.
    await expect(service.handleRotationSpeedGet()).resolves.toBe(40);
  });
});

describe('ClimateControlService — RotationSpeed characteristic setup', () => {
  it('sets minValue=0 (not stepPercent) so HAP never warns about cached values below the new range', () => {
    const { accessory } = buildService(dx4Airco);
    const heaterCooler = accessory.getService(Service.HeaterCooler);
    const rotationChar = heaterCooler!.getCharacteristic(Characteristic.RotationSpeed);

    // dx4 maxValue=5 → stepPercent=20. minValue MUST be 0 (or below stepPercent)
    // or HAP's setProps validation fires "<cached> exceeded minimum of 20" against
    // any pre-existing characteristic value left over from a prior build.
    expect(rotationChar.props.minValue).toBe(0);
    expect(rotationChar.props.maxValue).toBe(100);
    expect(rotationChar.props.minStep).toBe(20);
  });
});
