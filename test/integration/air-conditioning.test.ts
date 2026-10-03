import { vi } from 'vitest';
import type { PlatformAccessory } from 'homebridge/lib/platformAccessory';
import type { DaikinCloudAccessoryContext } from '../../src/platform';
import { AirConditioningAccessory } from '../../src/accessories';
import type { DaikinApi } from '../../src/api';
import { DaikinCloudDevice, DaikinCloudController } from '../../src/api';
import { unknownJan } from '../fixtures/unknown-jan';
import { unknownKitchenGuests } from '../fixtures/unknown-kitchen-guests';
import { dx23Airco } from '../fixtures/dx23-airco';
import { dx4Airco } from '../fixtures/dx4-airco';
import { dx23Airco2 } from '../fixtures/dx23-airco-2';

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
import { createTestApi, createTestPlatform, useFakeTimersPerTest } from '../helpers/platform';

useFakeTimersPerTest();

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
	writes: ExpectedWrites;
};

/** Expected setData payloads for the setters exercised in the table test. */
type ExpectedWrites = {
	operationMode: string;
	/** Writes for RotationSpeed=50%: [path, value] pairs. */
	rotationSpeed50: Array<[string, string | number]>;
	/** Axes written for SwingMode=1 (axes already swinging are skipped). */
	swingOnAxes: Array<'horizontal' | 'vertical'>;
	/** Auto-setpoint sync value after CoolingThreshold=21, or undefined when the device has no auto setpoint. */
	autoSyncAfterCooling21?: number;
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
      writes: {
        operationMode: 'heating',
        rotationSpeed50: [['/operationModes/heating/fanSpeed/modes/fixed', 3]],
        swingOnAxes: ['horizontal', 'vertical'],
        // heating 22 + cooling 21 → 21.5
        autoSyncAfterCooling21: 21.5,
      },
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
      writes: {
        operationMode: 'cooling',
        // maxValue 3: 50% → 1.5 → 2
        rotationSpeed50: [['/operationModes/cooling/fanSpeed/modes/fixed', 2]],
        swingOnAxes: [],
        // heating 17 + cooling 21 → 19
        autoSyncAfterCooling21: 19,
      },
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
      writes: {
        operationMode: 'heating',
        rotationSpeed50: [['/operationModes/heating/fanSpeed/modes/fixed', 3]],
        swingOnAxes: ['vertical'],
        // heating 13 + cooling 21 → 17, clamped to the auto minValue 18
        autoSyncAfterCooling21: 18,
      },
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
      writes: {
        operationMode: 'cooling',
        // fan is in 'auto': switch currentMode to fixed first; maxValue 3: 50% → 2
        rotationSpeed50: [
          ['/operationModes/cooling/fanSpeed/currentMode', 'fixed'],
          ['/operationModes/cooling/fanSpeed/modes/fixed', 2],
        ],
        swingOnAxes: [],
        autoSyncAfterCooling21: undefined,
      },
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
      writes: {
        operationMode: 'cooling',
        rotationSpeed50: [
          ['/operationModes/cooling/fanSpeed/currentMode', 'fixed'],
          ['/operationModes/cooling/fanSpeed/modes/fixed', 2],
        ],
        swingOnAxes: [],
        autoSyncAfterCooling21: undefined,
      },
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

  const api = createTestApi();
  const platform = createTestPlatform({ showExtraFeatures: true }, api);

  const uuid = api.hap.uuid.generate(device.getId());
  const accessory = new api.platformAccessory('NAME_FOR_TEST', uuid);
  accessory.context.device = device;

  expect(() => {
    new AirConditioningAccessory(platform, accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);
  }).not.toThrow();

  const homebridgeAccessory = new AirConditioningAccessory(platform, accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);

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

  // Setter payloads (run after all read-only assertions above). setData is
  // mocked without the optimistic cache write, so every setter sees the fixture state.
  const setData = vi.spyOn(device, 'setData').mockResolvedValue(undefined);
  const service = homebridgeAccessory.service;
  const { writes } = state;

  setData.mockClear();
  await service.handleActiveStateSet(state.activeState ? 0 : 1);
  await service.handleActiveStateSet(state.activeState ? 1 : 0);
  expect(setData.mock.calls).toEqual([['climateControl', 'onOffMode', state.activeState ? 'off' : 'on', undefined]]);

  setData.mockClear();
  await service.handleCoolingThresholdTemperatureSet(21);
  expect(setData.mock.calls).toEqual([
    ['climateControl', 'temperatureControl', '/operationModes/cooling/setpoints/roomTemperature', 21],
    ...(writes.autoSyncAfterCooling21 === undefined
      ? []
      : [['climateControl', 'temperatureControl', '/operationModes/auto/setpoints/roomTemperature', writes.autoSyncAfterCooling21]]),
  ]);

  setData.mockClear();
  await service.handleRotationSpeedSet(50);
  expect(setData.mock.calls).toEqual(writes.rotationSpeed50.map(([path, value]) => ['climateControl', 'fanControl', path, value]));

  setData.mockClear();
  await service.handleTargetHeaterCoolerStateSet(1);
  expect(setData.mock.calls).toEqual(
    writes.operationMode === 'heating' ? [] : [['climateControl', 'operationMode', 'heating', undefined]],
  );

  setData.mockClear();
  await service.handleSwingModeSet(1);
  expect(setData.mock.calls).toEqual(writes.swingOnAxes.map(axis => [
    'climateControl', 'fanControl', `/operationModes/${writes.operationMode}/fanDirection/${axis}/currentMode`, 'swing',
  ]));
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


  const api = createTestApi();
  const platform = createTestPlatform({}, api);

  const uuid = api.hap.uuid.generate(device.getId());
  const accessory = new api.platformAccessory('NAME_FOR_TEST', uuid);

  // Switches cached by earlier plugin versions carry the un-namespaced subtype.
  accessory.addService(api.hap.Service.Switch, 'Powerful mode', 'powerful_mode');
  accessory.addService(api.hap.Service.Switch, 'Econo mode', 'econo_mode');
  accessory.addService(api.hap.Service.Switch, 'Streamer mode', 'streamer_mode');
  accessory.addService(api.hap.Service.Switch, 'Outdoor silent mode', 'outdoor_silent_mode');
  accessory.addService(api.hap.Service.Switch, 'Indoor silent mode', 'indoor_silent_mode');
  accessory.context.device = device;

  const removeServiceSpy = vi.spyOn(accessory, 'removeService').mockImplementation(() => {});

  // Constructor side-effects register services on the accessory; the instance itself is unused
  new AirConditioningAccessory(platform, accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);


  expect(removeServiceSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({ displayName: 'Powerful mode', subtype: 'powerful_mode' }));
  expect(removeServiceSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({ displayName: 'Econo mode', subtype: 'econo_mode' }));
  expect(removeServiceSpy).toHaveBeenNthCalledWith(3, expect.objectContaining({ displayName: 'Streamer mode', subtype: 'streamer_mode' }));
  expect(removeServiceSpy).toHaveBeenNthCalledWith(4, expect.objectContaining({ displayName: 'Outdoor silent mode', subtype: 'outdoor_silent_mode' }));
  expect(removeServiceSpy).toHaveBeenNthCalledWith(5, expect.objectContaining({ displayName: 'Indoor silent mode', subtype: 'indoor_silent_mode' }));

});

