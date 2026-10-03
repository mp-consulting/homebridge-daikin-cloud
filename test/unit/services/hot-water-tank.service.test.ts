import { vi } from 'vitest';
import { HotWaterTankService } from '../../../src/services';
import type { DaikinApi } from '../../../src/api';
import { DaikinCloudDevice } from '../../../src/api';
import type { DaikinCloudAccessoryContext } from '../../../src/platform';
import { PlatformAccessory } from 'homebridge/lib/platformAccessory';
import { althermaHeatPump } from '../../fixtures/altherma-heat-pump';
import { althermaHeatPump2 } from '../../fixtures/altherma-heat-pump-2';
import { althermaCrSense2 } from '../../fixtures/altherma-crSense-2';
import { althermaWithEmbeddedIdZero } from '../../fixtures/altherma-with-embedded-id-zero';
import { althermaV1ckoeln } from '../../fixtures/altherma-v1ckoeln';
import { althermaFraction } from '../../fixtures/altherma-fraction';
import { althermaMiladcerkic } from '../../fixtures/altherma-miladcerkic';
import { althermaMiladcerkicOff } from '../../fixtures/altherma-miladcerkic-off';
import { PowerfulModeFeature } from '../../../src/features';
import { createTestPlatform, hap, useFakeTimersPerTest } from '../../helpers/platform';

const { Characteristic, uuid } = hap;

// Helper to get management point data from the device
const getManagementPoint = (device: DaikinCloudDevice, embeddedId: string): any => {
  return (device as any).rawData.managementPoints.find((mp: any) => mp.embeddedId === embeddedId);
};

useFakeTimersPerTest();

describe('HotWaterTankService', () => {
  let accessory: PlatformAccessory<DaikinCloudAccessoryContext>;
  let service: HotWaterTankService;

  const EMBEDDED_ID = 'domesticHotWaterTank';

  beforeEach(() => {
    const mockApi = {} as DaikinApi;
    accessory = new PlatformAccessory<DaikinCloudAccessoryContext>('ACCESSORY_NAME', uuid.generate('ACCESSORY_UUID'));
    // Use a deep copy of the fixture to isolate test mutations
    accessory.context.device = new DaikinCloudDevice(JSON.parse(JSON.stringify(althermaHeatPump)) as any, mockApi);
    accessory.context.device.getLastUpdated = vi.fn().mockReturnValue(new Date(1987, 0, 19, 0, 0, 0, 0));

    const platform = createTestPlatform({ showExtraFeatures: true });

    service = new HotWaterTankService(platform, accessory, EMBEDDED_ID);
  });

  it('should get the current heating cooling state', async () => {
    expect(await service.handleHotWaterTankCurrentHeatingCoolingStateGet()).toBe(Characteristic.CurrentHeatingCoolingState.HEAT);

    getManagementPoint(accessory.context.device, EMBEDDED_ID).onOffMode = { value: 'off' };

    expect(await service.handleHotWaterTankTargetHeatingCoolingStateGet()).toBe(Characteristic.CurrentHeatingCoolingState.OFF);
  });

  it('should get the current temperature', async () => {
    expect(await service.handleHotWaterTankCurrentTemperatureGet()).toBe(48);
  });

  it('should get the target heating cooling temperature', async () => {
    expect(await service.handleHotWaterTankHeatingTargetTemperatureGet()).toBe(48);
  });

  it('should get the target heating cooling state', async () => {
    const setOperationMode = (value: string) => {
      getManagementPoint(accessory.context.device, EMBEDDED_ID).operationMode = {
        settable: true,
        values: ['auto', 'dry', 'cooling', 'heating', 'fanOnly'],
        value,
      };
    };

    expect(await service.handleHotWaterTankTargetHeatingCoolingStateGet()).toBe(Characteristic.TargetHeatingCoolingState.HEAT);

    setOperationMode('cooling');
    expect(await service.handleHotWaterTankTargetHeatingCoolingStateGet()).toBe(Characteristic.TargetHeatingCoolingState.COOL);

    setOperationMode('auto');
    expect(await service.handleHotWaterTankTargetHeatingCoolingStateGet()).toBe(Characteristic.TargetHeatingCoolingState.AUTO);

    setOperationMode('fanOnly');
    expect(await service.handleHotWaterTankTargetHeatingCoolingStateGet()).toBe(Characteristic.TargetHeatingCoolingState.AUTO);

    setOperationMode('dry');
    expect(await service.handleHotWaterTankTargetHeatingCoolingStateGet()).toBe(Characteristic.TargetHeatingCoolingState.AUTO);

    getManagementPoint(accessory.context.device, EMBEDDED_ID).onOffMode = { value: 'off' };
    expect(await service.handleHotWaterTankTargetHeatingCoolingStateGet()).toBe(Characteristic.TargetHeatingCoolingState.OFF);
  });

  it('should get the powerful mode', async () => {
    const powerful = service.featureManager.getFeature(PowerfulModeFeature);
    expect(powerful).toBeDefined();
    expect(await powerful!.handleGet()).toBe(false);
  });
});

