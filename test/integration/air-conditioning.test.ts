import { vi } from 'vitest';
import type { PlatformAccessory } from 'homebridge/lib/platformAccessory';
import type { DaikinCloudAccessoryContext } from '../../src/platform';
import { DaikinCloudPlatform } from '../../src/platform';
import { MockPlatformConfig } from '../mocks';
import { AirConditioningAccessory } from '../../src/accessories';
import type { DaikinApi } from '../../src/api';
import { DaikinCloudDevice, DaikinCloudController } from '../../src/api';
import { unknownJan } from '../fixtures/unknown-jan';
import { unknownKitchenGuests } from '../fixtures/unknown-kitchen-guests';
import { dx23Airco } from '../fixtures/dx23-airco';
import { dx4Airco } from '../fixtures/dx4-airco';
import { dx23Airco2 } from '../fixtures/dx23-airco-2';

import { HomebridgeAPI } from 'homebridge/lib/api.js';
import { Logger } from 'homebridge/lib/logger.js';
import {
  PowerfulModeFeature,
  EconoModeFeature,
  StreamerModeFeature,
  OutdoorSilentModeFeature,
  IndoorSilentModeFeature,
  AutoFanModeFeature,
  DryOperationModeFeature,
  FanOnlyOperationModeFeature,
} from '../../src/features';

// Use fake timers to prevent tests from hanging due to setInterval/setTimeout in platform
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

type DeviceState = {
	activeState: boolean;
	currentTemperature: number;
	targetHeaterCoolerState: string;
	coolingThresholdTemperature: number;
	heatingThresholdTemperature: number;
	rotationSpeed: number;
	swingMode: number;
	powerfulMode: number;
	econoMode: number;
	streamerMode: number;
	outdoorSilentMode: number;
	indoorSilentMode: number;
	autoFanMode: number;
	dryOperationMode: number;
	fanOnlyOperationMode: number;
};

