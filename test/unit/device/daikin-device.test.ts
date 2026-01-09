import {PlatformAccessory} from 'homebridge/lib/platformAccessory';
import {DaikinCloudDevice, DaikinApi} from '../../../src/api';
import {dx4Airco} from '../../fixtures/dx4-airco';
import {althermaHeatPump} from '../../fixtures/altherma-heat-pump';

const mockApi = { updateDevice: jest.fn().mockResolvedValue(undefined) } as unknown as DaikinApi;

it('Get deviceModel from device %s', async () => {
    const accessory = new PlatformAccessory('NAME', 'efd08509-2edb-41d0-a9ab-ce913323d811');
    accessory.context.device = new DaikinCloudDevice(dx4Airco as any, mockApi);
    expect(accessory.context.device.getDescription().deviceModel).toEqual('dx4');
});

it('Get name from device %s', async () => {
    const accessory = new PlatformAccessory('NAME', 'efd08509-2edb-41d0-a9ab-ce913323d811');
    accessory.context.device = new DaikinCloudDevice(dx4Airco as any, mockApi);
    expect(accessory.context.device.getData('climateControl', 'name', undefined).value).toEqual('Zolder');
});

it('Get name from device %s', async () => {
    const accessory = new PlatformAccessory('NAME', 'efd08509-2edb-41d0-a9ab-ce913323d811');
    accessory.context.device = new DaikinCloudDevice(althermaHeatPump as any, mockApi);
    expect(accessory.context.device.getData('climateControlMainZone', 'name', undefined).value).toEqual('Altherma');
});

it('Get tankTemperature from device domesticHotWaterTank', async () => {
    const accessory = new PlatformAccessory('NAME', 'efd08509-2edb-41d0-a9ab-ce913323d811');
    accessory.context.device = new DaikinCloudDevice(althermaHeatPump as any, mockApi);
    expect(accessory.context.device.getData('domesticHotWaterTank', 'sensoryData', '/tankTemperature').value).toEqual(48);
});

it('Get roomTemperature from climateControl sensoryData', async () => {
    const device = new DaikinCloudDevice(dx4Airco as any, mockApi);
    const result = device.getData('climateControl', 'sensoryData', '/roomTemperature');
    expect(result.value).toEqual(25);
});

it('Debug: trace getData path for roomTemperature', () => {
    const device = new DaikinCloudDevice(dx4Airco as any, mockApi);

    // Check that management point is found
    const desc = device.desc;
    const mp = desc.managementPoints?.find((m: any) => m.embeddedId === 'climateControl');
    expect(mp).toBeDefined();
    expect(mp?.sensoryData).toBeDefined();

    // Check sensoryData structure
    const sensoryData = mp?.sensoryData;
    expect(sensoryData?.value?.roomTemperature?.value).toEqual(25);

    // Now test through getData
    const result = device.getData('climateControl', 'sensoryData', '/roomTemperature');
    console.log('getData result:', JSON.stringify(result, null, 2));
    expect(result.value).toEqual(25);
});

it('Integration: simulate full AC accessory temperature get', () => {
    const device = new DaikinCloudDevice(dx4Airco as any, mockApi);

    // Test the path that ClimateControlService uses
    const managementPointId = 'climateControl';

    // 1. getCurrentControlMode() checks controlMode first
    const controlModeResult = device.getData(managementPointId, 'controlMode', undefined);
    console.log('controlMode result:', JSON.stringify(controlModeResult, null, 2));

    // For AC devices, controlMode should not exist, so it defaults to 'roomTemperature'
    const controlMode = controlModeResult.value ? controlModeResult.value : 'roomTemperature';
    console.log('controlMode:', controlMode);

    // 2. handleCurrentTemperatureGet uses this path
    const path = '/' + controlMode;
    console.log('path:', path);

    const temperature = device.getData(managementPointId, 'sensoryData', path);
    console.log('temperature result:', JSON.stringify(temperature, null, 2));

    expect(temperature.value).toEqual(25);
});