type TankFixture = {
  name: string;
  json: unknown;
  tankId: string;
  on: boolean;
  target: number;
  min: number;
  max: number;
};

const TANK_FIXTURES: TankFixture[] = [
  { name: 'altherma-heat-pump', json: althermaHeatPump, tankId: 'domesticHotWaterTank', on: true, target: 48, min: 30, max: 60 },
  { name: 'altherma-heat-pump-2', json: althermaHeatPump2, tankId: 'domesticHotWaterTank', on: true, target: 50, min: 30, max: 60 },
  { name: 'altherma-crSense-2', json: althermaCrSense2, tankId: '2', on: true, target: 45, min: 30, max: 60 },
  { name: 'altherma-with-embedded-id-zero', json: althermaWithEmbeddedIdZero, tankId: '2', on: true, target: 45, min: 30, max: 60 },
  { name: 'altherma-v1ckoeln', json: althermaV1ckoeln, tankId: 'domesticHotWaterTank', on: true, target: 46, min: 30, max: 60 },
  { name: 'altherma-fraction', json: althermaFraction, tankId: 'domesticHotWaterTank', on: true, target: 47, min: 30, max: 60 },
  { name: 'altherma-miladcerkic', json: althermaMiladcerkic, tankId: 'domesticHotWaterTank', on: true, target: 50, min: 30, max: 55 },
  { name: 'altherma-miladcerkic-off', json: althermaMiladcerkicOff, tankId: 'domesticHotWaterTank', on: false, target: 50, min: -127, max: 127 },
];

const buildTank = (fixture: TankFixture, config: Record<string, unknown> = {}) => {
  const setDataMock = vi.fn().mockResolvedValue(undefined);
  const device = new DaikinCloudDevice(JSON.parse(JSON.stringify(fixture.json)) as any, {} as DaikinApi);
  device.setData = setDataMock as unknown as typeof device.setData;
  const accessory = new PlatformAccessory<DaikinCloudAccessoryContext>('TANK', uuid.generate(fixture.name));
  accessory.context.device = device;
  const platform = createTestPlatform(config);
  const tank = new HotWaterTankService(platform, accessory, fixture.tankId);
  return { tank, accessory, setDataMock };
};

