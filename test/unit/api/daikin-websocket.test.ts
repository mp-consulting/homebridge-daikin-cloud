import { vi } from 'vitest';
import type { OAuthProvider } from '../../../src/api/daikin-types';

const { sockets, FakeWebSocket } = await vi.hoisted(async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  const created: any[] = [];

  class Fake extends Emitter {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    readyState = Fake.CONNECTING;
    autoPong = true;
    ping = vi.fn(() => {
      if (this.autoPong) {
        void Promise.resolve().then(() => this.emit('pong'));
      }
    });
    close = vi.fn(() => {
      this.readyState = Fake.CLOSED;
    });
    terminate = vi.fn(() => {
      const wasConnecting = this.readyState === Fake.CONNECTING;
      this.readyState = Fake.CLOSED;
      // Like ws: aborting a handshake emits 'error' asynchronously
      void Promise.resolve().then(() => {
        if (wasConnecting) {
          this.emit('error', new Error('WebSocket was closed before the connection was established'));
        }
        this.emit('close', 1006, Buffer.from(''));
      });
    });

    constructor(public url: string, public options: any) {
      super();
      created.push(this);
    }

    /** Test helper: complete the handshake */
    open() {
      this.readyState = Fake.OPEN;
      this.emit('open');
    }

    /** Test helper: server/network closed the connection */
    drop(code = 1006) {
      this.readyState = Fake.CLOSED;
      this.emit('close', code, Buffer.from(''));
    }
  }

  return { sockets: created, FakeWebSocket: Fake };
});

vi.mock('ws', () => ({ default: FakeWebSocket }));

import { DaikinWebSocket } from '../../../src/api/daikin-websocket';

function makeOAuth(): OAuthProvider & { getAccessToken: ReturnType<typeof vi.fn> } {
  return {
    getAccessToken: vi.fn().mockResolvedValue('token'),
    isAuthenticated: vi.fn().mockReturnValue(true),
    refreshToken: vi.fn(),
  } as any;
}

function makeSocket(oauth = makeOAuth()) {
  const ws = new DaikinWebSocket(oauth);
  const errors: Error[] = [];
  ws.on('error', (e: Error) => errors.push(e));
  return { ws, oauth, errors };
}

const last = () => sockets[sockets.length - 1];

/** Advance until a new socket appears, returning the elapsed delay */
async function timeUntilNextSocket(maxMs = 400000): Promise<number> {
  const before = sockets.length;
  let elapsed = 0;
  while (sockets.length === before && elapsed < maxMs) {
    await vi.advanceTimersByTimeAsync(50);
    elapsed += 50;
  }
  return elapsed;
}

