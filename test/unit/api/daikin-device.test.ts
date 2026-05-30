import { describe, it, expect, vi } from 'vitest';
import { DaikinCloudDevice, DeviceOfflineError } from '../../../src/api/daikin-device';
import type { DaikinApi } from '../../../src/api';
import { dx4Airco } from '../../fixtures/dx4-airco';

const mockApi = { updateDevice: () => Promise.resolve() } as unknown as DaikinApi;

const buildDevice = () =>
  new DaikinCloudDevice(
    JSON.parse(JSON.stringify(dx4Airco)) as unknown as Parameters<typeof DaikinCloudDevice>[0],
    mockApi,
  );

describe('DaikinCloudDevice.applyWebSocketUpdate — partial sub-tree merging', () => {
  // Real symptom from the field: Daikin sends a fanControl WebSocket update
  // containing ONLY one operationMode/fanDirection sub-path. Before the
  // deep-merge fix the whole `fanControl.value` was overwritten with that
  // sub-path, so siblings (heating/auto/dry/fanOnly + cooling/fanSpeed +
  // cooling/fanDirection.horizontal) vanished from memory and HomeKit setters
  // skipped writes with "value === undefined" until the next 5-min poll.
  it('partial fanControl update keeps other operationModes and sibling paths intact', () => {
    const device = buildDevice();
    const ccId = 'climateControl';

    // Sanity: heating + cooling fanSpeed.modes.fixed are present pre-update.
    expect(device.getData(ccId, 'fanControl', '/operationModes/heating/fanSpeed/modes/fixed').value)
      .toBeTypeOf('number');
    expect(device.getData(ccId, 'fanControl', '/operationModes/cooling/fanSpeed/modes/fixed').value)
      .toBeTypeOf('number');

    // Mirror the exact shape Daikin pushes (from tmp/logs.txt line 82).
    device.applyWebSocketUpdate({
      deviceId: device.getId(),
      embeddedId: ccId,
      characteristicName: 'fanControl',
      data: {
        value: {
          operationModes: {
            cooling: {
              fanDirection: {
                vertical: {
                  currentMode: { name: 'currentMode', value: 'stop', settable: true, values: ['stop', 'swing', 'windNice'] },
                },
              },
            },
          },
        },
      },
    });

    // The pushed path is updated…
    expect(
      device.getData(ccId, 'fanControl', '/operationModes/cooling/fanDirection/vertical/currentMode').value,
    ).toBe('stop');

    // …and crucially, ALL sibling paths survive.
    expect(device.getData(ccId, 'fanControl', '/operationModes/heating/fanSpeed/modes/fixed').value)
      .toBeTypeOf('number');
    expect(device.getData(ccId, 'fanControl', '/operationModes/cooling/fanSpeed/modes/fixed').value)
      .toBeTypeOf('number');
    expect(device.getData(ccId, 'fanControl', '/operationModes/cooling/fanDirection/horizontal/currentMode').value)
      .toBeTypeOf('string');
    expect(device.getData(ccId, 'fanControl', '/operationModes/auto/fanSpeed/currentMode').value)
      .toBeTypeOf('string');
  });

  it('scalar value updates still replace (operationMode string)', () => {
    const device = buildDevice();
    const ccId = 'climateControl';

    device.applyWebSocketUpdate({
      deviceId: device.getId(),
      embeddedId: ccId,
      characteristicName: 'operationMode',
      data: { value: 'heating' },
    });

    expect(device.getData(ccId, 'operationMode', undefined).value).toBe('heating');
  });

  it('array values replace rather than merge (values list)', () => {
    const device = buildDevice();
    const ccId = 'climateControl';

    device.applyWebSocketUpdate({
      deviceId: device.getId(),
      embeddedId: ccId,
      characteristicName: 'operationMode',
      data: { value: 'cooling', values: ['cooling', 'heating'] },
    });

    const op = device.getData(ccId, 'operationMode', undefined);
    expect(op.values).toEqual(['cooling', 'heating']);
  });
});

