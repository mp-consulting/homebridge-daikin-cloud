import {DaikinCloudPlatform} from '../../src/platform';
import {MockPlatformConfig} from '../mocks';
import {DaikinCloudController, DaikinCloudDevice} from '../../src/api';
import {AirConditioningAccessory, AlthermaAccessory} from '../../src/accessories';
import {HomebridgeAPI} from 'homebridge/lib/api.js';
import {Logger} from 'homebridge/lib/logger.js';

jest.mock('../../src/api/daikin-controller');
jest.mock('homebridge');
jest.mock('../../src/accessories/air-conditioning-accessory');
jest.mock('../../src/accessories/altherma-accessory');

// Use fake timers to prevent tests from hanging due to setInterval/setTimeout in platform
beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.resetAllMocks();
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
    (DaikinCloudController as unknown as jest.Mock).mockImplementation(() => ({
        getCloudDevices: jest.fn().mockResolvedValue([mockDevice]),
        isAuthenticated: jest.fn().mockReturnValue(true),
        on: jest.fn(),
        updateAllDeviceData: jest.fn().mockResolvedValue(undefined),
    }));

    const api = new HomebridgeAPI();

    const registerPlatformAccessoriesSpy = jest.spyOn(api, 'registerPlatformAccessories');

    new DaikinCloudPlatform(new Logger(), new MockPlatformConfig(true), api);
    api.signalFinished();

    // Wait for async device discovery to complete using fake timers
    await jest.advanceTimersByTimeAsync(100);

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
    (DaikinCloudController as unknown as jest.Mock).mockImplementation(() => ({
        getCloudDevices: jest.fn().mockResolvedValue([mockDevice]),
        isAuthenticated: jest.fn().mockReturnValue(true),
        on: jest.fn(),
        updateAllDeviceData: jest.fn().mockResolvedValue(undefined),
    }));

    const api = new HomebridgeAPI();

    const registerPlatformAccessoriesSpy = jest.spyOn(api, 'registerPlatformAccessories');

    new DaikinCloudPlatform(new Logger(), new MockPlatformConfig(true), api);
    api.signalFinished();

    // Wait for async device discovery to complete using fake timers
    await jest.advanceTimersByTimeAsync(100);

    expect(AlthermaAccessory).toHaveBeenCalled();
    expect(AirConditioningAccessory).not.toHaveBeenCalled();
    expect(registerPlatformAccessoriesSpy).toHaveBeenCalledWith('@mp-consulting/homebridge-daikin-cloud', 'DaikinCloud', expect.anything());
});