test.each<Array<string | string | any | DeviceState>>([
  [
    'dx4',
    'climateControl',
    dx4Airco,
    {
      activeState: true,
      currentTemperature: 25,
      targetHeaterCoolerState: 1,
      coolingThresholdTemperature: 25,
      heatingThresholdTemperature: 22,
      // dx4 fanSpeed.modes.fixed: value=2, maxValue=5 → 40% in HomeKit
      rotationSpeed: 40,
      swingMode: 0,
      powerfulMode: false,
      econoMode: false,
      streamerMode: false,
      outdoorSilentMode: false,
      indoorSilentMode: false,
      // dx4 heating fanSpeed.currentMode values ['auto','quiet','fixed'], current 'fixed'
      autoFanMode: false,
      dryOperationMode: false,
      fanOnlyOperationMode: false,
    },
  ],
  [
    'dx23',
    'climateControl',
    dx23Airco,
    {
      activeState: false,
      currentTemperature: 27,
      targetHeaterCoolerState: 2,
      coolingThresholdTemperature: 17,
      heatingThresholdTemperature: 17,
      // dx23 fanSpeed.modes.fixed: value=3, maxValue=3 → 100% in HomeKit
      rotationSpeed: 100,
      swingMode: 1,
      powerfulMode: undefined,
      econoMode: undefined,
      streamerMode: undefined,
      outdoorSilentMode: undefined,
      indoorSilentMode: undefined,
      // dx23 cooling fanSpeed.currentMode values ['fixed'] only → switch unsupported
      autoFanMode: undefined,
      dryOperationMode: false,
      fanOnlyOperationMode: false,
    },
  ],
  [
    'dx23-2',
    'climateControl',
    dx23Airco2,
    {
      activeState: true,
      currentTemperature: 19,
      targetHeaterCoolerState: 1,
      coolingThresholdTemperature: 25,
      heatingThresholdTemperature: 13,
      // dx23-2 fanSpeed.modes.fixed: value=4, maxValue=5 → 80% in HomeKit
      rotationSpeed: 80,
      swingMode: 0,
      powerfulMode: false,
      econoMode: undefined,
      streamerMode: undefined,
      outdoorSilentMode: undefined,
      indoorSilentMode: false,
      // dx23-2 heating fanSpeed.currentMode values ['quiet','auto','fixed'], current 'fixed'
      autoFanMode: false,
      dryOperationMode: false,
      fanOnlyOperationMode: false,
    },
  ],
  [
    'unknown',
    'climateControl',
    unknownKitchenGuests,
    {
      activeState: false,
      currentTemperature: 30.1,
      targetHeaterCoolerState: 2,
      coolingThresholdTemperature: 23.5,
      heatingThresholdTemperature: undefined,
      // unknown fanSpeed.modes.fixed: value=1, maxValue=3 → 33% in HomeKit
      rotationSpeed: 33,
      swingMode: 1,
      powerfulMode: undefined,
      econoMode: undefined,
      streamerMode: undefined,
      outdoorSilentMode: undefined,
      indoorSilentMode: undefined,
      // unknown cooling fanSpeed.currentMode values ['auto','fixed'], current 'auto'
      autoFanMode: true,
      dryOperationMode: false,
      fanOnlyOperationMode: false,
    },
  ],
  [
    'unknown2',
    'climateControl',
    unknownJan,
    {
      activeState: false,
      currentTemperature: 27,
      targetHeaterCoolerState: 2,
      coolingThresholdTemperature: 26.1,
      heatingThresholdTemperature: undefined,
      // unknown2 fanSpeed.modes.fixed: value=1, maxValue=3 → 33% in HomeKit
      rotationSpeed: 33,
      swingMode: 1,
      powerfulMode: undefined,
      econoMode: undefined,
      streamerMode: undefined,
      outdoorSilentMode: undefined,
      indoorSilentMode: undefined,
      // unknown2 cooling fanSpeed.currentMode values ['auto','fixed'], current 'auto'
      autoFanMode: true,
      dryOperationMode: false,
      fanOnlyOperationMode: false,
    },
  ],
])('Create DaikinCloudAirConditioningAccessory with %s device', async (name: string, climateControlEmbeddedId: string, deviceJson, state: DeviceState) => {
  const mockApi = {
    updateDevice: vi.fn().mockResolvedValue(undefined),
  } as unknown as DaikinApi;
  const device = new DaikinCloudDevice(JSON.parse(JSON.stringify(deviceJson)) as any, mockApi);

  vi.spyOn(DaikinCloudController.prototype, 'getCloudDevices').mockImplementation(async () => {
    return [device];
  });

  const config = new MockPlatformConfig(true);
  const api = new HomebridgeAPI();

  const uuid = api.hap.uuid.generate(device.getId());
  const accessory = new api.platformAccessory('NAME_FOR_TEST', uuid);
  accessory.context.device = device;

  expect(() => {
    new AirConditioningAccessory(new DaikinCloudPlatform(new Logger(), config, api), accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);
  }).not.toThrow();

  const homebridgeAccessory = new AirConditioningAccessory(new DaikinCloudPlatform(new Logger(), config, api), accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);

  // Read-only assertions FIRST: setData now optimistically updates the in-memory
  // cache, so a setter run before a getter would change what the getter sees
  // (e.g. moving the fan speed slider flips Auto fan mode off). Verify the initial
  // device state up front, then exercise the setters separately below.
  if (typeof state.activeState !== 'undefined') {
    expect(await homebridgeAccessory.service.handleActiveStateGet()).toBe(state.activeState);
  }

  expect(await homebridgeAccessory.service.handleCurrentTemperatureGet()).toBe(state.currentTemperature);

  if (typeof state.coolingThresholdTemperature !== 'undefined') {
    expect(await homebridgeAccessory.service.handleCoolingThresholdTemperatureGet()).toBe(state.coolingThresholdTemperature);
  }

  if (typeof state.heatingThresholdTemperature !== 'undefined') {
    expect(await homebridgeAccessory.service.handleHeatingThresholdTemperatureGet()).toBe(state.heatingThresholdTemperature);
  }

  if (typeof state.rotationSpeed !== 'undefined') {
    expect(await homebridgeAccessory.service.handleRotationSpeedGet()).toBe(state.rotationSpeed);
  }

  if (typeof state.targetHeaterCoolerState !== 'undefined') {
    expect(await homebridgeAccessory.service.handleTargetHeaterCoolerStateGet()).toBe(state.targetHeaterCoolerState);
  }

  if (typeof state.swingMode !== 'undefined') {
    expect(await homebridgeAccessory.service.handleSwingModeGet()).toBe(state.swingMode);
  }

  if (typeof state.powerfulMode !== 'undefined') {
    const feature = homebridgeAccessory.service.featureManager.getFeature(PowerfulModeFeature);
    expect(feature).toBeDefined();
    expect(await feature!.handleGet()).toBe(state.powerfulMode);
  }

  if (typeof state.econoMode !== 'undefined') {
    const feature = homebridgeAccessory.service.featureManager.getFeature(EconoModeFeature);
    expect(feature).toBeDefined();
    expect(await feature!.handleGet()).toBe(state.econoMode);
  }

  if (typeof state.streamerMode !== 'undefined') {
    const feature = homebridgeAccessory.service.featureManager.getFeature(StreamerModeFeature);
    expect(feature).toBeDefined();
    expect(await feature!.handleGet()).toBe(state.streamerMode);
  }

  if (typeof state.outdoorSilentMode !== 'undefined') {
    const feature = homebridgeAccessory.service.featureManager.getFeature(OutdoorSilentModeFeature);
    expect(feature).toBeDefined();
    expect(await feature!.handleGet()).toBe(state.outdoorSilentMode);
  }

  if (typeof state.indoorSilentMode !== 'undefined') {
    const feature = homebridgeAccessory.service.featureManager.getFeature(IndoorSilentModeFeature);
    expect(feature).toBeDefined();
    expect(await feature!.handleGet()).toBe(state.indoorSilentMode);
  }

  if (typeof state.autoFanMode !== 'undefined') {
    const feature = homebridgeAccessory.service.featureManager.getFeature(AutoFanModeFeature);
    expect(feature).toBeDefined();
    expect(await feature!.handleGet()).toBe(state.autoFanMode);
  }

  if (typeof state.dryOperationMode !== 'undefined') {
    const feature = homebridgeAccessory.service.featureManager.getFeature(DryOperationModeFeature);
    expect(feature).toBeDefined();
    expect(await feature!.handleGet()).toBe(state.dryOperationMode);
  }

  if (typeof state.fanOnlyOperationMode !== 'undefined') {
    const feature = homebridgeAccessory.service.featureManager.getFeature(FanOnlyOperationModeFeature);
    expect(feature).toBeDefined();
    expect(await feature!.handleGet()).toBe(state.fanOnlyOperationMode);
  }

  // Setters should not throw (run after all read-only assertions above).
  if (typeof state.activeState !== 'undefined') {
    await expect(homebridgeAccessory.service.handleActiveStateSet(1)).resolves.not.toThrow();
    await expect(homebridgeAccessory.service.handleActiveStateSet(0)).resolves.not.toThrow();
  }
  if (typeof state.coolingThresholdTemperature !== 'undefined') {
    await expect(homebridgeAccessory.service.handleCoolingThresholdTemperatureSet(21)).resolves.not.toThrow();
  }
  if (typeof state.heatingThresholdTemperature !== 'undefined') {
    await expect(homebridgeAccessory.service.handleHeatingThresholdTemperatureSet(25)).resolves.not.toThrow();
  }
  if (typeof state.rotationSpeed !== 'undefined') {
    await expect(homebridgeAccessory.service.handleRotationSpeedSet(50)).resolves.not.toThrow();
  }
  if (typeof state.targetHeaterCoolerState !== 'undefined') {
    await expect(homebridgeAccessory.service.handleTargetHeaterCoolerStateSet(1)).resolves.not.toThrow();
  }
  if (typeof state.swingMode !== 'undefined') {
    await expect(homebridgeAccessory.service.handleSwingModeSet(1)).resolves.not.toThrow();
  }
});

