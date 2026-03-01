import { vi } from 'vitest';
import type { PlatformAccessory } from 'homebridge/lib/platformAccessory';
import type { DaikinCloudAccessoryContext } from '../../src/platform';
import { DaikinCloudPlatform } from '../../src/platform';
import { MockPlatformConfig } from '../mocks';
import { AlthermaAccessory } from '../../src/accessories';
import type { DaikinApi } from '../../src/api';
import { DaikinCloudDevice, DaikinCloudController } from '../../src/api';
import { althermaV1ckoeln } from '../fixtures/altherma-v1ckoeln';
import { althermaCrSense2 } from '../fixtures/altherma-crSense-2';
import { althermaWithEmbeddedIdZero } from '../fixtures/altherma-with-embedded-id-zero';
import { althermaHeatPump } from '../fixtures/altherma-heat-pump';
import { althermaHeatPump2 } from '../fixtures/altherma-heat-pump-2';
import { althermaFraction } from '../fixtures/altherma-fraction';
import { althermaMiladcerkic } from '../fixtures/altherma-miladcerkic';

import { HomebridgeAPI } from 'homebridge/lib/api.js';
import { Logger } from 'homebridge/lib/logger.js';

type DeviceState = {
    activeState: boolean;
    currentTemperature: number;
    targetHeaterCoolerState: string;
    coolingThresholdTemperature: number;
    heatingThresholdTemperature: number;
    hotWaterTankCurrentHeatingCoolingState: number;
    hotWaterTankCurrentTemperature: number;
    hotWaterTankHeatingTargetTemperature: number;
    hotWaterTankTargetHeaterCoolerState: number;
    powerfulMode: number;
};