describe('DaikinCloudDevice.setData — optimistic local cache write', () => {
  // Without the optimistic write, getData returns the pre-change value until the
  // next poll (up to forceUpdateDelay away). Switches deriving state from a data
  // point — e.g. the Auto fan mode switch reading fanSpeed/currentMode — keep
  // showing the old state after a related change.
  const ccId = 'climateControl';

  it('reflects a nested path write immediately (fanSpeed/currentMode)', async () => {
    const device = buildDevice();
    expect(device.getData(ccId, 'fanControl', '/operationModes/heating/fanSpeed/currentMode').value)
      .toBe('fixed');

    await device.setData(ccId, 'fanControl', '/operationModes/heating/fanSpeed/currentMode', 'auto');

    expect(device.getData(ccId, 'fanControl', '/operationModes/heating/fanSpeed/currentMode').value)
      .toBe('auto');
  });

  it('reflects a fixed fan-speed write immediately and leaves currentMode at fixed', async () => {
    const device = buildDevice();

    await device.setData(ccId, 'fanControl', '/operationModes/heating/fanSpeed/modes/fixed', 4);

    expect(device.getData(ccId, 'fanControl', '/operationModes/heating/fanSpeed/modes/fixed').value)
      .toBe(4);
    expect(device.getData(ccId, 'fanControl', '/operationModes/heating/fanSpeed/currentMode').value)
      .toBe('fixed');
  });

  it('reflects a top-level (no path) write immediately (operationMode)', async () => {
    const device = buildDevice();

    await device.setData(ccId, 'operationMode', 'cooling', undefined);

    expect(device.getData(ccId, 'operationMode', undefined).value).toBe('cooling');
  });

  it('does not throw and leaves siblings intact when the path cannot be resolved', async () => {
    const device = buildDevice();

    await device.setData(ccId, 'fanControl', '/operationModes/nonexistent/fanSpeed/currentMode', 'auto');

    // Real sibling path is untouched.
    expect(device.getData(ccId, 'fanControl', '/operationModes/heating/fanSpeed/currentMode').value)
      .toBe('fixed');
  });
});

describe('DaikinCloudDevice.setHolidayMode', () => {
  const ccId = 'climateControl';

  const buildDeviceWithApi = (apiOverride: Partial<DaikinApi>) =>
    new DaikinCloudDevice(
      JSON.parse(JSON.stringify(dx4Airco)) as unknown as Parameters<typeof DaikinCloudDevice>[0],
      { updateDevice: () => Promise.resolve(), ...apiOverride } as unknown as DaikinApi,
    );

  it('calls the dedicated holiday-mode endpoint with enabled only', async () => {
    const setHolidayMode = vi.fn().mockResolvedValue(undefined);
    const device = buildDeviceWithApi({ setHolidayMode });

    await device.setHolidayMode(ccId, true);

    expect(setHolidayMode).toHaveBeenCalledWith(device.getId(), ccId, {
      enabled: true,
      startDate: undefined,
      endDate: undefined,
    });
  });

  it('forwards optional start/end dates', async () => {
    const setHolidayMode = vi.fn().mockResolvedValue(undefined);
    const device = buildDeviceWithApi({ setHolidayMode });

    await device.setHolidayMode(ccId, true, '2026-06-01', '2026-06-15');

    expect(setHolidayMode).toHaveBeenCalledWith(device.getId(), ccId, {
      enabled: true,
      startDate: '2026-06-01',
      endDate: '2026-06-15',
    });
  });

  it('optimistically reflects the new enabled state in the cache', async () => {
    const device = buildDeviceWithApi({ setHolidayMode: vi.fn().mockResolvedValue(undefined) });
    expect((device.getData(ccId, 'holidayMode', undefined).value as { enabled: boolean }).enabled)
      .toBe(false);

    await device.setHolidayMode(ccId, true);

    expect((device.getData(ccId, 'holidayMode', undefined).value as { enabled: boolean }).enabled)
      .toBe(true);
  });

  it('throws DeviceOfflineError without calling the API when the cloud connection is down', async () => {
    const setHolidayMode = vi.fn().mockResolvedValue(undefined);
    const raw = JSON.parse(JSON.stringify(dx4Airco));
    raw.isCloudConnectionUp = { value: false };
    const device = new DaikinCloudDevice(
      raw as unknown as Parameters<typeof DaikinCloudDevice>[0],
      { updateDevice: () => Promise.resolve(), setHolidayMode } as unknown as DaikinApi,
    );

    await expect(device.setHolidayMode(ccId, true)).rejects.toBeInstanceOf(DeviceOfflineError);
    expect(setHolidayMode).not.toHaveBeenCalled();
  });
});
