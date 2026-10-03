import { vi } from 'vitest';
import { ClimateControlService } from '../../../src/services';
import type { DaikinApi } from '../../../src/api';
import { DaikinCloudDevice } from '../../../src/api';
import type { DaikinCloudAccessoryContext } from '../../../src/platform';
import { PlatformAccessory } from 'homebridge/lib/platformAccessory';
import { dx4Airco } from '../../fixtures/dx4-airco';
import { dx23Airco } from '../../fixtures/dx23-airco';
import { dx23Airco2 } from '../../fixtures/dx23-airco-2';
import { unknownJan } from '../../fixtures/unknown-jan';
import { unknownKitchenGuests } from '../../fixtures/unknown-kitchen-guests';
import { createTestPlatform, hap, useFakeTimersPerTest } from '../../helpers/platform';

const { Characteristic, uuid } = hap;

useFakeTimersPerTest();

const { TargetHeaterCoolerState } = Characteristic;

/** Deep-clone a fixture, optionally switching the climateControl operation mode. */
const withMode = (fixture: unknown, operationMode?: string): any => {
  const clone = JSON.parse(JSON.stringify(fixture));
  if (operationMode) {
    clone.managementPoints.find((m: any) => m.embeddedId === 'climateControl').operationMode.value = operationMode;
  }
  return clone;
};

const build = (fixture: unknown) => {
  const setDataMock = vi.fn().mockResolvedValue(undefined);
  const device = new DaikinCloudDevice(fixture as any, {} as DaikinApi);
  device.setData = setDataMock as unknown as typeof device.setData;
  const accessory = new PlatformAccessory<DaikinCloudAccessoryContext>('TEST', uuid.generate(device.getId()));
  accessory.context.device = device;
  const platform = createTestPlatform();
  const service = new ClimateControlService(platform, accessory, 'climateControl');
  setDataMock.mockClear();
  return { service, device, accessory, setDataMock };
};

const MP = 'climateControl';

describe('TargetHeaterCoolerState ⇒ operationMode', () => {
  it.each([
    // [fixture name, fixture, current mode, HomeKit state, expected Daikin mode or null (skipped)]
    ['dx23', dx23Airco, 'cooling', TargetHeaterCoolerState.AUTO, 'auto'],
    ['dx23', dx23Airco, 'cooling', TargetHeaterCoolerState.HEAT, 'heating'],
    ['dx23', dx23Airco, 'cooling', TargetHeaterCoolerState.COOL, null],
    ['dx23-2', dx23Airco2, 'heating', TargetHeaterCoolerState.AUTO, 'auto'],
    ['dx23-2', dx23Airco2, 'heating', TargetHeaterCoolerState.HEAT, null],
    ['dx23-2', dx23Airco2, 'heating', TargetHeaterCoolerState.COOL, 'cooling'],
    // dry / fanOnly read back as AUTO but must still switch the unit to auto
    ['dx23-2', dx23Airco2, 'dry', TargetHeaterCoolerState.AUTO, 'auto'],
    ['dx23-2', dx23Airco2, 'fanOnly', TargetHeaterCoolerState.AUTO, 'auto'],
    ['dx23-2', dx23Airco2, 'auto', TargetHeaterCoolerState.AUTO, null],
    ['unknown-jan', unknownJan, 'cooling', TargetHeaterCoolerState.AUTO, 'auto'],
    ['unknown-kitchen-guests', unknownKitchenGuests, 'cooling', TargetHeaterCoolerState.COOL, null],
  ])('%s in %s: state %i ⇒ %s', async (_name, fixture, mode, state, expected) => {
    const { service, setDataMock } = build(withMode(fixture, mode));
    await service.handleTargetHeaterCoolerStateSet(state);
    expect(setDataMock.mock.calls).toEqual(expected ? [[MP, 'operationMode', expected, undefined]] : []);
  });
});

