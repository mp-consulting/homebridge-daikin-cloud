import { vi } from 'vitest';
import type { PlatformAccessory } from 'homebridge/lib/platformAccessory';
import type { DaikinCloudAccessoryContext } from '../../src/platform';
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
import { PowerfulModeFeature } from '../../src/features';
import { createTestApi, createTestPlatform } from '../helpers/platform';


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
    writes: {
        /** Setpoint path written by CoolingThreshold=21 and the auto sync value (undefined ⇒ no sync). */
        cooling21: [string, number | undefined];
        /** Setpoint path written by HeatingThreshold=25 and the auto sync value (undefined ⇒ no sync). */
        heating25: [string, number | undefined];
    };
};

const RT = (mode: string) => `/operationModes/${mode}/setpoints/roomTemperature`;
const LWO = (mode: string) => `/operationModes/${mode}/setpoints/leavingWaterOffset`;
const LWT = (mode: string) => `/operationModes/${mode}/setpoints/leavingWaterTemperature`;

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
      writes: { cooling21: [RT('cooling'), 21.5], heating25: [RT('heating'), undefined] },

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
      writes: { cooling21: [LWO('cooling'), 10], heating25: [LWO('heating'), 10] },

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
      writes: { cooling21: [RT('cooling'), undefined], heating25: [RT('heating'), 22.5] },

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
      writes: { cooling21: [RT('cooling'), undefined], heating25: [RT('heating'), 22.5] },

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
      writes: { cooling21: [LWT('cooling'), undefined], heating25: [LWO('heating'), undefined] },

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
      writes: { cooling21: [LWO('cooling'), 10], heating25: [LWO('heating'), 10] },

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
      writes: { cooling21: [LWT('cooling'), 33], heating25: [LWT('heating'), 25] },
    },
  ],
])('Create DaikinCloudThermostatAccessory with %s device', async (name, climateControlEmbeddedId, deviceJson, state) => {
  const mockApi = { updateDevice: vi.fn().mockResolvedValue(undefined) } as unknown as DaikinApi;
  const device = new DaikinCloudDevice(JSON.parse(JSON.stringify(deviceJson)) as any, mockApi);

  vi.spyOn(DaikinCloudController.prototype, 'getCloudDevices').mockImplementation(async () => {
    return [device];
  });

  const api = createTestApi();
  const platform = createTestPlatform({ showExtraFeatures: true }, api);

  const uuid = api.hap.uuid.generate(device.getId());
  const accessory = new api.platformAccessory('NAME_FOR_TEST', uuid);
  accessory.context.device = device;

  expect(() => {
    new AlthermaAccessory(platform, accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);
  }).not.toThrow();

  const homebridgeAccessory = new AlthermaAccessory(platform, accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);


  const service = homebridgeAccessory.service!;
  const mp = climateControlEmbeddedId;
  const setData = vi.spyOn(device, 'setData').mockResolvedValue(undefined);
  const autoPath = (path: string) => path.replace(/\/operationModes\/\w+\//, '/operationModes/auto/');

  if (typeof state.activeState !== 'undefined') {
    expect(await service.handleActiveStateGet()).toBe(state.activeState);
    setData.mockClear();
    await service.handleActiveStateSet(1);
    await service.handleActiveStateSet(0);
    // Only the transition away from the current state is written.
    expect(setData.mock.calls).toEqual([[mp, 'onOffMode', state.activeState ? 'off' : 'on', undefined]]);
  }

  expect(await service.handleCurrentTemperatureGet()).toBe(state.currentTemperature);

  if (typeof state.coolingThresholdTemperature !== 'undefined') {
    expect(await service.handleCoolingThresholdTemperatureGet()).toBe(state.coolingThresholdTemperature);
    const [path, auto] = state.writes.cooling21;
    setData.mockClear();
    await service.handleCoolingThresholdTemperatureSet(21);
    expect(setData.mock.calls).toEqual([
      [mp, 'temperatureControl', path, 21],
      ...(auto === undefined ? [] : [[mp, 'temperatureControl', autoPath(path), auto]]),
    ]);
  }

  if (typeof state.heatingThresholdTemperature !== 'undefined') {
    expect(await service.handleHeatingThresholdTemperatureGet()).toBe(state.heatingThresholdTemperature);
    const [path, auto] = state.writes.heating25;
    setData.mockClear();
    await service.handleHeatingThresholdTemperatureSet(25);
    expect(setData.mock.calls).toEqual([
      [mp, 'temperatureControl', path, 25],
      ...(auto === undefined ? [] : [[mp, 'temperatureControl', autoPath(path), auto]]),
    ]);
  }

  if (typeof state.targetHeaterCoolerState !== 'undefined') {
    expect(await service.handleTargetHeaterCoolerStateGet()).toBe(state.targetHeaterCoolerState);
    setData.mockClear();
    await service.handleTargetHeaterCoolerStateSet(1);
    expect(setData).not.toHaveBeenCalled(); // every fixture is already heating
    await service.handleTargetHeaterCoolerStateSet(2);
    expect(setData.mock.calls).toEqual([[mp, 'operationMode', 'cooling', undefined]]);
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
    const powerful = homebridgeAccessory.hotWaterTankService!.featureManager.getFeature(PowerfulModeFeature)!;
    expect(await powerful.handleGet()).toBe(state.powerfulMode);
  }

});

test('DaikinCloudAirConditioningAccessory Getters', async () => {
  const mockApi = { updateDevice: vi.fn().mockResolvedValue(undefined) } as unknown as DaikinApi;
  const device = new DaikinCloudDevice(JSON.parse(JSON.stringify(althermaHeatPump)) as any, mockApi);

  vi.spyOn(DaikinCloudController.prototype, 'getCloudDevices').mockImplementation(async () => {
    return [device];
  });

  const api = createTestApi();
  const platform = createTestPlatform({}, api);

  const uuid = api.hap.uuid.generate(device.getId());
  const accessory = new api.platformAccessory(device.getData('climateControlMainZone', 'name', undefined).value as string, uuid);
  accessory.context.device = device;

  const homebridgeAccessory = new AlthermaAccessory(platform, accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);

  expect(await homebridgeAccessory.service?.handleActiveStateGet()).toEqual(true);
  expect(await homebridgeAccessory.service?.handleCurrentTemperatureGet()).toEqual(22.4);
  expect(await homebridgeAccessory.service?.handleHeatingThresholdTemperatureGet()).toEqual(22);
  expect(await homebridgeAccessory.service?.handleTargetHeaterCoolerStateGet()).toEqual(1);
});

test('DaikinCloudAirConditioningAccessory Setters', async () => {
  const mockApi = { updateDevice: vi.fn().mockResolvedValue(undefined) } as unknown as DaikinApi;
  const device = new DaikinCloudDevice(JSON.parse(JSON.stringify(althermaHeatPump)) as any, mockApi);

  vi.spyOn(DaikinCloudController.prototype, 'getCloudDevices').mockImplementation(async () => {
    return [device];
  });

  const setDataSpy = vi.spyOn(DaikinCloudDevice.prototype, 'setData').mockResolvedValue(undefined);

  const api = createTestApi();
  const platform = createTestPlatform({}, api);

  const uuid = api.hap.uuid.generate(device.getId());
  const accessory = new api.platformAccessory(device.getData('climateControlMainZone', 'name', undefined).value as string, uuid);
  accessory.context.device = device;

  const homebridgeAccessory = new AlthermaAccessory(platform, accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);

  // Device starts 'on'; setting Active=1 (already on) is skipped by the idempotency guard
  await homebridgeAccessory.service?.handleActiveStateSet(1);
  expect(setDataSpy).toHaveBeenCalledTimes(0);

  await homebridgeAccessory.service?.handleActiveStateSet(0);
  expect(setDataSpy).toHaveBeenNthCalledWith(1, 'climateControlMainZone', 'onOffMode', 'off', undefined);

  // Cooling-set fires the auto-sync (override cooling=21 + device heating=22 → midpoint 21.5).
  await homebridgeAccessory.service?.handleCoolingThresholdTemperatureSet(21);
  expect(setDataSpy).toHaveBeenNthCalledWith(2, 'climateControlMainZone', 'temperatureControl', '/operationModes/cooling/setpoints/roomTemperature', 21);
  expect(setDataSpy).toHaveBeenNthCalledWith(3, 'climateControlMainZone', 'temperatureControl', '/operationModes/auto/setpoints/roomTemperature', 21.5);

  // Heating-set's auto-sync skips silently because althermaHeatPump's
  // cooling.setpoints is empty (no roomTemperature to read back) — the
  // sync needs both sides defined or it can't compute a midpoint.
  await homebridgeAccessory.service?.handleHeatingThresholdTemperatureSet(25);
  expect(setDataSpy).toHaveBeenNthCalledWith(4, 'climateControlMainZone', 'temperatureControl', '/operationModes/heating/setpoints/roomTemperature', 25);

  // TargetHeaterCoolerState only sets operationMode; onOffMode is controlled exclusively by Active.
  // HEAT is skipped (already heating), COOL is written.
  await homebridgeAccessory.service?.handleTargetHeaterCoolerStateSet(1);
  await homebridgeAccessory.service?.handleTargetHeaterCoolerStateSet(2);
  expect(setDataSpy).toHaveBeenCalledTimes(5);
  expect(setDataSpy).toHaveBeenNthCalledWith(5, 'climateControlMainZone', 'operationMode', 'cooling', undefined);


});
