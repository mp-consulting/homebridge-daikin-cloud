import { DaikinCloudRepo } from '../../../src/api/daikin-cloud.repository';
import { dx4Airco } from '../../fixtures/dx4-airco';
import { dx23Airco } from '../../fixtures/dx23-airco';
import { althermaHeatPump } from '../../fixtures/altherma-heat-pump';

type ManagementPoint = Record<string, unknown>;
type CloudDevice = { managementPoints: ManagementPoint[] } & Record<string, unknown>;

/** Data points whose `value` is replaced by 'REDACTED'. */
const MASKED_VALUES = ['ipAddress', 'macAddress', 'ssid', 'serialNumber', 'wifiConnectionSSID'];
/** Data points replaced as a whole by 'REDACTED'. */
const MASKED_WHOLE = ['consumptionData', 'schedule'];

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe.each<[string, unknown]>([
  ['dx4', dx4Airco],
  ['dx23', dx23Airco],
  ['altherma', althermaHeatPump],
])('maskSensitiveCloudDeviceData for the %s fixture', (_name, fixture) => {
  const input = clone(fixture) as CloudDevice;

  it('contains sensitive data to mask (so the test is not vacuous)', () => {
    const sensitive = input.managementPoints.flatMap(mp => [...MASKED_VALUES, ...MASKED_WHOLE].filter(key => key in mp));
    expect(sensitive.length).toBeGreaterThan(0);
  });

  it('redacts every sensitive field of every management point', () => {
    const masked = DaikinCloudRepo.maskSensitiveCloudDeviceData(input) as CloudDevice;

    masked.managementPoints.forEach((mp, index) => {
      const original = input.managementPoints[index];
      for (const key of MASKED_VALUES) {
        if (original[key]) {
          expect(mp[key]).toEqual({ ...(original[key] as object), value: 'REDACTED' });
        }
      }
      for (const key of MASKED_WHOLE) {
        if (original[key]) {
          expect(mp[key]).toBe('REDACTED');
        }
      }
    });
  });

  it('leaves non-sensitive fields untouched and does not mutate its input', () => {
    const before = clone(input);
    const masked = DaikinCloudRepo.maskSensitiveCloudDeviceData(input) as CloudDevice;

    expect(input).toEqual(before);

    const stripSensitive = (device: CloudDevice) => ({
      ...device,
      managementPoints: device.managementPoints.map(mp => Object.fromEntries(
        Object.entries(mp).filter(([key]) => !MASKED_VALUES.includes(key) && !MASKED_WHOLE.includes(key)),
      )),
    });
    expect(stripSensitive(masked)).toEqual(stripSensitive(before));
  });
});

test('returns a copy of a device without management points unchanged', () => {
  const device = { id: 'abc', deviceModel: 'Airco' };
  const masked = DaikinCloudRepo.maskSensitiveCloudDeviceData(device);
  expect(masked).toEqual(device);
  expect(masked).not.toBe(device);
});
