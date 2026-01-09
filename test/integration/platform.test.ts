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

afterEach(() => {
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

// TODO: Fix complex mocking for platform device discovery tests
test.skip('DaikinCloudPlatform with new Aircondition accessory', async () => {
    jest.spyOn(DaikinCloudController.prototype, 'getCloudDevices').mockResolvedValue([{
        getId: () => 'MOCK_ID',
        getDescription: () => {
            return {
                deviceModel: 'Airco',
            };
        },
        getData: () => 'MOCK_DATE',
        desc: {
            managementPoints: [
                {
                    'embeddedId': 'climateControl',
                    'managementPointType': 'climateControl',
                },
            ],
        },
    } as unknown as DaikinCloudDevice]);

    const api = new HomebridgeAPI();

    const registerPlatformAccessoriesSpy = jest.spyOn(api, 'registerPlatformAccessories');

    new DaikinCloudPlatform(new Logger(), new MockPlatformConfig(true), api);
    api.signalFinished();

    // Wait for async device discovery to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(AirConditioningAccessory).toHaveBeenCalled();
    expect(AlthermaAccessory).not.toHaveBeenCalled();
    expect(registerPlatformAccessoriesSpy).toHaveBeenCalledWith('@mp-consulting/homebridge-daikin-cloud', 'DaikinCloud', expect.anything());
});

test.skip('DaikinCloudPlatform with new Altherma accessory', async () => {
    jest.spyOn(DaikinCloudController.prototype, 'getCloudDevices').mockResolvedValue([{
        getId: () => 'MOCK_ID',
        getDescription: () => {
            return {
                deviceModel: 'Altherma',
            };
        },
        getData: () => 'MOCK_DATE',
        desc: {
            managementPoints: [
                {
                    'embeddedId': 'climateControl',
                    'managementPointType': 'climateControl',
                },
            ],
        },
    } as unknown as DaikinCloudDevice]);

    const api = new HomebridgeAPI();

    const registerPlatformAccessoriesSpy = jest.spyOn(api, 'registerPlatformAccessories');

    new DaikinCloudPlatform(new Logger(), new MockPlatformConfig(true), api);
    api.signalFinished();

    // Wait for async device discovery to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(AlthermaAccessory).toHaveBeenCalled();
    expect(AirConditioningAccessory).not.toHaveBeenCalled();
    expect(registerPlatformAccessoriesSpy).toHaveBeenCalledWith('@mp-consulting/homebridge-daikin-cloud', 'DaikinCloud', expect.anything());
});
