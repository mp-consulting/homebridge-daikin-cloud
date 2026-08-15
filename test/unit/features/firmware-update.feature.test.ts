import { vi } from 'vitest';
import { FirmwareUpdateFeature } from '../../../src/features/modes';
import type { DaikinApi } from '../../../src/api';
import { DaikinCloudDevice } from '../../../src/api';
import { MockPlatformConfig } from '../../mocks';
import type { DaikinCloudAccessoryContext } from '../../../src/platform';
import { DaikinCloudPlatform } from '../../../src/platform';
import { PlatformAccessory } from 'homebridge/lib/platformAccessory';
import { uuid } from 'hap-nodejs';
import { dx4Airco } from '../../fixtures/dx4-airco';

import { HomebridgeAPI } from 'homebridge/lib/api.js';
import { Logger } from 'homebridge/lib/logger.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const STAGED_UPDATE = {
  id: 'b28f1f7f-1111-2222-3333-444455556666',
  description: 'DX4 WLAN security update 2_3_0',
  version: '2_3_0',
  type: 'optional',
};

/** Deep-clone dx4 and shape the gateway MP's firmware characteristics. */
const dx4WithFirmware = (opts: {
  supported?: boolean;
  staged?: boolean;
  status?: string;
} = {}): unknown => {
  const clone = JSON.parse(JSON.stringify(dx4Airco));
  const gateway = clone.managementPoints.find((m: any) => m.embeddedId === 'gateway');
  if (opts.supported !== false) {
    gateway.isFirmwareUpdateSupported = { settable: false, value: true };
  }
  if (opts.staged) {
    gateway.firmwareUpdate = { settable: true, value: { ...STAGED_UPDATE } };
  }
  if (opts.status) {
    gateway.firmwareUpdateStatus = { settable: false, value: opts.status };
  }
  return clone;
};

const buildFeature = (
  fixture: unknown,
  config: { showFirmwareUpdateSwitch?: boolean; showExtraFeatures?: boolean } = {},
): {
  feature: FirmwareUpdateFeature;
  accessory: PlatformAccessory<DaikinCloudAccessoryContext>;
  device: DaikinCloudDevice;
  triggerMock: ReturnType<typeof vi.fn>;
} => {
  const triggerMock = vi.fn().mockResolvedValue(undefined);
  const mockApi = {
    updateDevice: vi.fn().mockResolvedValue(undefined),
    triggerFirmwareUpdate: triggerMock,
  } as unknown as DaikinApi;
  const device = new DaikinCloudDevice(JSON.parse(JSON.stringify(fixture)) as any, mockApi);

  const accessory = new PlatformAccessory<DaikinCloudAccessoryContext>('TEST', uuid.generate(device.getId()));
  accessory.context.device = device;

  const platformConfig = new MockPlatformConfig(config.showExtraFeatures === true);
  (platformConfig as any).showFirmwareUpdateSwitch = config.showFirmwareUpdateSwitch;

  const platform = new DaikinCloudPlatform(new Logger(), platformConfig, new HomebridgeAPI());
  const feature = new FirmwareUpdateFeature(platform, accessory, 'climateControl');
  return { feature, accessory, device, triggerMock };
};

describe('FirmwareUpdateFeature — support and enablement', () => {
  it('is supported when the gateway reports isFirmwareUpdateSupported', () => {
    const { feature } = buildFeature(dx4WithFirmware(), { showFirmwareUpdateSwitch: true });
    expect(feature.isSupported()).toBe(true);
  });

  it('is not supported when the gateway lacks isFirmwareUpdateSupported', () => {
    const { feature } = buildFeature(dx4WithFirmware({ supported: false }), { showFirmwareUpdateSwitch: true });
    expect(feature.isSupported()).toBe(false);
  });

  it('exposes a Switch service when supported and explicitly enabled', () => {
    const { feature, accessory } = buildFeature(dx4WithFirmware(), { showFirmwareUpdateSwitch: true });
    feature.setup();
    expect(accessory.getService('Firmware Update')).toBeDefined();
  });

  it('is NOT enabled implicitly by the legacy showExtraFeatures flag', () => {
    const { feature, accessory } = buildFeature(dx4WithFirmware(), { showExtraFeatures: true });
    feature.setup();
    expect(accessory.getService('Firmware Update')).toBeUndefined();
  });
});

