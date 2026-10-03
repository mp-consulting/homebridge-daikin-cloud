import { DaikinCloudDevice } from '../../../src/api';
import type { DaikinApi } from '../../../src/api';
import { DeviceCapabilityDetector, getCapabilitySummary } from '../../../src/device';
import type { DeviceCapabilities, DeviceTemperatureCapabilities } from '../../../src/types';
import { dx4Airco } from '../../fixtures/dx4-airco';
import { dx23Airco } from '../../fixtures/dx23-airco';
import { dx23Airco2 } from '../../fixtures/dx23-airco-2';
import { unknownJan } from '../../fixtures/unknown-jan';
import { unknownKitchenGuests } from '../../fixtures/unknown-kitchen-guests';
import { althermaHeatPump } from '../../fixtures/altherma-heat-pump';
import { althermaHeatPump2 } from '../../fixtures/altherma-heat-pump-2';
import { althermaCrSense2 } from '../../fixtures/altherma-crSense-2';
import { althermaWithEmbeddedIdZero } from '../../fixtures/altherma-with-embedded-id-zero';
import { althermaV1ckoeln } from '../../fixtures/altherma-v1ckoeln';
import { althermaFraction } from '../../fixtures/altherma-fraction';
import { althermaMiladcerkic } from '../../fixtures/altherma-miladcerkic';
import { althermaMiladcerkicOff } from '../../fixtures/altherma-miladcerkic-off';

const detect = (fixture: unknown, managementPointId: string) => {
  const device = new DaikinCloudDevice(JSON.parse(JSON.stringify(fixture)) as any, {} as DaikinApi);
  return new DeviceCapabilityDetector(device, managementPointId);
};

const NONE: Partial<DeviceCapabilities> = {
  hasPowerfulMode: false,
  hasEconoMode: false,
  hasStreamerMode: false,
  hasOutdoorSilentMode: false,
  hasIndoorSilentMode: false,
  hasAutoFanMode: false,
  hasSwingModeVertical: false,
  hasSwingModeHorizontal: false,
  hasFanControl: false,
};

const ALL_MODES_AC = ['auto', 'dry', 'cooling', 'heating', 'fanOnly'];

type Case = [string, unknown, string, Partial<DeviceCapabilities>, DeviceTemperatureCapabilities];

const AIR_CONDITIONERS: Case[] = [
  ['dx4', dx4Airco, 'climateControl', {
    hasDomesticHotWaterTank: false,
    hasPowerfulMode: true, hasEconoMode: true, hasStreamerMode: true, hasOutdoorSilentMode: true,
    hasIndoorSilentMode: true, hasAutoFanMode: true, hasSwingModeVertical: true, hasSwingModeHorizontal: true,
    hasFanControl: true, hasHolidayMode: true, hasDryOperationMode: true, hasFanOnlyOperationMode: true,
    hasControlMode: false, hasSetpointMode: false,
  }, {
    cooling: { minValue: 18, maxValue: 33, stepValue: 0.5 },
    heating: { minValue: 10, maxValue: 31, stepValue: 0.5 },
    auto: { minValue: 18, maxValue: 30, stepValue: 0.5 },
  }],
  ['dx23', dx23Airco, 'climateControl', {
    ...NONE, hasDomesticHotWaterTank: false, hasFanControl: true, hasHolidayMode: true,
    hasDryOperationMode: true, hasFanOnlyOperationMode: true,
  }, {
    cooling: { minValue: 16, maxValue: 32, stepValue: 0.5 },
    heating: { minValue: 16, maxValue: 32, stepValue: 0.5 },
    auto: { minValue: 16, maxValue: 32, stepValue: 0.5 },
  }],
  ['dx23-2', dx23Airco2, 'climateControl', {
    ...NONE, hasPowerfulMode: true, hasIndoorSilentMode: true, hasAutoFanMode: true, hasSwingModeVertical: true,
    hasFanControl: true, hasHolidayMode: true,
  }, {
    cooling: { minValue: 18, maxValue: 32, stepValue: 0.5 },
    heating: { minValue: 10, maxValue: 30, stepValue: 0.5 },
    auto: { minValue: 18, maxValue: 30, stepValue: 0.5 },
  }],
  ['unknown-jan', unknownJan, 'climateControl', {
    ...NONE, hasAutoFanMode: true, hasFanControl: true, hasHolidayMode: true,
    hasHeatingMode: false, hasAutoMode: false, hasCoolingMode: true,
  }, { cooling: { minValue: 16, maxValue: 32, stepValue: 0.1 } }],
  ['unknown-kitchen-guests', unknownKitchenGuests, 'climateControl', {
    ...NONE, hasAutoFanMode: true, hasFanControl: true, hasHolidayMode: true,
    hasHeatingMode: false, hasAutoMode: false, hasCoolingMode: true,
  }, { cooling: { minValue: 16, maxValue: 32, stepValue: 0.1 } }],
];