describe.each(TANK_FIXTURES)('HotWaterTankService setters ($name)', (fixture) => {
  it('writes the rounded domestic hot water setpoint', async () => {
    const { tank, setDataMock } = buildTank(fixture);
    const next = fixture.target - 1.2;

    await tank.handleHotWaterTankHeatingTargetTemperatureSet(next);

    expect(setDataMock).toHaveBeenCalledTimes(1);
    expect(setDataMock).toHaveBeenCalledWith(
      fixture.tankId, 'temperatureControl',
      '/operationModes/heating/setpoints/domesticHotWaterTemperature', Math.round(next * 2) / 2,
    );
  });

  it('skips the setpoint write when the value is unchanged', async () => {
    const { tank, setDataMock } = buildTank(fixture);
    await tank.handleHotWaterTankHeatingTargetTemperatureSet(fixture.target);
    expect(setDataMock).not.toHaveBeenCalled();
  });

  it('exposes the device setpoint range on TargetTemperature', () => {
    const { accessory } = buildTank(fixture);
    const props = accessory.getService('Hot water tank')!.getCharacteristic(Characteristic.TargetTemperature).props;
    expect(props.minValue).toBe(fixture.min);
    expect(props.maxValue).toBe(fixture.max);
  });

  it('OFF writes onOffMode=off only when the tank is on', async () => {
    const { tank, setDataMock } = buildTank(fixture);
    await tank.handleHotWaterTankTargetHeatingCoolingStateSet(Characteristic.TargetHeatingCoolingState.OFF);
    if (fixture.on) {
      expect(setDataMock).toHaveBeenCalledTimes(1);
      expect(setDataMock).toHaveBeenCalledWith(fixture.tankId, 'onOffMode', 'off', undefined);
    } else {
      expect(setDataMock).not.toHaveBeenCalled();
    }
  });

  it('HEAT turns the tank on when off and never rewrites the (fixed) heating mode', async () => {
    const { tank, setDataMock } = buildTank(fixture);
    await tank.handleHotWaterTankTargetHeatingCoolingStateSet(Characteristic.TargetHeatingCoolingState.HEAT);
    if (fixture.on) {
      expect(setDataMock).not.toHaveBeenCalled();
    } else {
      expect(setDataMock).toHaveBeenCalledTimes(1);
      expect(setDataMock).toHaveBeenCalledWith(fixture.tankId, 'onOffMode', 'on', undefined);
    }
  });

  it('AUTO does not write a non-settable operationMode', async () => {
    const { tank, setDataMock } = buildTank(fixture);
    await tank.handleHotWaterTankTargetHeatingCoolingStateSet(Characteristic.TargetHeatingCoolingState.AUTO);
    expect(setDataMock).not.toHaveBeenCalledWith(fixture.tankId, 'operationMode', expect.anything(), undefined);
    if (fixture.on) {
      expect(setDataMock).not.toHaveBeenCalled();
    } else {
      expect(setDataMock).toHaveBeenCalledWith(fixture.tankId, 'onOffMode', 'on', undefined);
    }
  });

  it('AUTO writes onOffMode then operationMode when the mode is settable', async () => {
    const { tank, accessory, setDataMock } = buildTank(fixture);
    const mp = (accessory.context.device as any).rawData.managementPoints.find((m: any) => m.embeddedId === fixture.tankId);
    mp.operationMode = { settable: true, values: ['heating', 'auto'], value: 'heating' };

    await tank.handleHotWaterTankTargetHeatingCoolingStateSet(Characteristic.TargetHeatingCoolingState.AUTO);

    const expected = [
      ...(fixture.on ? [] : [[fixture.tankId, 'onOffMode', 'on', undefined]]),
      [fixture.tankId, 'operationMode', 'auto', undefined],
    ];
    expect(setDataMock.mock.calls).toEqual(expected);
  });

  it('Powerful mode switch writes powerfulMode on the tank management point', async () => {
    const { tank, setDataMock } = buildTank(fixture, { showPowerfulMode: true });
    const powerful = tank.featureManager.getFeature(PowerfulModeFeature)!;
    expect(powerful.isSupported()).toBe(true);

    await powerful.handleSet(true);
    await powerful.handleSet(false);

    expect(setDataMock.mock.calls).toEqual([
      [fixture.tankId, 'powerfulMode', 'on', undefined],
      [fixture.tankId, 'powerfulMode', 'off', undefined],
    ]);
  });
});
