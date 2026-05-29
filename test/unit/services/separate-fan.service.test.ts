import { vi } from 'vitest';
import { ClimateControlService } from '../../../src/services';
import type { DaikinApi } from '../../../src/api';
import { DaikinCloudDevice } from '../../../src/api';
import { MockPlatformConfig } from '../../mocks';
import type { DaikinCloudAccessoryContext } from '../../../src/platform';
import { DaikinCloudPlatform } from '../../../src/platform';
import { PlatformAccessory } from 'homebridge/lib/platformAccessory';
import { Characteristic, Service, uuid } from 'hap-nodejs';
import { dx4Airco } from '../../fixtures/dx4-airco';
import { dx23Airco } from '../../fixtures/dx23-airco';

import { HomebridgeAPI } from 'homebridge/lib/api.js';
import { Logger } from 'homebridge/lib/logger.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const FAN_SUBTYPE = 'separate_fan';

const buildService = (
  fixture: unknown,
  showSeparateFanControl: boolean,
): { service: ClimateControlService; accessory: PlatformAccessory<DaikinCloudAccessoryContext>; setDataMock: ReturnType<typeof vi.fn> } => {
  const setDataMock = vi.fn().mockResolvedValue(undefined);
  const mockApi = { updateDevice: vi.fn().mockResolvedValue(undefined) } as unknown as DaikinApi;
  const device = new DaikinCloudDevice(JSON.parse(JSON.stringify(fixture)) as any, mockApi);
  device.setData = setDataMock as unknown as typeof device.setData;

  const accessory = new PlatformAccessory<DaikinCloudAccessoryContext>('TEST', uuid.generate(device.getId()));
  accessory.context.device = device;

  const config = new MockPlatformConfig(false);
  (config as any).showSeparateFanControl = showSeparateFanControl;

  const platform = new DaikinCloudPlatform(new Logger(), config, new HomebridgeAPI());
  const service = new ClimateControlService(platform, accessory, 'climateControl');
  return { service, accessory, setDataMock };
};

describe('ClimateControlService — standalone Fan service', () => {
  it('does NOT add a Fanv2 service when showSeparateFanControl is disabled (dx4)', () => {
    const { accessory } = buildService(dx4Airco, false);
    expect(accessory.getServiceById(Service.Fanv2, FAN_SUBTYPE)).toBeUndefined();
  });

  it('adds a Fanv2 service with fan speed and oscillation when enabled (dx4)', () => {
    const { accessory } = buildService(dx4Airco, true);
    const fan = accessory.getServiceById(Service.Fanv2, FAN_SUBTYPE);
    expect(fan).toBeDefined();
    expect(fan!.testCharacteristic(Characteristic.RotationSpeed)).toBe(true);
    expect(fan!.testCharacteristic(Characteristic.SwingMode)).toBe(true);
    expect(fan!.testCharacteristic(Characteristic.Active)).toBe(true);
  });

  it('maps the Fanv2 RotationSpeed to a 0-100% slider matching the device scale (dx4 maxValue=5)', () => {
    const { accessory } = buildService(dx4Airco, true);
    const fan = accessory.getServiceById(Service.Fanv2, FAN_SUBTYPE);
    const rotationChar = fan!.getCharacteristic(Characteristic.RotationSpeed);
    expect(rotationChar.props.minValue).toBe(0);
    expect(rotationChar.props.maxValue).toBe(100);
    expect(rotationChar.props.minStep).toBe(20);
  });

  it('omits SwingMode on the Fanv2 when the device has no fanDirection (dx23)', () => {
    const { accessory } = buildService(dx23Airco, true);
    const fan = accessory.getServiceById(Service.Fanv2, FAN_SUBTYPE);
    // dx23 still exposes a fixed fan speed, so the Fan tile is created for the slider…
    expect(fan).toBeDefined();
    // …but oscillation must not be exposed without fanDirection data.
    expect(fan!.testCharacteristic(Characteristic.SwingMode)).toBe(false);
  });

  it('routes Fanv2 RotationSpeed writes through the same handler as the HeaterCooler (dx4)', async () => {
    const { accessory, setDataMock } = buildService(dx4Airco, true);
    const fan = accessory.getServiceById(Service.Fanv2, FAN_SUBTYPE);
    setDataMock.mockClear();

    // 60% of 5 → device speed 3, written to the fixed-speed path.
    await fan!.getCharacteristic(Characteristic.RotationSpeed).handleSetRequest(60, undefined as any);

    expect(setDataMock).toHaveBeenCalledWith(
      'climateControl',
      'fanControl',
      '/operationModes/heating/fanSpeed/modes/fixed',
      3,
    );
  });

  it('routes Fanv2 SwingMode writes to both fan-direction axes (dx4)', async () => {
    const { accessory, setDataMock } = buildService(dx4Airco, true);
    const fan = accessory.getServiceById(Service.Fanv2, FAN_SUBTYPE);
    setDataMock.mockClear();

    await fan!.getCharacteristic(Characteristic.SwingMode).handleSetRequest(1, undefined as any);

    expect(setDataMock).toHaveBeenCalledWith(
      'climateControl', 'fanControl',
      '/operationModes/heating/fanDirection/horizontal/currentMode', 'swing',
    );
    expect(setDataMock).toHaveBeenCalledWith(
      'climateControl', 'fanControl',
      '/operationModes/heating/fanDirection/vertical/currentMode', 'swing',
    );
  });
});