test.each<Array<string | string | any>>([
  ['dx4', 'climateControl', dx4Airco],
  ['dx23', 'climateControl', dx23Airco],
])('Create DaikinCloudAirConditioningAccessory with %s device, showExtraFeatures disabled', async (name, climateControlEmbeddedId, deviceJson) => {
  const mockApi = { updateDevice: vi.fn().mockResolvedValue(undefined) } as unknown as DaikinApi;
  const device = new DaikinCloudDevice(JSON.parse(JSON.stringify(deviceJson)) as any, mockApi);

  vi.spyOn(DaikinCloudController.prototype, 'getCloudDevices').mockImplementation(async () => {
    return [device];
  });


  const config = new MockPlatformConfig(false);
  const api = new HomebridgeAPI();

  const uuid = api.hap.uuid.generate(device.getId());
  const accessory = new api.platformAccessory('NAME_FOR_TEST', uuid);

  accessory.addService(api.hap.Service.Switch, 'Powerful mode', 'Powerful_Mode');
  accessory.addService(api.hap.Service.Switch, 'Econo mode', 'Econo_Mode');
  accessory.addService(api.hap.Service.Switch, 'Streamer mode', 'Streamer_Mode');
  accessory.addService(api.hap.Service.Switch, 'Outdoor silent mode', 'Outdoor_Silent_Mode');
  accessory.addService(api.hap.Service.Switch, 'Indoor silent mode', 'Indoor_Silent_Mode');
  accessory.context.device = device;

  const removeServiceSpy = vi.spyOn(accessory, 'removeService').mockImplementation(() => {});

  // Constructor side-effects register services on the accessory; the instance itself is unused
  new AirConditioningAccessory(new DaikinCloudPlatform(new Logger(), config, api), accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);


  expect(removeServiceSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({ displayName: 'Powerful mode', subtype: 'Powerful_Mode' }));
  expect(removeServiceSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({ displayName: 'Econo mode', subtype: 'Econo_Mode' }));
  expect(removeServiceSpy).toHaveBeenNthCalledWith(3, expect.objectContaining({ displayName: 'Streamer mode', subtype: 'Streamer_Mode' }));
  expect(removeServiceSpy).toHaveBeenNthCalledWith(4, expect.objectContaining({ displayName: 'Outdoor silent mode', subtype: 'Outdoor_Silent_Mode' }));
  expect(removeServiceSpy).toHaveBeenNthCalledWith(5, expect.objectContaining({ displayName: 'Indoor silent mode', subtype: 'Indoor_Silent_Mode' }));

});

