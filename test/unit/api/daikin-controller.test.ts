import { vi } from 'vitest';

const { apiInstance, wsInstance } = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events');
  return {
    apiInstance: { getDevices: vi.fn() },
    wsInstance: Object.assign(new EventEmitter(), {
      connect: vi.fn(),
      disconnect: vi.fn(),
      isConnected: vi.fn().mockReturnValue(true),
    }),
  };
});

vi.mock('../../../src/api/daikin-api', () => ({
  DaikinApi: class {
    constructor() {
      return apiInstance;
    }
  },
}));
vi.mock('../../../src/api/daikin-websocket', () => ({
  DaikinWebSocket: class {
    constructor() {
      return wsInstance;
    }
  },
}));
vi.mock('../../../src/api/daikin-oauth', () => ({
  DaikinOAuth: vi.fn(class {
    isAuthenticated = () => true;
    getAccessToken = vi.fn();
    refreshToken = vi.fn();
  }),
}));

import { DaikinCloudController } from '../../../src/api/daikin-controller';
import { DaikinOAuth } from '../../../src/api/daikin-oauth';
import { DEFAULT_CALLBACK_PORT } from '../../../src/constants';

const rawDevice = {
  id: 'device-1',
  managementPoints: [
    { embeddedId: 'climateControl', managementPointType: 'climateControl', onOffMode: { value: 'off' } },
  ],
};

function makeController() {
  return new DaikinCloudController({
    authMode: 'developer_portal',
    tokenFilePath: '/tmp/token',
    clientId: 'id',
    clientSecret: 'secret',
  });
}

describe('DaikinCloudController', () => {
  beforeEach(() => {
    apiInstance.getDevices.mockReset().mockResolvedValue([structuredClone(rawDevice)]);
    wsInstance.removeAllListeners();
  });

  it('defaults the callback port', () => {
    makeController();
    expect(DaikinOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ callbackServerPort: DEFAULT_CALLBACK_PORT }),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('retries gateway errors for discovery but not for polling', async () => {
    const controller = makeController();
    await controller.getCloudDevices();
    expect(apiInstance.getDevices).toHaveBeenLastCalledWith({ retryGatewayErrors: true });
    await controller.updateAllDeviceData();
    expect(apiInstance.getDevices).toHaveBeenLastCalledWith({ retryGatewayErrors: false });
  });

  it('applies WebSocket updates to the device, which emits "updated"', async () => {
    const controller = makeController();
    const [device] = await controller.getCloudDevices();
    const onUpdated = vi.fn();
    device.on('updated', onUpdated);

    wsInstance.emit('device_update', {
      deviceId: 'device-1',
      embeddedId: 'climateControl',
      managementPointId: 'mp',
      characteristicName: 'onOffMode',
      data: { name: 'onOffMode', value: 'on' },
    });

    expect(onUpdated).toHaveBeenCalledTimes(1);
    expect(device.getData('climateControl', 'onOffMode', undefined).value).toBe('on');
  });

  it('forwards WebSocket errors exactly once', () => {
    const controller = makeController();
    const onError = vi.fn();
    controller.on('error', onError);
    wsInstance.emit('error', new Error('boom'));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('WebSocket error: boom');
  });

  it('exposes the WebSocket connection state', () => {
    expect(makeController().isWebSocketConnected()).toBe(true);
  });
});