describe('DaikinWebSocket', () => {
  beforeEach(() => {
    sockets.length = 0;
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // jitter factor 1.0
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('grows the reconnect backoff exponentially and caps it at 5 minutes', async () => {
    const { ws } = makeSocket();
    await ws.connect();

    const delays: number[] = [];
    for (let i = 0; i < 11; i++) {
      last().drop();
      delays.push(await timeUntilNextSocket());
    }

    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000, 300000, 300000]);
    ws.disconnect();
  });

  it('does not reset the backoff when the connection drops within 60s of opening', async () => {
    const { ws } = makeSocket();
    await ws.connect();
    last().drop();
    expect(await timeUntilNextSocket()).toBe(1000);

    last().open();
    await vi.advanceTimersByTimeAsync(59000);
    last().drop();
    expect(await timeUntilNextSocket()).toBe(2000);
    ws.disconnect();
  });

  it('resets the backoff once the connection has been stable for 60s', async () => {
    const { ws } = makeSocket();
    await ws.connect();
    last().drop();
    await timeUntilNextSocket();
    last().drop();
    expect(await timeUntilNextSocket()).toBe(2000);

    last().open();
    await vi.advanceTimersByTimeAsync(60000);
    last().drop();
    expect(await timeUntilNextSocket()).toBe(1000);
    ws.disconnect();
  });

  it.each([
    [0, 750],
    [0.9999, 1250],
  ])('applies ±25%% jitter to the reconnect delay (random=%s)', async (random, expected) => {
    vi.mocked(Math.random).mockReturnValue(random);
    const { ws } = makeSocket();
    await ws.connect();
    last().drop();

    await vi.advanceTimersByTimeAsync(expected - 1);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(2);
    ws.disconnect();
  });

  it('terminates the connection when a pong is missing', async () => {
    const { ws } = makeSocket();
    await ws.connect();
    const socket = last();
    socket.autoPong = false;
    socket.open();

    await vi.advanceTimersByTimeAsync(30000);
    expect(socket.ping).toHaveBeenCalledTimes(1);
    expect(socket.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10000);
    expect(socket.terminate).toHaveBeenCalled();
    ws.disconnect();
  });

  it('keeps the connection when pongs arrive', async () => {
    const { ws } = makeSocket();
    await ws.connect();
    const socket = last();
    socket.open();

    await vi.advanceTimersByTimeAsync(120000);
    expect(socket.ping).toHaveBeenCalledTimes(4);
    expect(socket.terminate).not.toHaveBeenCalled();
    expect(ws.isConnected()).toBe(true);
    ws.disconnect();
  });

  it('emits device_update for a valid gateway characteristic event', async () => {
    const { ws } = makeSocket();
    const updates: unknown[] = [];
    ws.on('device_update', (u) => updates.push(u));
    await ws.connect();
    last().open();

    last().emit('message', Buffer.from(JSON.stringify({
      event: 'gateway:managementpoint:characteristic',
      eventType: 'update',
      embeddedId: 'climateControl',
      managementPointId: 'mp-1',
      gatewayDeviceId: 'device-1',
      type: 'climateControl',
      data: { name: 'onOffMode', value: 'on' },
    })));

    expect(updates).toEqual([{
      deviceId: 'device-1',
      embeddedId: 'climateControl',
      managementPointId: 'mp-1',
      characteristicName: 'onOffMode',
      data: { name: 'onOffMode', value: 'on' },
    }]);
    ws.disconnect();
  });

  it('ignores malformed messages', async () => {
    const { ws, errors } = makeSocket();
    const updates: unknown[] = [];
    ws.on('device_update', (u) => updates.push(u));
    ws.on('group_update', (u) => updates.push(u));
    await ws.connect();
    last().open();

    const malformed = [
      'not json',
      'null',
      '42',
      '[]',
      JSON.stringify({ message: 'Internal server error' }),
      JSON.stringify({ event: 'gateway:managementpoint:characteristic' }),
      JSON.stringify({ event: 'gateway:managementpoint:characteristic', gatewayDeviceId: 'd', embeddedId: 'e', data: null }),
      JSON.stringify({ event: 'gateway:managementpoint:characteristic', gatewayDeviceId: 'd', embeddedId: 'e', data: { value: 1 } }),
      JSON.stringify({ event: 'gateway:managementpoint:characteristic', embeddedId: 'e', data: { name: 'x', value: 1 } }),
      JSON.stringify({ event: 'group:characteristic', data: 'x' }),
    ];
    for (const message of malformed) {
      expect(() => last().emit('message', Buffer.from(message))).not.toThrow();
    }

    expect(updates).toEqual([]);
    expect(errors).toEqual([]);
    ws.disconnect();
  });

  it('can disconnect a socket that is still CONNECTING without an uncaught error', async () => {
    const { ws } = makeSocket();
    await ws.connect();
    const socket = last();
    expect(socket.readyState).toBe(FakeWebSocket.CONNECTING);

    ws.disconnect();
    expect(socket.terminate).toHaveBeenCalled();
    // The async 'error' from aborting the handshake must be absorbed
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.listenerCount('error')).toBe(1);
    expect(ws.getState()).toBe('disconnected');
  });

  it('does not reconnect after disconnect()', async () => {
    const { ws } = makeSocket();
    await ws.connect();
    last().open();
    ws.disconnect();
    await vi.advanceTimersByTimeAsync(600000);
    expect(sockets).toHaveLength(1);
  });

  it('requests a fresh access token for every (re)connect', async () => {
    const oauth = makeOAuth();
    oauth.getAccessToken.mockResolvedValueOnce('token-1').mockResolvedValueOnce('token-2');
    const { ws } = makeSocket(oauth);
    await ws.connect();
    last().drop();
    await timeUntilNextSocket();

    expect(oauth.getAccessToken).toHaveBeenCalledTimes(2);
    expect(sockets[0].options.headers.Authorization).toBe('Bearer token-1');
    expect(sockets[1].options.headers.Authorization).toBe('Bearer token-2');
    ws.disconnect();
  });

  it('schedules a reconnect when fetching the token fails', async () => {
    const oauth = makeOAuth();
    oauth.getAccessToken.mockRejectedValueOnce(new Error('refresh failed'));
    const { ws, errors } = makeSocket(oauth);
    await ws.connect();
    expect(sockets).toHaveLength(0);
    expect(errors.map(e => e.message)).toEqual(['refresh failed']);

    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(1);
    ws.disconnect();
  });
});