test('DaikinCloudAirConditioningAccessory Getters', async () => {
  const mockApi = { updateDevice: vi.fn().mockResolvedValue(undefined) } as unknown as DaikinApi;
  const device = new DaikinCloudDevice(JSON.parse(JSON.stringify(dx4Airco)) as any, mockApi);

  vi.spyOn(DaikinCloudController.prototype, 'getCloudDevices').mockImplementation(async () => {
    return [device];
  });

  const config = new MockPlatformConfig(false);
  const api = new HomebridgeAPI();

  const uuid = api.hap.uuid.generate(device.getId());
  const accessory = new api.platformAccessory(device.getData('climateControl', 'name', undefined).value as string, uuid);
  accessory.context.device = device;

  const homebridgeAccessory = new AirConditioningAccessory(new DaikinCloudPlatform(new Logger(), config, api), accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);

  expect(await homebridgeAccessory.service.handleActiveStateGet()).toEqual(true);
  expect(await homebridgeAccessory.service.handleCurrentTemperatureGet()).toEqual(25);
  expect(await homebridgeAccessory.service.handleCoolingThresholdTemperatureGet()).toEqual(25);
  // dx4 heating fanSpeed.modes.fixed = 2 / maxValue 5 → 40% in HomeKit
  expect(await homebridgeAccessory.service.handleRotationSpeedGet()).toEqual(40);
  expect(await homebridgeAccessory.service.handleHeatingThresholdTemperatureGet()).toEqual(22);
  expect(await homebridgeAccessory.service.handleTargetHeaterCoolerStateGet()).toEqual(1);
  expect(await homebridgeAccessory.service.handleSwingModeGet()).toEqual(0);

  // Feature-based getters via FeatureManager
  const powerfulFeature = homebridgeAccessory.service.featureManager.getFeature(PowerfulModeFeature);
  expect(await powerfulFeature!.handleGet()).toEqual(false);
  const econoFeature = homebridgeAccessory.service.featureManager.getFeature(EconoModeFeature);
  expect(await econoFeature!.handleGet()).toEqual(false);
  const streamerFeature = homebridgeAccessory.service.featureManager.getFeature(StreamerModeFeature);
  expect(await streamerFeature!.handleGet()).toEqual(false);
  const outdoorSilentFeature = homebridgeAccessory.service.featureManager.getFeature(OutdoorSilentModeFeature);
  expect(await outdoorSilentFeature!.handleGet()).toEqual(false);
  const indoorSilentFeature = homebridgeAccessory.service.featureManager.getFeature(IndoorSilentModeFeature);
  expect(await indoorSilentFeature!.handleGet()).toEqual(false);
});