describe('RotationSpeed ⇒ fanControl paths per operation mode', () => {
  it.each([
    // dx23-2: currentMode 'fixed' everywhere except dry (auto only, no fixed speed); maxValue 5
    ['dx23-2', dx23Airco2, 'cooling', 80, [['/operationModes/cooling/fanSpeed/modes/fixed', 4]]],
    ['dx23-2', dx23Airco2, 'auto', 80, [['/operationModes/auto/fanSpeed/modes/fixed', 4]]],
    ['dx23-2', dx23Airco2, 'fanOnly', 80, [['/operationModes/fanOnly/fanSpeed/modes/fixed', 4]]],
    ['dx23-2', dx23Airco2, 'dry', 80, []],
    // dx23: maxValue 3, fixed only
    ['dx23', dx23Airco, 'cooling', 100, [['/operationModes/cooling/fanSpeed/modes/fixed', 3]]],
    ['dx23', dx23Airco, 'auto', 67, [['/operationModes/auto/fanSpeed/modes/fixed', 2]]],
    ['dx23', dx23Airco, 'dry', 67, []],
    // unknown: currentMode 'auto' ⇒ switch to fixed first; maxValue 3
    ['unknown-jan', unknownJan, 'cooling', 67, [
      ['/operationModes/cooling/fanSpeed/currentMode', 'fixed'],
      ['/operationModes/cooling/fanSpeed/modes/fixed', 2],
    ]],
    ['unknown-kitchen-guests', unknownKitchenGuests, 'fanOnly', 67, [
      ['/operationModes/fanOnly/fanSpeed/currentMode', 'fixed'],
      ['/operationModes/fanOnly/fanSpeed/modes/fixed', 2],
    ]],
    // in 'auto' fan mode a speed equal to the stored fixed one is a HomeKit cache replay
    ['unknown-kitchen-guests', unknownKitchenGuests, 'fanOnly', 100, []],
  ])('%s in %s: %i%%', async (_name, fixture, mode, percent, expected) => {
    const { service, setDataMock } = build(withMode(fixture, mode));
    await service.handleRotationSpeedSet(percent);
    expect(setDataMock.mock.calls).toEqual((expected as Array<[string, unknown]>).map(([path, value]) => [MP, 'fanControl', path, value]));
  });
});

describe('Threshold setpoints ⇒ temperatureControl paths', () => {
  it.each(['cooling', 'auto', 'dry', 'fanOnly'])('dx23-2 in %s writes the cooling setpoint and syncs auto', async (mode) => {
    const { service, setDataMock } = build(withMode(dx23Airco2, mode));
    // heating 13 + cooling 22 → 17.5, clamped to the auto minValue 18
    await service.handleCoolingThresholdTemperatureSet(22);
    expect(setDataMock.mock.calls).toEqual([
      [MP, 'temperatureControl', '/operationModes/cooling/setpoints/roomTemperature', 22],
      [MP, 'temperatureControl', '/operationModes/auto/setpoints/roomTemperature', 18],
    ]);
  });

  it.each(['cooling', 'auto', 'dry', 'fanOnly'])('dx23 in %s writes the heating setpoint and syncs auto', async (mode) => {
    const { service, setDataMock } = build(withMode(dx23Airco, mode));
    // heating 21 + cooling 17 → 19
    await service.handleHeatingThresholdTemperatureSet(21);
    expect(setDataMock.mock.calls).toEqual([
      [MP, 'temperatureControl', '/operationModes/heating/setpoints/roomTemperature', 21],
      [MP, 'temperatureControl', '/operationModes/auto/setpoints/roomTemperature', 19],
    ]);
  });

  it.each([
    ['unknown-jan', unknownJan],
    ['unknown-kitchen-guests', unknownKitchenGuests],
  ])('%s has no auto setpoint: only the cooling setpoint is written (rounded to 0.5)', async (_name, fixture) => {
    const { service, setDataMock } = build(withMode(fixture));
    await service.handleCoolingThresholdTemperatureSet(24.3);
    expect(setDataMock.mock.calls).toEqual([[MP, 'temperatureControl', '/operationModes/cooling/setpoints/roomTemperature', 24.5]]);
  });
});

