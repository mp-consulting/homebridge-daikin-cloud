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
  it('skips the redundant currentMode write when currentMode is already "fixed" (dx4 heating)', async () => {
    const { service, setDataMock } = buildService(dx4Airco);
    setDataMock.mockClear();

    await service.handleRotationSpeedSet(3);

    // Only one write expected: the new fixed speed value.
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
    // Pre-set the operation mode to auto where currentMode is 'auto' by default.
    fixture.managementPoints[1].operationMode.value = 'auto';
    const { service, setDataMock } = buildService(fixture);
    setDataMock.mockClear();

    await service.handleRotationSpeedSet(2);

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

  it('skips any write when the current operation mode does not support a fixed fan speed (dry on dx4)', async () => {
    const fixture = JSON.parse(JSON.stringify(dx4Airco));
    // dry on dx4 only allows currentMode 'auto' and has no modes.fixed
    delete fixture.managementPoints[1].fanControl.value.operationModes.dry.fanSpeed.modes;
    fixture.managementPoints[1].operationMode.value = 'dry';

    const { service, setDataMock } = buildService(fixture);
    setDataMock.mockClear();

    await service.handleRotationSpeedSet(2);

    // No API write should be issued, preventing a guaranteed-fail PATCH against Daikin.
    expect(setDataMock).not.toHaveBeenCalled();
  });
});