test('DaikinCloudAirConditioningAccessory Setters', async () => {
  const mockApi = { updateDevice: vi.fn().mockResolvedValue(undefined) } as unknown as DaikinApi;
  const device = new DaikinCloudDevice(JSON.parse(JSON.stringify(dx4Airco)) as any, mockApi);

  vi.spyOn(DaikinCloudController.prototype, 'getCloudDevices').mockImplementation(async () => {
    return [device];
  });

  const setDataSpy = vi.spyOn(DaikinCloudDevice.prototype, 'setData').mockImplementation(() => {});

  const config = new MockPlatformConfig(false);
  const api = new HomebridgeAPI();

  const uuid = api.hap.uuid.generate(device.getId());
  const accessory = new api.platformAccessory(device.getData('climateControl', 'name', undefined).value as string, uuid);
  accessory.context.device = device;

  const homebridgeAccessory = new AirConditioningAccessory(new DaikinCloudPlatform(new Logger(), config, api), accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);

  // Device starts 'on'; setting Active=1 (already on) is skipped by the idempotency guard
  await homebridgeAccessory.service.handleActiveStateSet(1);
  expect(setDataSpy).toHaveBeenCalledTimes(0);

  await homebridgeAccessory.service.handleActiveStateSet(0);
  expect(setDataSpy).toHaveBeenNthCalledWith(1, 'climateControl', 'onOffMode', 'off', undefined);

  // Cooling threshold setter now also mirrors the heating/cooling midpoint
  // to the auto setpoint (HomeKit range ↔ Daikin single-setpoint bridge).
  // dx4 heating=22 + new cooling=21 → midpoint=21.5 → auto write.
  await homebridgeAccessory.service.handleCoolingThresholdTemperatureSet(21);
  expect(setDataSpy).toHaveBeenNthCalledWith(2, 'climateControl', 'temperatureControl', '/operationModes/cooling/setpoints/roomTemperature', 21);
  expect(setDataSpy).toHaveBeenNthCalledWith(3, 'climateControl', 'temperatureControl', '/operationModes/auto/setpoints/roomTemperature', 21.5);

  // dx4-airco in heating mode already has fanSpeed.currentMode = 'fixed',
  // so the setter only updates the speed value (no redundant currentMode write).
  // 50% of maxValue 5 = 2.5 → rounds to 3 → device speed 3.
  await homebridgeAccessory.service.handleRotationSpeedSet(50);
  expect(setDataSpy).toHaveBeenNthCalledWith(4, 'climateControl', 'fanControl', '/operationModes/heating/fanSpeed/modes/fixed', 3);

  // Heating threshold setter also fires the auto sync.
  // setDataSpy is a no-op mock so device state still has cooling=25 from
  // the fixture (the earlier cooling=21 write didn't persist in memory).
  // New heating=25 + device cooling=25 → midpoint=25.
  await homebridgeAccessory.service.handleHeatingThresholdTemperatureSet(25);
  expect(setDataSpy).toHaveBeenNthCalledWith(5, 'climateControl', 'temperatureControl', '/operationModes/heating/setpoints/roomTemperature', 25);
  expect(setDataSpy).toHaveBeenNthCalledWith(6, 'climateControl', 'temperatureControl', '/operationModes/auto/setpoints/roomTemperature', 25);

  // TargetHeaterCoolerState only sets operationMode; onOffMode is controlled exclusively by Active
  await homebridgeAccessory.service.handleTargetHeaterCoolerStateSet(1);
  expect(setDataSpy).toHaveBeenNthCalledWith(7, 'climateControl', 'operationMode', 'heating', undefined);

  await homebridgeAccessory.service.handleSwingModeSet(1);
  expect(setDataSpy).toHaveBeenNthCalledWith(8, 'climateControl', 'fanControl', '/operationModes/heating/fanDirection/horizontal/currentMode', 'swing');
  expect(setDataSpy).toHaveBeenNthCalledWith(9, 'climateControl', 'fanControl', '/operationModes/heating/fanDirection/vertical/currentMode', 'swing');

  // Feature-based setters via FeatureManager
  const powerfulFeature = homebridgeAccessory.service.featureManager.getFeature(PowerfulModeFeature);
  await powerfulFeature!.handleSet(true);
  expect(setDataSpy).toHaveBeenNthCalledWith(10, 'climateControl', 'powerfulMode', 'on', undefined);

  const econoFeature = homebridgeAccessory.service.featureManager.getFeature(EconoModeFeature);
  await econoFeature!.handleSet(true);
  expect(setDataSpy).toHaveBeenNthCalledWith(11, 'climateControl', 'econoMode', 'on', undefined);

  const streamerFeature = homebridgeAccessory.service.featureManager.getFeature(StreamerModeFeature);
  await streamerFeature!.handleSet(true);
  expect(setDataSpy).toHaveBeenNthCalledWith(12, 'climateControl', 'streamerMode', 'on', undefined);

  const outdoorSilentFeature = homebridgeAccessory.service.featureManager.getFeature(OutdoorSilentModeFeature);
  await outdoorSilentFeature!.handleSet(true);
  expect(setDataSpy).toHaveBeenNthCalledWith(13, 'climateControl', 'outdoorSilentMode', 'on', undefined);

  const indoorSilentFeature = homebridgeAccessory.service.featureManager.getFeature(IndoorSilentModeFeature);
  await indoorSilentFeature!.handleSet(true);
  expect(setDataSpy).toHaveBeenNthCalledWith(14, 'climateControl', 'fanControl', '/operationModes/heating/fanSpeed/currentMode', 'quiet');
});