test('DaikinCloudAirConditioningAccessory Getters', async () => {
  const mockApi = { updateDevice: vi.fn().mockResolvedValue(undefined) } as unknown as DaikinApi;
  const device = new DaikinCloudDevice(JSON.parse(JSON.stringify(dx4Airco)) as any, mockApi);

  vi.spyOn(DaikinCloudController.prototype, 'getCloudDevices').mockImplementation(async () => {
    return [device];
  });

  const api = createTestApi();
  const platform = createTestPlatform({}, api);

  const uuid = api.hap.uuid.generate(device.getId());
  const accessory = new api.platformAccessory(device.getData('climateControl', 'name', undefined).value as string, uuid);
  accessory.context.device = device;

  const homebridgeAccessory = new AirConditioningAccessory(platform, accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);

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

describe('DaikinCloudAirConditioningAccessory Setters (dx4)', () => {
  const build = () => {
    const mockApi = { updateDevice: vi.fn().mockResolvedValue(undefined) } as unknown as DaikinApi;
    const device = new DaikinCloudDevice(JSON.parse(JSON.stringify(dx4Airco)) as any, mockApi);
    vi.spyOn(DaikinCloudController.prototype, 'getCloudDevices').mockImplementation(async () => [device]);
    const setData = vi.spyOn(device, 'setData').mockResolvedValue(undefined);

    const api = createTestApi();
    const accessory = new api.platformAccessory(device.getData('climateControl', 'name', undefined).value as string, api.hap.uuid.generate(device.getId()));
    accessory.context.device = device;
    const homebridgeAccessory = new AirConditioningAccessory(
      createTestPlatform({}, api),
      accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>,
    );
    setData.mockClear();
    return { service: homebridgeAccessory.service, setData };
  };

  test('Active: already on is skipped, off writes onOffMode=off', async () => {
    const { service, setData } = build();
    await service.handleActiveStateSet(1);
    expect(setData).not.toHaveBeenCalled();
    await service.handleActiveStateSet(0);
    expect(setData.mock.calls).toEqual([['climateControl', 'onOffMode', 'off', undefined]]);
  });

  test('CoolingThreshold writes the setpoint, then mirrors the midpoint to auto', async () => {
    const { service, setData } = build();
    // dx4 heating=22 + new cooling=21 → midpoint 21.5.
    await service.handleCoolingThresholdTemperatureSet(21);
    expect(setData.mock.calls).toEqual([
      ['climateControl', 'temperatureControl', '/operationModes/cooling/setpoints/roomTemperature', 21],
      ['climateControl', 'temperatureControl', '/operationModes/auto/setpoints/roomTemperature', 21.5],
    ]);
  });

  test('HeatingThreshold writes the setpoint, then mirrors the midpoint to auto', async () => {
    const { service, setData } = build();
    // New heating=25 + dx4 cooling=25 → midpoint 25.
    await service.handleHeatingThresholdTemperatureSet(25);
    expect(setData.mock.calls).toEqual([
      ['climateControl', 'temperatureControl', '/operationModes/heating/setpoints/roomTemperature', 25],
      ['climateControl', 'temperatureControl', '/operationModes/auto/setpoints/roomTemperature', 25],
    ]);
  });

  test('RotationSpeed in fixed fan mode only writes the speed', async () => {
    const { service, setData } = build();
    // 50% of maxValue 5 = 2.5 → device speed 3.
    await service.handleRotationSpeedSet(50);
    expect(setData.mock.calls).toEqual([['climateControl', 'fanControl', '/operationModes/heating/fanSpeed/modes/fixed', 3]]);
  });

  test('TargetHeaterCoolerState only writes operationMode (never onOffMode)', async () => {
    const { service, setData } = build();
    await service.handleTargetHeaterCoolerStateSet(1);
    expect(setData).not.toHaveBeenCalled(); // already heating
    await service.handleTargetHeaterCoolerStateSet(2);
    expect(setData.mock.calls).toEqual([['climateControl', 'operationMode', 'cooling', undefined]]);
  });

  test('SwingMode writes both fan-direction axes', async () => {
    const { service, setData } = build();
    await service.handleSwingModeSet(1);
    expect(setData.mock.calls).toEqual([
      ['climateControl', 'fanControl', '/operationModes/heating/fanDirection/horizontal/currentMode', 'swing'],
      ['climateControl', 'fanControl', '/operationModes/heating/fanDirection/vertical/currentMode', 'swing'],
    ]);
  });

  test.each([
    ['PowerfulModeFeature', PowerfulModeFeature, ['climateControl', 'powerfulMode', 'on', undefined]],
    ['EconoModeFeature', EconoModeFeature, ['climateControl', 'econoMode', 'on', undefined]],
    ['StreamerModeFeature', StreamerModeFeature, ['climateControl', 'streamerMode', 'on', undefined]],
    ['OutdoorSilentModeFeature', OutdoorSilentModeFeature, ['climateControl', 'outdoorSilentMode', 'on', undefined]],
    ['IndoorSilentModeFeature', IndoorSilentModeFeature, ['climateControl', 'fanControl', '/operationModes/heating/fanSpeed/currentMode', 'quiet']],
  ])('feature switch %s writes its data point', async (_name, featureClass, expected) => {
    const { service, setData } = build();
    await service.featureManager.getFeature(featureClass as typeof PowerfulModeFeature)!.handleSet(true);
    expect(setData.mock.calls).toEqual([expected]);
  });
});