describe.each(AIR_CONDITIONERS)('DeviceCapabilityDetector — %s', (_name, fixture, mpId, expected, temperatures) => {
  it('detects the expected capabilities', () => {
    expect(detect(fixture, mpId).getCapabilities()).toMatchObject({ hasClimateControl: true, hasGateway: true, ...expected });
  });

  it('detects the temperature ranges', () => {
    expect(detect(fixture, mpId).getTemperatureCapabilities()).toEqual(temperatures);
  });
});

it('lists every operation mode of a full-featured unit', () => {
  expect([...detect(dx23Airco, 'climateControl').getCapabilities().supportedOperationModes].sort())
    .toEqual([...ALL_MODES_AC].sort());
});

// [name, fixture, climateControl id, tank id, climate room-temperature ranges, tank hot water range]
type AlthermaCase = [string, unknown, string, string, DeviceTemperatureCapabilities, DeviceTemperatureCapabilities['domesticHotWater']];

const ROOM_RANGES: DeviceTemperatureCapabilities = {
  cooling: { minValue: 15, maxValue: 35, stepValue: 0.5 },
  heating: { minValue: 12, maxValue: 30, stepValue: 0.5 },
  auto: { minValue: 12, maxValue: 30, stepValue: 0.5 },
};
const DHW_30_60 = { minValue: 30, maxValue: 60, stepValue: 1 };

const ALTHERMAS: AlthermaCase[] = [
  ['altherma-heat-pump', althermaHeatPump, 'climateControlMainZone', 'domesticHotWaterTank', {
    heating: { minValue: 12, maxValue: 30, stepValue: 0.5 },
    auto: { minValue: 12, maxValue: 30, stepValue: 0.5 },
  }, DHW_30_60],
  ['altherma-heat-pump-2', althermaHeatPump2, 'climateControlMainZone', 'domesticHotWaterTank', {}, DHW_30_60],
  ['altherma-crSense-2', althermaCrSense2, '1', '2', ROOM_RANGES, DHW_30_60],
  ['altherma-with-embedded-id-zero', althermaWithEmbeddedIdZero, '1', '2', ROOM_RANGES, DHW_30_60],
  ['altherma-v1ckoeln', althermaV1ckoeln, 'climateControlMainZone', 'domesticHotWaterTank', {}, DHW_30_60],
  ['altherma-fraction', althermaFraction, 'climateControlMainZone', 'domesticHotWaterTank', {}, DHW_30_60],
  ['altherma-miladcerkic', althermaMiladcerkic, 'climateControlMainZone', 'domesticHotWaterTank', {},
    { minValue: 30, maxValue: 55, stepValue: 1 }],
  ['altherma-miladcerkic-off', althermaMiladcerkicOff, 'climateControlMainZone', 'domesticHotWaterTank', {},
    { minValue: -127, maxValue: 127, stepValue: 1 }],
];

describe.each(ALTHERMAS)('DeviceCapabilityDetector — %s', (_name, fixture, climateId, tankId, roomRanges, hotWater) => {
  it('climateControl: no fan/AC features, Altherma control/setpoint modes, holiday mode', () => {
    expect(detect(fixture, climateId).getCapabilities()).toMatchObject({
      ...NONE,
      hasClimateControl: true,
      hasDomesticHotWaterTank: true,
      hasHeatingMode: true,
      hasDryOperationMode: false,
      hasFanOnlyOperationMode: false,
      hasControlMode: true,
      hasSetpointMode: true,
      hasHolidayMode: true,
    });
  });

  it('climateControl: room temperature ranges (none for leaving-water setpoints)', () => {
    expect(detect(fixture, climateId).getTemperatureCapabilities()).toEqual(roomRanges);
  });

  it('domesticHotWaterTank: powerful mode and the hot water range are detected', () => {
    const detector = detect(fixture, tankId);
    expect(detector.getCapabilities()).toMatchObject({
      hasPowerfulMode: true,
      hasEconoMode: false,
      hasHolidayMode: false,
      supportedOperationModes: ['heating'],
    });
    expect(detector.getTemperatureCapabilities()).toEqual({ domesticHotWater: hotWater });
  });
});

describe('getCapabilitySummary', () => {
  it('summarises a full-featured unit', () => {
    expect(getCapabilitySummary(detect(dx4Airco, 'climateControl').getCapabilities())).toBe(
      'powerful, econo, streamer, outdoor-silent, indoor-silent, auto-fan, fan-speed, swing, dry-mode, fan-only, holiday',
    );
  });

  it('reports only real features (missing data points are not "supported")', () => {
    expect(getCapabilitySummary(detect(althermaHeatPump, 'climateControlMainZone').getCapabilities())).toBe('holiday');
  });
});
