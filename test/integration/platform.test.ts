import { vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import {
  computePollInterval,
  WEBSOCKET_SAFETY_POLL_INTERVAL_MS,
  LOW_QUOTA_POLL_INTERVAL_MS,
} from '../../src/platform';
import type { DaikinCloudDevice } from '../../src/api';
import { DaikinCloudController } from '../../src/api';
import { AirConditioningAccessory, AlthermaAccessory } from '../../src/accessories';
import { createTestApi, createTestPlatform, useFakeTimersPerTest } from '../helpers/platform';

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

/**
 * Make the mocked DaikinCloudController behave like a real EventEmitter with
 * stubbed API methods, so tests can emit controller events.
 */
function mockController(devices: DaikinCloudDevice[], overrides: Record<string, unknown> = {}) {
  MockDaikinCloudController.mockImplementation(function(this: any) {
    EventEmitter.call(this);
    Object.setPrototypeOf(this, EventEmitter.prototype);
    this.getCloudDevices = vi.fn().mockResolvedValue(devices);
    this.isAuthenticated = vi.fn().mockReturnValue(true);
    this.updateAllDeviceData = vi.fn().mockResolvedValue(undefined);
    this.isWebSocketConnected = vi.fn().mockReturnValue(false);
    this.enableWebSocket = vi.fn().mockResolvedValue(undefined);
    this.disableWebSocket = vi.fn();
    this.authenticateMobile = vi.fn().mockResolvedValue({});
    Object.assign(this, overrides);
  });
}

function airco(id = 'MOCK_ID', deviceModel = 'Airco'): DaikinCloudDevice {
  return {
    getId: () => id,
    getDescription: () => ({ deviceModel }),
    getData: () => 'MOCK_DATE',
    desc: { managementPoints: [{ embeddedId: 'climateControl', managementPointType: 'climateControl' }] },
  } as unknown as DaikinCloudDevice;
}

async function startPlatform(config: Record<string, unknown> = {}) {
  const api = createTestApi();
  const platform = createTestPlatform({ showExtraFeatures: true, ...config }, api);
  api.signalFinished();
  await vi.advanceTimersByTimeAsync(100);
  const controller = platform.controller as any;
  return { api, platform, controller, updateSpy: controller.updateAllDeviceData as ReturnType<typeof vi.fn> };
}

useFakeTimersPerTest();

afterEach(() => {
  vi.resetAllMocks();
});

test('Initialize platform', async () => {
  const api = createTestApi();
  const platform = createTestPlatform({}, api);

  expect(DaikinCloudController).toHaveBeenCalledWith(expect.objectContaining({
    'authMode': 'developer_portal',
    'clientId': 'CLIENT_ID',
    'clientSecret': 'CLIENT_SECRET',
    'callbackServerExternalAddress': 'SERVER_EXTERNAL_ADDRESS',
    'callbackServerPort': 8583,
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

  mockController([mockDevice]);

  const api = createTestApi();

  const registerPlatformAccessoriesSpy = vi.spyOn(api, 'registerPlatformAccessories');

  createTestPlatform({ showExtraFeatures: true }, api);
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

  mockController([mockDevice]);

  const api = createTestApi();
  const registerSpy = vi.spyOn(api, 'registerPlatformAccessories');

  // The custom UI saves the raw Daikin device ID (the value returned by device.getId()).
  createTestPlatform({ showExtraFeatures: true, excludedDevicesByDeviceId: ['efd08509-2edb-41d0-a9ab-ce913323d811'] }, api);
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

  mockController([mockDevice]);

  const api = createTestApi();
  const registerSpy = vi.spyOn(api, 'registerPlatformAccessories');

  // A HAP UUID in the config must NOT match — only raw Daikin device IDs are honoured.
  const excludedDevicesByDeviceId = [api.hap.uuid.generate('efd08509-2edb-41d0-a9ab-ce913323d811')];
  createTestPlatform({ showExtraFeatures: true, excludedDevicesByDeviceId }, api);
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

  mockController([mockDevice]);

  const api = createTestApi();
  const platform = createTestPlatform({ showExtraFeatures: true, forceUpdateDelay: 10000 }, api);
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

  mockController([mockDevice]);

  const api = createTestApi();
  const platform = createTestPlatform({ showExtraFeatures: true, forceUpdateDelay: 10000 }, api);
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

  mockController([mockDevice]);

  const api = createTestApi();

  const registerPlatformAccessoriesSpy = vi.spyOn(api, 'registerPlatformAccessories');

  createTestPlatform({ showExtraFeatures: true }, api);
  api.signalFinished();

  // Wait for async device discovery to complete using fake timers
  await vi.advanceTimersByTimeAsync(100);

  expect(AlthermaAccessory).toHaveBeenCalled();
  expect(AirConditioningAccessory).not.toHaveBeenCalled();
  expect(registerPlatformAccessoriesSpy).toHaveBeenCalledWith('@mp-consulting/homebridge-daikin-cloud', 'DaikinCloud', expect.anything());
});

describe('polling scheduler', () => {
  const FIFTEEN_MIN = 15 * 60 * 1000;

  test('a write during an in-flight forced update leaves exactly one periodic poll scheduled', async () => {
    mockController([airco()]);
    const { platform, updateSpy } = await startPlatform({ forceUpdateDelay: 10000 });
    updateSpy.mockClear();

    let release!: () => void;
    updateSpy.mockImplementationOnce(() => new Promise<void>((resolve) => {
      release = resolve;
    }));

    platform.forceUpdateDevices();
    await vi.advanceTimersByTimeAsync(10000);
    expect(updateSpy).toHaveBeenCalledTimes(1); // forced GET now in flight

    // A write lands while the GET is still running
    platform.forceUpdateDevices();
    release();
    await vi.advanceTimersByTimeAsync(10000);
    expect(updateSpy).toHaveBeenCalledTimes(2);

    // From here on, exactly one poll per interval (a leaked interval would double this)
    updateSpy.mockClear();
    await vi.advanceTimersByTimeAsync(FIFTEEN_MIN * 3);
    expect(updateSpy).toHaveBeenCalledTimes(3);
  });

  test('overlapping polls share the in-flight request', async () => {
    mockController([airco()]);
    const { controller, updateSpy } = await startPlatform();
    controller.emit('websocket_connected'); // first connection: no catch-up poll
    expect(updateSpy).not.toHaveBeenCalled();

    let release!: () => void;
    updateSpy.mockImplementationOnce(() => new Promise<void>((resolve) => {
      release = resolve;
    }));
    await vi.advanceTimersByTimeAsync(FIFTEEN_MIN);
    expect(updateSpy).toHaveBeenCalledTimes(1);

    // A reconnect while that GET is in flight reuses it
    controller.emit('websocket_connected');
    await vi.advanceTimersByTimeAsync(0);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
  });

  test('shutdown clears all timers and prevents any restart', async () => {
    mockController([airco()]);
    const { api, platform, controller, updateSpy } = await startPlatform({ forceUpdateDelay: 10000 });
    updateSpy.mockClear();

    platform.forceUpdateDevices();
    api.signalShutdown();

    expect(controller.disableWebSocket).toHaveBeenCalled();
    platform.forceUpdateDevices();
    controller.emit('websocket_disconnected', { reconnecting: false });
    controller.emit('websocket_connected');
    await vi.advanceTimersByTimeAsync(FIFTEEN_MIN * 8);

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test('a connected WebSocket stretches polling and skips forced updates; reconnect catches up, disconnect restores', async () => {
    mockController([airco()]);
    const { platform, controller, updateSpy } = await startPlatform({ forceUpdateDelay: 10000 });
    updateSpy.mockClear();

    controller.isWebSocketConnected.mockReturnValue(true);
    controller.emit('websocket_connected');

    platform.forceUpdateDevices();
    await vi.advanceTimersByTimeAsync(FIFTEEN_MIN * 3);
    expect(updateSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(FIFTEEN_MIN);
    expect(updateSpy).toHaveBeenCalledTimes(1); // 60 min safety poll

    // Disconnect: back to the configured 15 min interval
    controller.isWebSocketConnected.mockReturnValue(false);
    controller.emit('websocket_disconnected', { reconnecting: true });
    updateSpy.mockClear();
    await vi.advanceTimersByTimeAsync(FIFTEEN_MIN);
    expect(updateSpy).toHaveBeenCalledTimes(1);

    // Reconnect: one immediate catch-up poll
    controller.isWebSocketConnected.mockReturnValue(true);
    controller.emit('websocket_connected');
    await vi.advanceTimersByTimeAsync(0);
    expect(updateSpy).toHaveBeenCalledTimes(2);
  });

  test('consecutive poll failures back off exponentially (capped) and reset on success', async () => {
    mockController([airco()]);
    const { updateSpy } = await startPlatform();
    updateSpy.mockClear();
    updateSpy.mockRejectedValue(new Error('Bad Gateway'));

    await vi.advanceTimersByTimeAsync(FIFTEEN_MIN); // fail #1 -> next in 30
    expect(updateSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(FIFTEEN_MIN * 2); // fail #2 -> next in 60
    expect(updateSpy).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(FIFTEEN_MIN * 3);
    expect(updateSpy).toHaveBeenCalledTimes(2);
    updateSpy.mockResolvedValue(undefined);
    await vi.advanceTimersByTimeAsync(FIFTEEN_MIN); // success -> back to 15
    expect(updateSpy).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(FIFTEEN_MIN);
    expect(updateSpy).toHaveBeenCalledTimes(4);
  });
});

describe('rate limit status', () => {
  test('warns when no calls are left and writes the status file (throttled)', async () => {
    const writeSpy = vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
    const renameSpy = vi.spyOn(fs.promises, 'rename').mockResolvedValue(undefined);
    mockController([airco()]);
    const { api, platform, controller } = await startPlatform();
    const warnSpy = vi.spyOn(platform.log, 'warn');

    controller.emit('rate_limit_status', { remainingDay: 0, limitDay: 200 });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('only have 0 calls left'));

    await vi.advanceTimersByTimeAsync(0);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const [tmpPath, content] = writeSpy.mock.calls[0] as [string, string];
    expect(tmpPath).toBe(`${api.user.storagePath()}/.daikin-rate-limit.json.tmp`);
    expect(JSON.parse(content)).toMatchObject({ remainingDay: 0, limitDay: 200, mode: 'developer_portal' });
    expect(renameSpy).toHaveBeenCalledWith(tmpPath, `${api.user.storagePath()}/.daikin-rate-limit.json`);

    // A burst within the throttle window results in a single trailing write of the latest value
    controller.emit('rate_limit_status', { remainingDay: 150, limitDay: 200 });
    controller.emit('rate_limit_status', { remainingDay: 149, limitDay: 200 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(writeSpy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(writeSpy.mock.calls[1][1] as string)).toMatchObject({ remainingDay: 149 });
  });

  test('a failing status file write is swallowed', async () => {
    vi.spyOn(fs.promises, 'writeFile').mockRejectedValue(new Error('EACCES'));
    mockController([airco()]);
    const { controller } = await startPlatform();
    controller.emit('rate_limit_status', { remainingDay: 100, limitDay: 200 });
    await vi.advanceTimersByTimeAsync(0);
  });

  test('a low daily quota stretches the poll interval', async () => {
    mockController([airco()]);
    const { controller, updateSpy } = await startPlatform();
    updateSpy.mockClear();
    vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
    vi.spyOn(fs.promises, 'rename').mockResolvedValue(undefined);

    controller.emit('rate_limit_status', { remainingDay: 10, limitDay: 200 });
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000); // already-scheduled poll runs
    expect(updateSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(45 * 60 * 1000);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(updateSpy).toHaveBeenCalledTimes(2);
  });
});

test('invalid_grant during discovery removes the token file', async () => {
  const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => undefined);
  mockController([], { getCloudDevices: vi.fn().mockRejectedValue(new Error('invalid_grant: refresh token expired')) });
  const { api, controller } = await startPlatform();

  expect(unlinkSpy).toHaveBeenCalledWith(`${api.user.storagePath()}/.daikin-controller-cloud-tokenset`);
  expect(controller.updateAllDeviceData).not.toHaveBeenCalled();
});

describe('computePollInterval', () => {
  const base = { configuredMs: 15 * 60 * 1000, webSocketConnected: false, consecutiveFailures: 0 };

  test('uses the configured interval by default', () => {
    expect(computePollInterval(base)).toBe(base.configuredMs);
  });

  test('stretches to the safety interval while the WebSocket is connected', () => {
    expect(computePollInterval({ ...base, webSocketConnected: true })).toBe(WEBSOCKET_SAFETY_POLL_INTERVAL_MS);
    expect(computePollInterval({ ...base, configuredMs: 2 * WEBSOCKET_SAFETY_POLL_INTERVAL_MS, webSocketConnected: true }))
      .toBe(2 * WEBSOCKET_SAFETY_POLL_INTERVAL_MS);
  });

  test('backs off exponentially on failures, capped at 4x', () => {
    expect(computePollInterval({ ...base, consecutiveFailures: 1 })).toBe(base.configuredMs * 2);
    expect(computePollInterval({ ...base, consecutiveFailures: 2 })).toBe(base.configuredMs * 4);
    expect(computePollInterval({ ...base, consecutiveFailures: 10 })).toBe(base.configuredMs * 4);
  });

  test('stretches when the daily quota is low', () => {
    expect(computePollInterval({ ...base, remainingDay: 0 })).toBe(LOW_QUOTA_POLL_INTERVAL_MS);
    expect(computePollInterval({ ...base, remainingDay: 500 })).toBe(base.configuredMs);
  });
});