test.each<Array<string | string | any | DeviceState>>([
  [
    'altherma',
    'climateControlMainZone',
    althermaHeatPump,
    {
      activeState: true,
      currentTemperature: 22.4,
      targetHeaterCoolerState: 1,
      coolingThresholdTemperature: undefined,
      heatingThresholdTemperature: 22,
      hotWaterTankCurrentHeatingCoolingState: 1,
      hotWaterTankCurrentTemperature: 48,
      hotWaterTankHeatingTargetTemperature: 48,
      hotWaterTankTargetHeaterCoolerState: 1,
      powerfulMode: false,

    },
  ],
  [
    'altherma',
    'climateControlMainZone',
    althermaHeatPump2,
    {
      activeState: false,
      currentTemperature: 33,
      targetHeaterCoolerState: 1,
      coolingThresholdTemperature: 0,
      heatingThresholdTemperature: 0,
      hotWaterTankCurrentHeatingCoolingState: 1,
      hotWaterTankCurrentTemperature: 50,
      hotWaterTankHeatingTargetTemperature: 50,
      hotWaterTankTargetHeaterCoolerState: 1,
      powerfulMode: false,

    },
  ],
  [
    'altherma2',
    '1',
    althermaWithEmbeddedIdZero,
    {
      activeState: false,
      currentTemperature: 27.7,
      targetHeaterCoolerState: 1,
      coolingThresholdTemperature: 20,
      heatingThresholdTemperature: 21,
      hotWaterTankCurrentHeatingCoolingState: 1,
      hotWaterTankCurrentTemperature: 42,
      hotWaterTankHeatingTargetTemperature: 45,
      hotWaterTankTargetHeaterCoolerState: 1,
      powerfulMode: false,

    },
  ],
  [
    'altherma3',
    '1',
    althermaCrSense2,
    {
      activeState: false,
      currentTemperature: 27.8,
      targetHeaterCoolerState: 1,
      coolingThresholdTemperature: 20,
      heatingThresholdTemperature: 21,
      hotWaterTankCurrentHeatingCoolingState: 1,
      hotWaterTankCurrentTemperature: 45,
      hotWaterTankHeatingTargetTemperature: 45,
      hotWaterTankTargetHeaterCoolerState: 1,
      powerfulMode: false,

    },
  ],
  [
    'altherma4',
    'climateControlMainZone',
    althermaV1ckoeln,
    {
      activeState: false,
      currentTemperature: 34, // or should we always show the roomTemperature here which is 27.5
      targetHeaterCoolerState: 1,
      coolingThresholdTemperature: 20,
      heatingThresholdTemperature: 0,
      hotWaterTankCurrentHeatingCoolingState: 1,
      hotWaterTankCurrentTemperature: 42,
      hotWaterTankHeatingTargetTemperature: 46,
      hotWaterTankTargetHeaterCoolerState: 1,
      powerfulMode: false,

    },
  ],
  [
    'althermaFraction',
    'climateControlMainZone',
    althermaFraction,
    {
      activeState: true,
      currentTemperature: 35, // has no roomTemperature :(
      targetHeaterCoolerState: 1,
      coolingThresholdTemperature: 0,
      heatingThresholdTemperature: 0,
      hotWaterTankCurrentHeatingCoolingState: 1,
      hotWaterTankCurrentTemperature: 45,
      hotWaterTankHeatingTargetTemperature: 47,
      hotWaterTankTargetHeaterCoolerState: 1,
      powerfulMode: false,

    },
  ],
  [
    'althermaMiladcerkic',
    'climateControlMainZone',
    althermaMiladcerkic,
    {
      activeState: true,
      currentTemperature: 45,
      targetHeaterCoolerState: 1,
      coolingThresholdTemperature: 20,
      heatingThresholdTemperature: 45,
      hotWaterTankCurrentHeatingCoolingState: 1,
      hotWaterTankCurrentTemperature: 49,
      hotWaterTankHeatingTargetTemperature: 50,
      hotWaterTankTargetHeaterCoolerState: 1,
      powerfulMode: false,
    },
  ],
])('Create DaikinCloudThermostatAccessory with %s device', async (name, climateControlEmbeddedId, deviceJson, state) => {
  const mockApi = { updateDevice: vi.fn().mockResolvedValue(undefined) } as unknown as DaikinApi;
  const device = new DaikinCloudDevice(deviceJson as any, mockApi);

  vi.spyOn(DaikinCloudController.prototype, 'getCloudDevices').mockImplementation(async () => {
    return [device];
  });

  const config = new MockPlatformConfig(true);
  const api = new HomebridgeAPI();

  const uuid = api.hap.uuid.generate(device.getId());
  const accessory = new api.platformAccessory('NAME_FOR_TEST', uuid);
  accessory.context.device = device;

  expect(() => {
    new AlthermaAccessory(new DaikinCloudPlatform(new Logger(), config, api), accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);
  }).not.toThrow();

  const homebridgeAccessory = new AlthermaAccessory(new DaikinCloudPlatform(new Logger(), config, api), accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);


  if (typeof state.activeState !== 'undefined') {
    expect(await homebridgeAccessory.service?.handleActiveStateGet()).toBe(state.activeState);
    await expect(homebridgeAccessory.service!.handleActiveStateSet(1)).resolves.not.toThrow();
    await expect(homebridgeAccessory.service!.handleActiveStateSet(0)).resolves.not.toThrow();
  }

  expect(await homebridgeAccessory.service?.handleCurrentTemperatureGet()).toBe(state.currentTemperature);

  if (typeof state.coolingThresholdTemperature !== 'undefined') {
    expect(await homebridgeAccessory.service?.handleCoolingThresholdTemperatureGet()).toBe(state.coolingThresholdTemperature);
    await expect(homebridgeAccessory.service!.handleCoolingThresholdTemperatureSet(21)).resolves.not.toThrow();
  }

  if (typeof state.heatingThresholdTemperature !== 'undefined') {
    expect(await homebridgeAccessory.service?.handleHeatingThresholdTemperatureGet()).toBe(state.heatingThresholdTemperature);
    await expect(homebridgeAccessory.service!.handleHeatingThresholdTemperatureSet(25)).resolves.not.toThrow();
  }

  if (typeof state.targetHeaterCoolerState !== 'undefined') {
    expect(await homebridgeAccessory.service?.handleTargetHeaterCoolerStateGet()).toBe(state.targetHeaterCoolerState);
    await expect(homebridgeAccessory.service!.handleTargetHeaterCoolerStateSet(1)).resolves.not.toThrow();
  }


  if (typeof state.hotWaterTankCurrentHeatingCoolingState !== 'undefined') {
    expect(await homebridgeAccessory.hotWaterTankService?.handleHotWaterTankCurrentHeatingCoolingStateGet()).toBe(state.hotWaterTankCurrentHeatingCoolingState);
  }
  if (typeof state.hotWaterTankCurrentTemperature !== 'undefined') {
    expect(await homebridgeAccessory.hotWaterTankService?.handleHotWaterTankCurrentTemperatureGet()).toBe(state.hotWaterTankCurrentTemperature);
  }
  if (typeof state.hotWaterTankHeatingTargetTemperature !== 'undefined') {
    expect(await homebridgeAccessory.hotWaterTankService?.handleHotWaterTankHeatingTargetTemperatureGet()).toBe(state.hotWaterTankHeatingTargetTemperature);
  }
  if (typeof state.hotWaterTankTargetHeaterCoolerState !== 'undefined') {
    expect(await homebridgeAccessory.hotWaterTankService?.handleHotWaterTankTargetHeatingCoolingStateGet()).toBe(state.hotWaterTankTargetHeaterCoolerState);
  }
  if (typeof state.powerfulMode !== 'undefined') {
    expect(await homebridgeAccessory.hotWaterTankService?.handlePowerfulModeGet()).toBe(state.powerfulMode);
  }

});

