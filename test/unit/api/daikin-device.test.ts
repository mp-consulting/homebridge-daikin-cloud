import { describe, it, expect } from 'vitest';
import { DaikinCloudDevice } from '../../../src/api/daikin-device';
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