describe('Equality guards (dx4: heating, cooling=25, heating=22, swing stopped)', () => {
  it('skips a cooling threshold equal to the current setpoint (after rounding)', async () => {
    const { service, setDataMock } = build(withMode(dx4Airco));
    await service.handleCoolingThresholdTemperatureSet(25);
    await service.handleCoolingThresholdTemperatureSet(24.9);
    expect(setDataMock).not.toHaveBeenCalled();
  });

  it('skips a heating threshold equal to the current setpoint', async () => {
    const { service, setDataMock } = build(withMode(dx4Airco));
    await service.handleHeatingThresholdTemperatureSet(22);
    expect(setDataMock).not.toHaveBeenCalled();
  });

  it('skips a target state matching the current operation mode', async () => {
    const { service, setDataMock } = build(withMode(dx4Airco));
    await service.handleTargetHeaterCoolerStateSet(TargetHeaterCoolerState.HEAT);
    expect(setDataMock).not.toHaveBeenCalled();
  });

  it('skips SwingMode=disabled when both axes are already stopped', async () => {
    const { service, setDataMock } = build(withMode(dx4Airco));
    await service.handleSwingModeSet(Characteristic.SwingMode.SWING_DISABLED);
    expect(setDataMock).not.toHaveBeenCalled();
  });
});

describe('AUTO mode range change', () => {
  const deferred = () => {
    let resolve!: () => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const autoCalls = (mock: ReturnType<typeof vi.fn>) =>
    mock.mock.calls.filter(call => call[2] === '/operationModes/auto/setpoints/roomTemperature');

  it('syncs the auto setpoint once, after both thresholds settle, with the final values', async () => {
    const { service, setDataMock } = build(withMode(dx4Airco));
    const heatingWrite = deferred();
    const coolingWrite = deferred();
    setDataMock
      .mockImplementationOnce(() => heatingWrite.promise)
      .mockImplementationOnce(() => coolingWrite.promise);

    // HomeKit writes both thresholds of a range change in one request; the handlers run concurrently.
    const both = Promise.all([
      service.handleHeatingThresholdTemperatureSet(19),
      service.handleCoolingThresholdTemperatureSet(27),
    ]);

    heatingWrite.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(autoCalls(setDataMock)).toHaveLength(0); // cooling write still in flight

    coolingWrite.resolve();
    await both;

    // (19 + 27) / 2 = 23 — not the stale (19 + 25) / 2 = 22 the first handler would have used.
    expect(autoCalls(setDataMock)).toEqual([[MP, 'temperatureControl', '/operationModes/auto/setpoints/roomTemperature', 23]]);
    expect(setDataMock).toHaveBeenCalledTimes(3);
    expect(setDataMock.mock.calls[2]).toEqual([MP, 'temperatureControl', '/operationModes/auto/setpoints/roomTemperature', 23]);
  });

  it('still syncs the successful threshold when the other write fails', async () => {
    const { service, setDataMock } = build(withMode(dx4Airco));
    const heatingWrite = deferred();
    setDataMock
      .mockImplementationOnce(() => heatingWrite.promise)
      .mockImplementationOnce(() => Promise.resolve());

    const heating = service.handleHeatingThresholdTemperatureSet(19);
    const cooling = service.handleCoolingThresholdTemperatureSet(27);
    heatingWrite.reject(new Error('422'));

    await expect(heating).rejects.toBeInstanceOf(Error);
    await cooling;
    // heating stays 22 (the write failed) + cooling 27 → 24.5
    expect(autoCalls(setDataMock)).toEqual([[MP, 'temperatureControl', '/operationModes/auto/setpoints/roomTemperature', 24.5]]);
  });
});

describe('RotationSpeed characteristic refresh', () => {
  it('re-evaluates RotationSpeed on an operation mode change, not on every TargetHeaterCoolerState read', async () => {
    const { service, device } = build(withMode(dx4Airco));
    const spy = vi.spyOn(service, 'addOrUpdateCharacteristicRotationSpeed');
    const mp = (device as any).rawData.managementPoints[1];

    mp.operationMode.value = 'dry';
    await service.handleTargetHeaterCoolerStateGet();
    await service.handleTargetHeaterCoolerStateGet();
    expect(spy).not.toHaveBeenCalled();

    service.refreshValues();
    service.refreshValues();
    expect(spy).toHaveBeenCalledTimes(1);

    mp.operationMode.value = 'cooling';
    service.refreshValues();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
