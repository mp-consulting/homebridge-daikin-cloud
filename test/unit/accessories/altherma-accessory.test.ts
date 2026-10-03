import { vi, describe, it, expect, afterEach } from 'vitest';
import type { PlatformAccessory } from 'homebridge/lib/platformAccessory';
import type { DaikinCloudAccessoryContext } from '../../../src/platform';
import { AlthermaAccessory } from '../../../src/accessories';
import type { DaikinApi } from '../../../src/api';
import { DaikinCloudDevice } from '../../../src/api';
import { PowerfulModeFeature } from '../../../src/features';
import { althermaHeatPump } from '../../fixtures/altherma-heat-pump';
import { createTestApi, createTestPlatform, useFakeTimersPerTest } from '../../helpers/platform';

useFakeTimersPerTest();

afterEach(() => {
  vi.restoreAllMocks();
});

const TANK = 'domesticHotWaterTank';

const build = (config: Record<string, unknown>, legacySwitch = false) => {
  const device = new DaikinCloudDevice(JSON.parse(JSON.stringify(althermaHeatPump)) as never, {} as DaikinApi);
  const setData = vi.spyOn(device, 'setData').mockResolvedValue(undefined);
  const api = createTestApi();
  const platform = createTestPlatform(config, api);
  const accessory = new api.platformAccessory('Altherma', api.hap.uuid.generate(device.getId()));
  accessory.context.device = device;
  const legacy = legacySwitch ? accessory.addService(api.hap.Service.Switch, 'Powerful mode', 'powerful_mode') : undefined;

  const altherma = new AlthermaAccessory(platform, accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);
  // Only the powerful-mode switches (showExtraFeatures also enables e.g. the holiday switch).
  const switches = accessory.services.filter(s => s.UUID === api.hap.Service.Switch.UUID && s.subtype?.endsWith('powerful_mode'));
  return { api, accessory, altherma, switches, legacy, setData };
};

describe('AlthermaAccessory — hot water tank Powerful mode switch', () => {
  it('is created (namespaced to the tank) when showPowerfulMode is on, and survives the climateControl FeatureManager', () => {
    const { api, accessory, switches } = build({ showPowerfulMode: true });
    expect(switches).toHaveLength(1);
    expect(accessory.getServiceById(api.hap.Service.Switch, `${TANK}:powerful_mode`)).toBe(switches[0]);
  });

  it('follows showPowerfulMode, not only showExtraFeatures', () => {
    expect(build({ showExtraFeatures: true, showPowerfulMode: false }).switches).toHaveLength(0);
    expect(build({ showExtraFeatures: true }).switches).toHaveLength(1);
    expect(build({}).switches).toHaveLength(0);
  });

  it('keeps a cached legacy switch (same HomeKit identity) and binds it to the tank', async () => {
    const { api, switches, legacy, setData } = build({ showPowerfulMode: true }, true);
    // The climateControl FeatureManager runs first and has no powerfulMode: it must not remove it.
    expect(switches).toEqual([legacy]);

    await legacy!.getCharacteristic(api.hap.Characteristic.On).handleSetRequest(true, undefined as any);
    expect(setData).toHaveBeenCalledWith(TANK, 'powerfulMode', 'on', undefined);
  });

  it('removes the cached legacy switch when the tank powerful mode is disabled', () => {
    const { switches } = build({ showPowerfulMode: false }, true);
    expect(switches).toHaveLength(0);
  });

  it('exposes the tank switch through the tank FeatureManager', async () => {
    const { altherma } = build({ showPowerfulMode: true });
    expect(altherma.service!.featureManager.getFeature(PowerfulModeFeature)!.isSupported()).toBe(false);
    expect(altherma.hotWaterTankService!.featureManager.getFeature(PowerfulModeFeature)!.isSupported()).toBe(true);
  });
});
