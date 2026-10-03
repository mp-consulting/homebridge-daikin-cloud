import { vi } from 'vitest';
import {
  AutoFanModeFeature,
  DryOperationModeFeature,
  EconoModeFeature,
  FanOnlyOperationModeFeature,
  FeatureManager,
  IndoorSilentModeFeature,
  OnOffDataPointFeature,
  OutdoorSilentModeFeature,
  PowerfulModeFeature,
  StreamerModeFeature,
} from '../../../src/features';
import type { OnOffDataPointSpec } from '../../../src/features';
import type { DaikinApi } from '../../../src/api';
import { DaikinCloudDevice } from '../../../src/api';
import type { DaikinCloudAccessoryContext } from '../../../src/platform';
import { PlatformAccessory } from 'homebridge/lib/platformAccessory';
import { dx4Airco } from '../../fixtures/dx4-airco';
import { dx23Airco } from '../../fixtures/dx23-airco';
import { createTestPlatform, hap, useFakeTimersPerTest } from '../../helpers/platform';

const { Characteristic, Service, uuid } = hap;

useFakeTimersPerTest();

const build = (fixture: unknown = dx4Airco, config: Record<string, unknown> = {}) => {
  const setDataMock = vi.fn().mockResolvedValue(undefined);
  const device = new DaikinCloudDevice(JSON.parse(JSON.stringify(fixture)) as any, {} as DaikinApi);
  device.setData = setDataMock as unknown as typeof device.setData;
  const accessory = new PlatformAccessory<DaikinCloudAccessoryContext>('TEST', uuid.generate(device.getId()));
  accessory.context.device = device;
  const platform = createTestPlatform(config);
  vi.spyOn(platform, 'forceUpdateDevices').mockImplementation(() => undefined);
  return { platform, accessory, device, setDataMock };
};

class TestStreamerFeature extends OnOffDataPointFeature {
  protected readonly spec: OnOffDataPointSpec = {
    name: 'Test streamer',
    subtype: 'test_streamer',
    configKey: 'showStreamerMode',
    dataPoint: 'streamerMode',
    onValue: 'on',
    offValue: 'off',
    capability: 'hasStreamerMode',
  };
}

describe('OnOffDataPointFeature', () => {
  it('derives name, subtype and config key from its spec', () => {
    const { platform, accessory } = build();
    const feature = new TestStreamerFeature(platform, accessory, 'climateControl');
    expect(feature.featureName).toBe('Test streamer');
    expect(feature.serviceSubtype).toBe('test_streamer');
    expect(feature.configKey).toBe('showStreamerMode');
    expect(feature.namespacedSubtype).toBe('climateControl:test_streamer');
  });

  it('reads isSupported from the capabilities it was given', () => {
    const { platform, accessory } = build();
    const caps = new FeatureManager(platform, accessory, 'climateControl').capabilities;
    expect(new TestStreamerFeature(platform, accessory, 'climateControl', { ...caps, hasStreamerMode: false }).isSupported()).toBe(false);
    expect(new TestStreamerFeature(platform, accessory, 'climateControl', { ...caps, hasStreamerMode: true }).isSupported()).toBe(true);
  });

  it('is ON only when the data point equals onValue, and writes on/off values', async () => {
    const { platform, accessory, device, setDataMock } = build();
    const feature = new TestStreamerFeature(platform, accessory, 'climateControl');
    await expect(feature.handleGet()).resolves.toBe(false);

    await feature.handleSet(true);
    await feature.handleSet(false);
    expect(setDataMock.mock.calls).toEqual([
      ['climateControl', 'streamerMode', 'on', undefined],
      ['climateControl', 'streamerMode', 'off', undefined],
    ]);

    (device as any).rawData.managementPoints[1].streamerMode.value = 'on';
    await expect(feature.handleGet()).resolves.toBe(true);
  });

  it('turns a failed write into a HAP communication failure and skips the refresh', async () => {
    const { platform, accessory, setDataMock } = build();
    setDataMock.mockRejectedValueOnce(new Error('boom'));
    const feature = new TestStreamerFeature(platform, accessory, 'climateControl');
    await expect(feature.handleSet(true)).rejects.toBeInstanceOf(platform.api.hap.HapStatusError);
    expect(platform.forceUpdateDevices).not.toHaveBeenCalled();
  });

  it.each([
    ['PowerfulModeFeature', PowerfulModeFeature, 'powerfulMode', undefined, 'on', 'off'],
    ['EconoModeFeature', EconoModeFeature, 'econoMode', undefined, 'on', 'off'],
    ['StreamerModeFeature', StreamerModeFeature, 'streamerMode', undefined, 'on', 'off'],
    ['OutdoorSilentModeFeature', OutdoorSilentModeFeature, 'outdoorSilentMode', undefined, 'on', 'off'],
    ['IndoorSilentModeFeature', IndoorSilentModeFeature, 'fanControl', '/operationModes/heating/fanSpeed/currentMode', 'quiet', 'fixed'],
    ['AutoFanModeFeature', AutoFanModeFeature, 'fanControl', '/operationModes/heating/fanSpeed/currentMode', 'auto', 'fixed'],
    ['DryOperationModeFeature', DryOperationModeFeature, 'operationMode', undefined, 'dry', 'auto'],
    ['FanOnlyOperationModeFeature', FanOnlyOperationModeFeature, 'operationMode', undefined, 'fanOnly', 'auto'],
  ])('%s writes %s on/off (dx4 heating)', async (_name, FeatureClass, dataPoint, path, on, off) => {
    const { platform, accessory, setDataMock } = build();
    const feature = new FeatureClass(platform, accessory, 'climateControl');
    expect(feature.isSupported()).toBe(true);
    await feature.handleSet(true);
    await feature.handleSet(false);
    expect(setDataMock.mock.calls).toEqual(path
      ? [['climateControl', dataPoint, path, on], ['climateControl', dataPoint, path, off]]
      : [['climateControl', dataPoint, on, undefined], ['climateControl', dataPoint, off, undefined]]);
  });
});