describe('FirmwareUpdateFeature — state and install', () => {
  it('reports ON while an update is in progress', async () => {
    const { feature } = buildFeature(
      dx4WithFirmware({ status: 'in-progress' }),
      { showFirmwareUpdateSwitch: true },
    );
    expect(await feature.handleGet()).toBe(true);
  });

  it('reports OFF when no update is running', async () => {
    const { feature } = buildFeature(dx4WithFirmware({ staged: true }), { showFirmwareUpdateSwitch: true });
    expect(await feature.handleGet()).toBe(false);
  });

  it('turning ON with a staged update triggers the install with the staged id', async () => {
    const { feature, device, triggerMock } = buildFeature(
      dx4WithFirmware({ staged: true }),
      { showFirmwareUpdateSwitch: true },
    );
    feature.setup();

    await feature.handleSet(true);

    expect(triggerMock).toHaveBeenCalledWith(device.getId(), 'gateway', STAGED_UPDATE.id);
    // Optimistic cache: the switch reflects in-progress immediately
    expect(await feature.handleGet()).toBe(true);
  });

  it('turning ON with no staged update does not call the API and reverts the switch', async () => {
    const { feature, triggerMock } = buildFeature(dx4WithFirmware(), { showFirmwareUpdateSwitch: true });
    feature.setup();

    await feature.handleSet(true);
    await vi.runAllTimersAsync();

    expect(triggerMock).not.toHaveBeenCalled();
    expect(await feature.handleGet()).toBe(false);
  });

  it('turning OFF during an install does not call the API (updates cannot be cancelled)', async () => {
    const { feature, triggerMock } = buildFeature(
      dx4WithFirmware({ status: 'in-progress' }),
      { showFirmwareUpdateSwitch: true },
    );
    feature.setup();

    await feature.handleSet(false);
    await vi.runAllTimersAsync();

    expect(triggerMock).not.toHaveBeenCalled();
    expect(await feature.handleGet()).toBe(true);
  });
});

describe('DaikinCloudDevice — firmware helpers', () => {
  const buildDevice = (fixture: unknown, api?: Partial<DaikinApi>) =>
    new DaikinCloudDevice(
      JSON.parse(JSON.stringify(fixture)) as any,
      { updateDevice: vi.fn(), triggerFirmwareUpdate: vi.fn().mockResolvedValue(undefined), ...api } as unknown as DaikinApi,
    );

  it('getFirmwareUpdateInfo returns undefined when no update is staged', () => {
    const device = buildDevice(dx4WithFirmware());
    expect(device.getFirmwareUpdateInfo('gateway')).toBeUndefined();
  });

  it('getFirmwareUpdateInfo returns the staged update details', () => {
    const device = buildDevice(dx4WithFirmware({ staged: true }));
    expect(device.getFirmwareUpdateInfo('gateway')).toEqual(STAGED_UPDATE);
  });

  it('getManagementPointIdByType resolves the gateway management point', () => {
    const device = buildDevice(dx4Airco);
    expect(device.getManagementPointIdByType('gateway')).toBe('gateway');
  });

  it('triggerFirmwareUpdate throws when nothing is staged', async () => {
    const device = buildDevice(dx4WithFirmware());
    await expect(device.triggerFirmwareUpdate('gateway')).rejects.toThrow('No firmware update');
  });

  it('triggerFirmwareUpdate calls the API and marks the update in progress', async () => {
    const device = buildDevice(dx4WithFirmware({ staged: true }));

    const info = await device.triggerFirmwareUpdate('gateway');

    expect(info.version).toBe(STAGED_UPDATE.version);
    expect(device.getFirmwareUpdateStatus('gateway')).toBe('in-progress');
  });
});
