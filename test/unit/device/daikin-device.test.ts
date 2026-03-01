import { vi } from 'vitest';
import { PlatformAccessory } from 'homebridge/lib/platformAccessory';
import type { DaikinApi } from '../../../src/api';
import { DaikinCloudDevice } from '../../../src/api';
import { dx4Airco } from '../../fixtures/dx4-airco';
import { althermaHeatPump } from '../../fixtures/altherma-heat-pump';

const mockApi = { updateDevice: vi.fn().mockResolvedValue(undefined) } as unknown as DaikinApi;

it('Get deviceModel from device', async () => {
  const accessory = new PlatformAccessory('NAME', 'efd08509-2edb-41d0-a9ab-ce913323d811');
  accessory.context.device = new DaikinCloudDevice(dx4Airco as any, mockApi);
  expect(accessory.context.device.getDescription().deviceModel).toEqual('dx4');
});

it('Get name from AC device', async () => {
  const accessory = new PlatformAccessory('NAME', 'efd08509-2edb-41d0-a9ab-ce913323d811');
  accessory.context.device = new DaikinCloudDevice(dx4Airco as any, mockApi);
  expect(accessory.context.device.getData('climateControl', 'name', undefined).value).toEqual('Zolder');
});

it('Get name from Altherma device', async () => {
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

it('getData navigates nested sensoryData path correctly', () => {
  const device = new DaikinCloudDevice(dx4Airco as any, mockApi);

  const desc = device.desc;
  const mp = desc.managementPoints?.find((m: any) => m.embeddedId === 'climateControl');
  expect(mp).toBeDefined();
  expect(mp?.sensoryData).toBeDefined();
  expect(mp?.sensoryData?.value?.roomTemperature?.value).toEqual(25);

  const result = device.getData('climateControl', 'sensoryData', '/roomTemperature');
  expect(result.value).toEqual(25);
});

it('getData falls back to roomTemperature when controlMode is absent', () => {
  const device = new DaikinCloudDevice(dx4Airco as any, mockApi);

  const managementPointId = 'climateControl';
  const controlModeResult = device.getData(managementPointId, 'controlMode', undefined);
  const controlMode = controlModeResult.value ? controlModeResult.value : 'roomTemperature';

  const path = '/' + controlMode;
  const temperature = device.getData(managementPointId, 'sensoryData', path);
  expect(temperature.value).toEqual(25);
});

it('updateRawData replaces device data', () => {
  const device = new DaikinCloudDevice(dx4Airco as any, mockApi);
  const originalId = device.getId();

  const modifiedData = { ...dx4Airco, id: 'new-id' } as any;
  device.updateRawData(modifiedData);

  expect(device.getId()).toEqual('new-id');
  expect(device.desc.id).toEqual('new-id');
  expect(device.getId()).not.toEqual(originalId);
});
