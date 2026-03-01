import { vi } from 'vitest';
import { DaikinCloudPlatform } from '../../src/platform';
import { MockPlatformConfig } from '../mocks';
import type { DaikinCloudDevice } from '../../src/api';
import { DaikinCloudController } from '../../src/api';
import { AirConditioningAccessory, AlthermaAccessory } from '../../src/accessories';
import { HomebridgeAPI } from 'homebridge/lib/api.js';
import { Logger } from 'homebridge/lib/logger.js';

// Use vi.hoisted so the mock is available when vi.mock factory runs (hoisted)
const { MockDaikinCloudController, MockAirConditioningAccessory, MockAlthermaAccessory } = vi.hoisted(() => ({
  MockDaikinCloudController: vi.fn(),
  MockAirConditioningAccessory: vi.fn(),
  MockAlthermaAccessory: vi.fn(),
}));

vi.mock('../../src/api/daikin-controller', () => ({
  DaikinCloudController: MockDaikinCloudController,
}));
vi.mock('homebridge');
vi.mock('../../src/accessories/air-conditioning-accessory', () => ({
  AirConditioningAccessory: MockAirConditioningAccessory,
}));
vi.mock('../../src/accessories/altherma-accessory', () => ({
  AlthermaAccessory: MockAlthermaAccessory,
}));

// Use fake timers to prevent tests from hanging due to setInterval/setTimeout in platform
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.resetAllMocks();
});

test('Initialize platform', async () => {
  const api = new HomebridgeAPI();
  const platform = new DaikinCloudPlatform(new Logger(), new MockPlatformConfig(), api);

  expect(DaikinCloudController).toHaveBeenCalledWith(expect.objectContaining({
    'authMode': 'developer_portal',
    'clientId': 'CLIENT_ID',
    'clientSecret': 'CLIENT_SECRET',
    'callbackServerExternalAddress': 'SERVER_EXTERNAL_ADDRESS',
    'callbackServerPort': 'SERVER_PORT',
    'oidcCallbackServerBindAddr': 'SERVER_BIND_ADDRESS',
    'tokenFilePath': `${api.user.storagePath()}/.daikin-controller-cloud-tokenset`,
  }));
  expect(platform.updateIntervalDelay).toBe(900000);
});

test('DaikinCloudPlatform with new Aircondition accessory', async () => {
  const mockDevice = {
    getId: () => 'MOCK_ID',
    getDescription: () => ({
      deviceModel: 'Airco',
    }),
    getData: () => 'MOCK_DATE',
    desc: {
      managementPoints: [
        {
          'embeddedId': 'climateControl',
          'managementPointType': 'climateControl',
        },
      ],
    },
  } as unknown as DaikinCloudDevice;

  // Mock the constructor to set up getCloudDevices on the instance
  MockDaikinCloudController.mockImplementation(function(this: any) {
    this.getCloudDevices = vi.fn().mockResolvedValue([mockDevice]);
    this.isAuthenticated = vi.fn().mockReturnValue(true);
    this.on = vi.fn();
    this.updateAllDeviceData = vi.fn().mockResolvedValue(undefined);
  });

  const api = new HomebridgeAPI();

  const registerPlatformAccessoriesSpy = vi.spyOn(api, 'registerPlatformAccessories');

  new DaikinCloudPlatform(new Logger(), new MockPlatformConfig(true), api);
  api.signalFinished();

  // Wait for async device discovery to complete using fake timers
  await vi.advanceTimersByTimeAsync(100);

  expect(AirConditioningAccessory).toHaveBeenCalled();
  expect(AlthermaAccessory).not.toHaveBeenCalled();
  expect(registerPlatformAccessoriesSpy).toHaveBeenCalledWith('@mp-consulting/homebridge-daikin-cloud', 'DaikinCloud', expect.anything());
});

test('DaikinCloudPlatform with new Altherma accessory', async () => {
  const mockDevice = {
    getId: () => 'MOCK_ID',
    getDescription: () => ({
      deviceModel: 'Altherma',
    }),
    getData: () => 'MOCK_DATE',
    desc: {
      managementPoints: [
        {
          'embeddedId': 'climateControl',
          'managementPointType': 'climateControl',
        },
      ],
    },
  } as unknown as DaikinCloudDevice;

  // Mock the constructor to set up getCloudDevices on the instance
  MockDaikinCloudController.mockImplementation(function(this: any) {
    this.getCloudDevices = vi.fn().mockResolvedValue([mockDevice]);
    this.isAuthenticated = vi.fn().mockReturnValue(true);
    this.on = vi.fn();
    this.updateAllDeviceData = vi.fn().mockResolvedValue(undefined);
  });

  const api = new HomebridgeAPI();

  const registerPlatformAccessoriesSpy = vi.spyOn(api, 'registerPlatformAccessories');

  new DaikinCloudPlatform(new Logger(), new MockPlatformConfig(true), api);
  api.signalFinished();

  // Wait for async device discovery to complete using fake timers
  await vi.advanceTimersByTimeAsync(100);

  expect(AlthermaAccessory).toHaveBeenCalled();
  expect(AirConditioningAccessory).not.toHaveBeenCalled();
  expect(registerPlatformAccessoriesSpy).toHaveBeenCalledWith('@mp-consulting/homebridge-daikin-cloud', 'DaikinCloud', expect.anything());
});
