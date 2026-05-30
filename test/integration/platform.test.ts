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

test('DaikinCloudPlatform excludes device when its raw Daikin device ID is in excludedDevicesByDeviceId', async () => {
  const mockDevice = {
    getId: () => 'efd08509-2edb-41d0-a9ab-ce913323d811',
    getDescription: () => ({ deviceModel: 'Airco' }),
    getData: () => 'MOCK_DATE',
    desc: { managementPoints: [{ embeddedId: 'climateControl', managementPointType: 'climateControl' }] },
  } as unknown as DaikinCloudDevice;

  MockDaikinCloudController.mockImplementation(function(this: any) {
    this.getCloudDevices = vi.fn().mockResolvedValue([mockDevice]);
    this.isAuthenticated = vi.fn().mockReturnValue(true);
    this.on = vi.fn();
    this.updateAllDeviceData = vi.fn().mockResolvedValue(undefined);
  });

  const api = new HomebridgeAPI();
  const registerSpy = vi.spyOn(api, 'registerPlatformAccessories');

  const config = new MockPlatformConfig(true);
  // The custom UI saves the raw Daikin device ID (the value returned by device.getId()).
  (config as any).excludedDevicesByDeviceId = ['efd08509-2edb-41d0-a9ab-ce913323d811'];

  new DaikinCloudPlatform(new Logger(), config, api);
  api.signalFinished();
  await vi.advanceTimersByTimeAsync(100);

  expect(AirConditioningAccessory).not.toHaveBeenCalled();
  expect(registerSpy).not.toHaveBeenCalled();
});

test('DaikinCloudPlatform registers the accessory when its raw device ID is NOT in excludedDevicesByDeviceId', async () => {
  const mockDevice = {
    getId: () => 'efd08509-2edb-41d0-a9ab-ce913323d811',
    getDescription: () => ({ deviceModel: 'Airco' }),
    getData: () => 'MOCK_DATE',
    desc: { managementPoints: [{ embeddedId: 'climateControl', managementPointType: 'climateControl' }] },
  } as unknown as DaikinCloudDevice;

  MockDaikinCloudController.mockImplementation(function(this: any) {
    this.getCloudDevices = vi.fn().mockResolvedValue([mockDevice]);
    this.isAuthenticated = vi.fn().mockReturnValue(true);
    this.on = vi.fn();
    this.updateAllDeviceData = vi.fn().mockResolvedValue(undefined);
  });

  const api = new HomebridgeAPI();
  const registerSpy = vi.spyOn(api, 'registerPlatformAccessories');

  const config = new MockPlatformConfig(true);
  // A HAP UUID in the config must NOT match — only raw Daikin device IDs are honoured.
  (config as any).excludedDevicesByDeviceId = [api.hap.uuid.generate('efd08509-2edb-41d0-a9ab-ce913323d811')];

  new DaikinCloudPlatform(new Logger(), config, api);
  api.signalFinished();
  await vi.advanceTimersByTimeAsync(100);

  expect(AirConditioningAccessory).toHaveBeenCalled();
  expect(registerSpy).toHaveBeenCalled();
});

test('forceUpdateDevices debounces rapid changes into a single poll fired after the last change', async () => {
  const mockDevice = {
    getId: () => 'MOCK_ID',
    getDescription: () => ({ deviceModel: 'Airco' }),
    getData: () => 'MOCK_DATE',
    desc: { managementPoints: [{ embeddedId: 'climateControl', managementPointType: 'climateControl' }] },
  } as unknown as DaikinCloudDevice;

  MockDaikinCloudController.mockImplementation(function(this: any) {
    this.getCloudDevices = vi.fn().mockResolvedValue([mockDevice]);
    this.isAuthenticated = vi.fn().mockReturnValue(true);
    this.on = vi.fn();
    this.updateAllDeviceData = vi.fn().mockResolvedValue(undefined);
  });

  const api = new HomebridgeAPI();
  const config = new MockPlatformConfig(true);
  (config as any).forceUpdateDelay = 10000;

  const platform = new DaikinCloudPlatform(new Logger(), config, api);
  api.signalFinished();
  await vi.advanceTimersByTimeAsync(100);

  const updateSpy = (platform.controller as any).updateAllDeviceData as ReturnType<typeof vi.fn>;
  updateSpy.mockClear();

  // Three rapid SETs, each within the 10s debounce window of the previous one.
  platform.forceUpdateDevices();
  await vi.advanceTimersByTimeAsync(3000);
  platform.forceUpdateDevices();
  await vi.advanceTimersByTimeAsync(3000);
  platform.forceUpdateDevices();

  // 9s after the last call the timer has not yet elapsed (it was reset each time).
  await vi.advanceTimersByTimeAsync(9000);
  expect(updateSpy).not.toHaveBeenCalled();

  // The poll fires exactly once, 10s after the *last* change.
  await vi.advanceTimersByTimeAsync(1000);
  expect(updateSpy).toHaveBeenCalledTimes(1);
});

test('forceUpdateDevices performs a single poll for an isolated change', async () => {
  const mockDevice = {
    getId: () => 'MOCK_ID',
    getDescription: () => ({ deviceModel: 'Airco' }),
    getData: () => 'MOCK_DATE',
    desc: { managementPoints: [{ embeddedId: 'climateControl', managementPointType: 'climateControl' }] },
  } as unknown as DaikinCloudDevice;

  MockDaikinCloudController.mockImplementation(function(this: any) {
    this.getCloudDevices = vi.fn().mockResolvedValue([mockDevice]);
    this.isAuthenticated = vi.fn().mockReturnValue(true);
    this.on = vi.fn();
    this.updateAllDeviceData = vi.fn().mockResolvedValue(undefined);
  });

  const api = new HomebridgeAPI();
  const config = new MockPlatformConfig(true);
  (config as any).forceUpdateDelay = 10000;

  const platform = new DaikinCloudPlatform(new Logger(), config, api);
  api.signalFinished();
  await vi.advanceTimersByTimeAsync(100);

  const updateSpy = (platform.controller as any).updateAllDeviceData as ReturnType<typeof vi.fn>;
  updateSpy.mockClear();

  platform.forceUpdateDevices();
  await vi.advanceTimersByTimeAsync(10000);

  expect(updateSpy).toHaveBeenCalledTimes(1);
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