test('DaikinCloudAirConditioningAccessory Getters', async () => {
  const mockApi = { updateDevice: vi.fn().mockResolvedValue(undefined) } as unknown as DaikinApi;
  const device = new DaikinCloudDevice(althermaHeatPump as any, mockApi);

  vi.spyOn(DaikinCloudController.prototype, 'getCloudDevices').mockImplementation(async () => {
    return [device];
  });

  const config = new MockPlatformConfig(false);
  const api = new HomebridgeAPI();

  const uuid = api.hap.uuid.generate(device.getId());
  const accessory = new api.platformAccessory(device.getData('climateControlMainZone', 'name', undefined).value as string, uuid);
  accessory.context.device = device;

  const homebridgeAccessory = new AlthermaAccessory(new DaikinCloudPlatform(new Logger(), config, api), accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);

  expect(await homebridgeAccessory.service?.handleActiveStateGet()).toEqual(true);
  expect(await homebridgeAccessory.service?.handleCurrentTemperatureGet()).toEqual(22.4);
  expect(await homebridgeAccessory.service?.handleHeatingThresholdTemperatureGet()).toEqual(22);
  expect(await homebridgeAccessory.service?.handleTargetHeaterCoolerStateGet()).toEqual(1);
});

test('DaikinCloudAirConditioningAccessory Setters', async () => {
  const mockApi = { updateDevice: vi.fn().mockResolvedValue(undefined) } as unknown as DaikinApi;
  const device = new DaikinCloudDevice(althermaHeatPump as any, mockApi);

  vi.spyOn(DaikinCloudController.prototype, 'getCloudDevices').mockImplementation(async () => {
    return [device];
  });

  const setDataSpy = vi.spyOn(DaikinCloudDevice.prototype, 'setData').mockImplementation(() => {});

  const config = new MockPlatformConfig(false);
  const api = new HomebridgeAPI();

  const uuid = api.hap.uuid.generate(device.getId());
  const accessory = new api.platformAccessory(device.getData('climateControlMainZone', 'name', undefined).value as string, uuid);
  accessory.context.device = device;

  const homebridgeAccessory = new AlthermaAccessory(new DaikinCloudPlatform(new Logger(), config, api), accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);

  await homebridgeAccessory.service?.handleActiveStateSet(1);
  expect(setDataSpy).toHaveBeenNthCalledWith(1, 'climateControlMainZone', 'onOffMode', 'on', undefined);

  await homebridgeAccessory.service?.handleActiveStateSet(0);
  expect(setDataSpy).toHaveBeenNthCalledWith(2, 'climateControlMainZone', 'onOffMode', 'off', undefined);

  await homebridgeAccessory.service?.handleCoolingThresholdTemperatureSet(21);
  expect(setDataSpy).toHaveBeenNthCalledWith(3, 'climateControlMainZone', 'temperatureControl', '/operationModes/cooling/setpoints/roomTemperature', 21);

  await homebridgeAccessory.service?.handleHeatingThresholdTemperatureSet(25);
  expect(setDataSpy).toHaveBeenNthCalledWith(4, 'climateControlMainZone', 'temperatureControl', '/operationModes/heating/setpoints/roomTemperature', 25);

  await homebridgeAccessory.service?.handleTargetHeaterCoolerStateSet(1);
  expect(setDataSpy).toHaveBeenNthCalledWith(5, 'climateControlMainZone', 'operationMode', 'heating', undefined);
  expect(setDataSpy).toHaveBeenNthCalledWith(6, 'climateControlMainZone', 'onOffMode', 'on', undefined);


});