describe('Feature switch services', () => {
  it('creates new switches with a subtype namespaced to the management point', () => {
    const { platform, accessory } = build(dx4Airco, { showPowerfulMode: true });
    new FeatureManager(platform, accessory, 'climateControl').setupFeatures();
    const sw = accessory.getServiceById(Service.Switch, 'climateControl:powerful_mode');
    expect(sw).toBeDefined();
    expect(sw!.getCharacteristic(Characteristic.Name).value).toBe('Powerful mode');
    expect(accessory.getServiceById(Service.Switch, 'powerful_mode')).toBeUndefined();
  });

  it('adopts a cached legacy (un-namespaced) switch instead of adding a duplicate', async () => {
    const { platform, accessory, setDataMock } = build(dx4Airco, { showPowerfulMode: true });
    const legacy = accessory.addService(Service.Switch, 'Powerful mode', 'powerful_mode');

    new FeatureManager(platform, accessory, 'climateControl').setupFeatures();

    expect(accessory.getServiceById(Service.Switch, 'climateControl:powerful_mode')).toBeUndefined();
    expect(accessory.services.filter(s => s.UUID === Service.Switch.UUID)).toEqual([legacy]);
    await legacy.getCharacteristic(Characteristic.On).handleSetRequest(true, undefined as any);
    expect(setDataMock).toHaveBeenCalledWith('climateControl', 'powerfulMode', 'on', undefined);
  });

  it('removes both legacy and namespaced switches when disabled', () => {
    const { platform, accessory } = build(dx4Airco, { showPowerfulMode: false });
    accessory.addService(Service.Switch, 'Powerful mode', 'powerful_mode');
    accessory.addService(Service.Switch, 'Powerful mode', 'climateControl:powerful_mode');

    new FeatureManager(platform, accessory, 'climateControl').setupFeatures();

    expect(accessory.getServiceById(Service.Switch, 'powerful_mode')).toBeUndefined();
    expect(accessory.getServiceById(Service.Switch, 'climateControl:powerful_mode')).toBeUndefined();
  });

  it('never touches a switch that merely shares the display name', () => {
    const { platform, accessory } = build(dx23Airco, { showPowerfulMode: false });
    const foreign = accessory.addService(Service.Switch, 'Powerful mode', 'someone_else');

    new FeatureManager(platform, accessory, 'climateControl').setupFeatures();

    expect(accessory.getServiceById(Service.Switch, 'someone_else')).toBe(foreign);
  });
});
