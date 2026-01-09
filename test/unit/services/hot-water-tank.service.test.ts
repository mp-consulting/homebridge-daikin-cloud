import {HotWaterTankService} from '../../../src/services';
import {DaikinCloudDevice, DaikinApi} from '../../../src/api';
import {MockPlatformConfig} from '../../mocks';
import {DaikinCloudAccessoryContext, DaikinCloudPlatform} from '../../../src/platform';
import {PlatformAccessory} from 'homebridge/lib/platformAccessory';
import {Characteristic, uuid} from 'hap-nodejs';
import {althermaHeatPump} from '../../fixtures/altherma-heat-pump';

import {HomebridgeAPI} from 'homebridge/lib/api.js';
import {Logger} from 'homebridge/lib/logger.js';

// Helper to get management point data from the device
const getManagementPoint = (device: DaikinCloudDevice, embeddedId: string): any => {
    return (device as any).rawData.managementPoints.find((mp: any) => mp.embeddedId === embeddedId);
};

// Use fake timers to prevent tests from hanging due to setInterval/setTimeout in platform
beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
});

describe('HotWaterTankService', () => {
    let accessory: PlatformAccessory<DaikinCloudAccessoryContext>;
    let service: HotWaterTankService;

    const EMBEDDED_ID = 'domesticHotWaterTank';

    beforeEach(() => {
        const mockApi = {} as DaikinApi;
        accessory = new PlatformAccessory<DaikinCloudAccessoryContext>('ACCESSORY_NAME', uuid.generate('ACCESSORY_UUID'));
        // Use a deep copy of the fixture to isolate test mutations
        accessory.context['device'] = new DaikinCloudDevice(JSON.parse(JSON.stringify(althermaHeatPump)) as any, mockApi);
        accessory.context.device.getLastUpdated = jest.fn().mockReturnValue(new Date(1987, 0, 19, 0, 0, 0, 0));

        const platform = new DaikinCloudPlatform(new Logger(), new MockPlatformConfig(true), new HomebridgeAPI());

        service = new HotWaterTankService(platform, accessory, EMBEDDED_ID);
    });

    it('should get the current heating cooling state', async () => {
        expect(await service.handleHotWaterTankCurrentHeatingCoolingStateGet()).toBe(Characteristic.CurrentHeatingCoolingState.HEAT);

        getManagementPoint(accessory.context.device, EMBEDDED_ID)['onOffMode'] = { value: 'off' };

        expect(await service.handleHotWaterTankTargetHeatingCoolingStateGet()).toBe(Characteristic.CurrentHeatingCoolingState.OFF);
    });

    it('should get the current temperature', async () => {
        expect(await service.handleHotWaterTankCurrentTemperatureGet()).toBe(48);
    });

    it('should get the target heating cooling temperature', async () => {
        expect(await service.handleHotWaterTankHeatingTargetTemperatureGet()).toBe(48);
    });

    it('should get the target heating cooling state', async () => {
        expect(await service.handleHotWaterTankTargetHeatingCoolingStateGet()).toBe(Characteristic.TargetHeatingCoolingState.HEAT);

        getManagementPoint(accessory.context.device, EMBEDDED_ID)['operationMode'] = {
            'settable': true,
            'values': [
                'auto',
                'dry',
                'cooling',
                'heating',
                'fanOnly',
            ],
            'value': 'cooling',
        };
        expect(await service.handleHotWaterTankTargetHeatingCoolingStateGet()).toBe(Characteristic.TargetHeatingCoolingState.COOL);

        getManagementPoint(accessory.context.device, EMBEDDED_ID)['operationMode'] = {
            'settable': true,
            'values': [
                'auto',
                'dry',
                'cooling',
                'heating',
                'fanOnly',
            ],
            'value': 'auto',
        };
        expect(await service.handleHotWaterTankTargetHeatingCoolingStateGet()).toBe(Characteristic.TargetHeatingCoolingState.AUTO);

        getManagementPoint(accessory.context.device, EMBEDDED_ID)['operationMode'] = {
            'settable': true,
            'values': [
                'auto',
                'dry',
                'cooling',
                'heating',
                'fanOnly',
            ],
            'value': 'fanOnly',
        };
        expect(await service.handleHotWaterTankTargetHeatingCoolingStateGet()).toBe(Characteristic.TargetHeatingCoolingState.AUTO);

        getManagementPoint(accessory.context.device, EMBEDDED_ID)['operationMode'] = {
            'settable': true,
            'values': [
                'auto',
                'dry',
                'cooling',
                'heating',
                'fanOnly',
            ],
            'value': 'dry',
        };
        expect(await service.handleHotWaterTankTargetHeatingCoolingStateGet()).toBe(Characteristic.TargetHeatingCoolingState.AUTO);

        getManagementPoint(accessory.context.device, EMBEDDED_ID)['onOffMode'] = { value: 'off' };
        expect(await service.handleHotWaterTankTargetHeatingCoolingStateGet()).toBe(Characteristic.TargetHeatingCoolingState.OFF);
    });

    it('should get the powerful mode', async () => {
        expect(await service.handlePowerfulModeGet()).toBe(false);
    });
});
