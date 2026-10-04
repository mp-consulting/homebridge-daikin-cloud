/**
 * Tests for the custom UI server (homebridge-ui/server.js).
 *
 * server.js is CommonJS and loads compiled code from dist/, so it is loaded with
 * createRequire. HomebridgePluginUiServer is replaced in the require cache (the
 * real one exits unless running as an IPC child), and the dist API classes are
 * spied on directly since server.js shares the same module instances.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const require = createRequire(import.meta.url);
const NodeModule = require('node:module');

const rootDir = path.resolve(__dirname, '..', '..', '..');
const serverPath = path.join(rootDir, 'homebridge-ui', 'server.js');
const distApi = path.join(rootDir, 'dist', 'src', 'api');

class FakePluginUiServer {
  handlers: Record<string, (payload: any) => any> = {};

  onRequest(route: string, handler: (payload: any) => any) {
    this.handlers[route] = handler;
  }

  ready() {
    // no-op
  }

  get homebridgeStoragePath() {
    return process.env.HOMEBRIDGE_STORAGE_PATH;
  }

  get homebridgeConfigPath() {
    return process.env.HOMEBRIDGE_CONFIG_PATH;
  }
}

function installFakeUiUtils() {
  const resolved = require.resolve('@homebridge/plugin-ui-utils', { paths: [path.dirname(serverPath)] });
  const fake = new NodeModule(resolved);
  fake.filename = resolved;
  fake.loaded = true;
  fake.exports = { HomebridgePluginUiServer: FakePluginUiServer };
  require.cache[resolved] = fake;
}

let ui: any;
let DaikinOAuth: any;
let DaikinApi: any;
let constants: any;

beforeAll(() => {
  installFakeUiUtils();
  ui = require(serverPath);
  DaikinOAuth = require(path.join(distApi, 'daikin-oauth')).DaikinOAuth;
  DaikinApi = require(path.join(distApi, 'daikin-api')).DaikinApi;
  constants = require(path.join(rootDir, 'dist', 'src', 'constants'));
});

let storageDir: string;

function writeConfig(platform: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(storageDir, 'config.json'),
    JSON.stringify({ platforms: [{ platform: 'DaikinCloud', ...platform }] }),
  );
}

function writeToken(file: string, accessToken = 'access-token') {
  fs.writeFileSync(
    path.join(storageDir, file),
    JSON.stringify({ access_token: accessToken, token_type: 'Bearer', refresh_token: 'refresh', expires_at: 4102444800 }),
  );
}

function createServer() {
  return new ui.DaikinCloudUiServer();
}

function createResponse() {
  return { writeHead: vi.fn(), end: vi.fn() };
}

function pendingAuth(overrides: Record<string, unknown> = {}) {
  return {
    state: 'good-state',
    clientId: 'id',
    clientSecret: 'secret',
    redirectUri: 'https://192.168.1.10:8582',
    port: 8582,
    createdAt: Date.now(),
    ...overrides,
  };
}

const sampleDevice = {
  id: 'device-1',
  managementPoints: [
    { embeddedId: 'climateControl', name: { value: 'Living room' }, onOffMode: { value: 'on' } },
  ],
};

beforeEach(() => {
  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daikin-ui-test-'));
  process.env.HOMEBRIDGE_STORAGE_PATH = storageDir;
  process.env.HOMEBRIDGE_CONFIG_PATH = path.join(storageDir, 'config.json');
  writeConfig({});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.HOMEBRIDGE_STORAGE_PATH;
  delete process.env.HOMEBRIDGE_CONFIG_PATH;
  fs.rmSync(storageDir, { recursive: true, force: true });
});

describe('module loading', () => {
  it('exports the server pieces without starting the UI server', () => {
    expect(typeof ui.DaikinCloudUiServer).toBe('function');
    expect(typeof ui.CallbackServer).toBe('function');
    expect(typeof ui.SSLUtils.validateHostname).toBe('function');
    expect(typeof ui.NetUtils.resolveBindAddress).toBe('function');
  });

  it('uses the shared token file names', () => {
    const server = createServer();
    expect(path.basename(server.getTokenFilePath())).toBe(constants.TOKEN_FILES.developer_portal);
    expect(path.basename(server.getMobileTokenFilePath())).toBe(constants.TOKEN_FILES.mobile_app);
  });
});

describe('HtmlTemplates.callbackResponse', () => {
  it('HTML-escapes the message', () => {
    const html = ui.HtmlTemplates.callbackResponse(false, '<script>alert("x")</script>&\'');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;');
  });
});

describe('handleHttpsCallback', () => {
  it('rejects an error with a wrong state with 400 and leaves authResult untouched', () => {
    const server = createServer();
    server.pendingAuth = pendingAuth();
    server.authResult = null;
    const res = createResponse();

    server.handleHttpsCallback({ url: '/?error=access_denied&error_description=%3Cimg%20src%3Dx%3E&state=bad', headers: {} }, res);

    expect(res.writeHead).toHaveBeenCalledWith(400, expect.objectContaining({
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'X-Content-Type-Options': 'nosniff',
    }));
    expect(server.authResult).toBeNull();
    expect(server.pendingAuth).not.toBeNull();
    expect(res.end.mock.calls[0][0]).not.toContain('<img');
  });

  it('rejects an error without state and without a pending auth', () => {
    const server = createServer();
    server.pendingAuth = pendingAuth();
    const res = createResponse();
    server.handleHttpsCallback({ url: '/?error=access_denied', headers: {} }, res);
    expect(res.writeHead.mock.calls[0][0]).toBe(400);
    expect(server.authResult).toBeNull();

    server.pendingAuth = null;
    const res2 = createResponse();
    server.handleHttpsCallback({ url: '/?error=access_denied&state=good-state', headers: {} }, res2);
    expect(res2.writeHead.mock.calls[0][0]).toBe(400);
    expect(server.authResult).toBeNull();
  });

  it('honours an error when the state matches, escaping it in the page', () => {
    const server = createServer();
    server.pendingAuth = pendingAuth();
    const res = createResponse();

    server.handleHttpsCallback({ url: '/?error=access_denied&error_description=%3Cb%3Edenied%3C%2Fb%3E&state=good-state', headers: {} }, res);

    expect(server.authResult).toEqual({ success: false, error: '<b>denied</b>' });
    expect(res.end.mock.calls[0][0]).toContain('&lt;b&gt;denied&lt;/b&gt;');
  });

  it('rejects an expired pending auth without exchanging the code', () => {
    const exchange = vi.spyOn(DaikinOAuth, 'exchangeCodeStatic').mockResolvedValue({});
    const server = createServer();
    vi.spyOn(server.callbackServer, 'stop').mockResolvedValue({ success: true });
    server.pendingAuth = pendingAuth({ createdAt: Date.now() - constants.PENDING_AUTH_TTL_MS - 1000 });
    const res = createResponse();

    server.handleHttpsCallback({ url: '/?code=abc&state=good-state', headers: {} }, res);

    expect(res.writeHead.mock.calls[0][0]).toBe(400);
    expect(exchange).not.toHaveBeenCalled();
    expect(server.pendingAuth).toBeNull();
    expect(server.authResult.success).toBe(false);
  });

  it('exchanges the code and saves the token when state matches', async () => {
    vi.spyOn(DaikinOAuth, 'exchangeCodeStatic').mockResolvedValue({ access_token: 'new', token_type: 'Bearer', expires_at: 4102444800 });
    const server = createServer();
    vi.spyOn(server.callbackServer, 'stop').mockResolvedValue({ success: true });
    server.pendingAuth = pendingAuth();
    const res = createResponse();

    await server.handleHttpsCallback({ url: '/?code=abc&state=good-state', headers: {} }, res);

    expect(server.authResult.success).toBe(true);
    expect(res.writeHead.mock.calls[0][0]).toBe(200);
    const saved = JSON.parse(fs.readFileSync(server.getTokenFilePath(), 'utf8'));
    expect(saved.access_token).toBe('new');
    expect(fs.statSync(server.getTokenFilePath()).mode & 0o777).toBe(0o600);
  });
});

describe('handleCallback (manual)', () => {
  it('rejects a callback without state', async () => {
    const exchange = vi.spyOn(DaikinOAuth, 'exchangeCodeStatic').mockResolvedValue({});
    const server = createServer();
    server.pendingAuth = pendingAuth();

    await expect(server.handleCallback({ code: 'abc' })).rejects.toThrow(/state/);
    await expect(server.handleCallback({ callbackUrl: 'https://192.168.1.10:8582/?code=abc' })).rejects.toThrow(/state/);
    expect(exchange).not.toHaveBeenCalled();
  });

  it('rejects a mismatched state', async () => {
    const server = createServer();
    server.pendingAuth = pendingAuth();
    await expect(server.handleCallback({ code: 'abc', state: 'other' })).rejects.toThrow(/state/);
  });

  it('rejects an expired pending auth', async () => {
    const server = createServer();
    server.pendingAuth = pendingAuth({ createdAt: Date.now() - constants.PENDING_AUTH_TTL_MS - 1 });
    await expect(server.handleCallback({ code: 'abc', state: 'good-state' })).rejects.toThrow(/expired/);
    expect(server.pendingAuth).toBeNull();
  });

  it('accepts a matching state', async () => {
    vi.spyOn(DaikinOAuth, 'exchangeCodeStatic').mockResolvedValue({ access_token: 'new', token_type: 'Bearer' });
    const server = createServer();
    vi.spyOn(server.callbackServer, 'stop').mockResolvedValue({ success: true });
    server.pendingAuth = pendingAuth();
    const result = await server.handleCallback({ callbackUrl: 'https://192.168.1.10:8582/?code=abc&state=good-state' });
    expect(result.success).toBe(true);
  });
});

describe('bind address', () => {
  it('accepts IPv4/IPv6 literals and falls back to the default otherwise', () => {
    const { resolveBindAddress } = ui.NetUtils;
    expect(resolveBindAddress('127.0.0.1')).toBe('127.0.0.1');
    expect(resolveBindAddress(' 192.168.1.5 ')).toBe('192.168.1.5');
    expect(resolveBindAddress('::1')).toBe('::1');
    expect(resolveBindAddress('::')).toBe('::');
    expect(resolveBindAddress('my-host')).toBe(constants.DEFAULT_CALLBACK_BIND_ADDR);
    expect(resolveBindAddress('1.2.3.4; rm -rf /')).toBe(constants.DEFAULT_CALLBACK_BIND_ADDR);
    expect(resolveBindAddress('999.1.1.1')).toBe(constants.DEFAULT_CALLBACK_BIND_ADDR);
    expect(resolveBindAddress(undefined)).toBe(constants.DEFAULT_CALLBACK_BIND_ADDR);
    expect(resolveBindAddress('')).toBe(constants.DEFAULT_CALLBACK_BIND_ADDR);
  });

  it('detects loopback hosts', () => {
    const { isLoopback } = ui.NetUtils;
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('127.1.2.3')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('localhost')).toBe(true);
    expect(isLoopback('0.0.0.0')).toBe(false);
    expect(isLoopback('192.168.1.10')).toBe(false);
    expect(isLoopback('home.example.com')).toBe(false);
  });

  it('reads the bind address from the platform config, payload taking precedence', () => {
    writeConfig({ oidcCallbackServerBindAddr: '192.168.1.10' });
    const server = createServer();
    expect(server.getCallbackBindAddress({})).toBe('192.168.1.10');
    expect(server.getCallbackBindAddress({ oidcCallbackServerBindAddr: '10.0.0.2' })).toBe('10.0.0.2');

    writeConfig({ oidcCallbackServerBindAddr: 'not-an-ip' });
    expect(server.getCallbackBindAddress({})).toBe('0.0.0.0');

    fs.rmSync(path.join(storageDir, 'config.json'));
    expect(server.getCallbackBindAddress({})).toBe('0.0.0.0');
  });

  it('passes the configured bind address to the callback server and logs no state', async () => {
    writeConfig({ oidcCallbackServerBindAddr: '192.168.1.10' });
    const server = createServer();
    const start = vi.spyOn(server.callbackServer, 'start').mockResolvedValue({ success: true });

    const result = await server.handleStartAuth({
      clientId: 'id',
      clientSecret: 'secret',
      callbackServerExternalAddress: '192.168.1.10',
    });

    expect(start).toHaveBeenCalledWith(expect.objectContaining({ bindAddr: '192.168.1.10', port: constants.DEFAULT_CALLBACK_PORT }));
    expect(result.callbackServerRunning).toBe(true);
    const logged = (console.log as any).mock.calls.flat().join(' ');
    expect(logged).not.toContain(result.state);
  });

  it('refuses a loopback bind address when the callback address is not loopback', async () => {
    writeConfig({ oidcCallbackServerBindAddr: '127.0.0.1' });
    const server = createServer();
    const start = vi.spyOn(server.callbackServer, 'start').mockResolvedValue({ success: true });

    await expect(server.handleStartAuth({
      clientId: 'id',
      clientSecret: 'secret',
      callbackServerExternalAddress: '192.168.1.10',
    })).rejects.toThrow(/0\.0\.0\.0/);
    expect(start).not.toHaveBeenCalled();
    expect(server.pendingAuth).toBeNull();
  });

  it('allows a loopback bind address with a loopback callback address', async () => {
    writeConfig({ oidcCallbackServerBindAddr: '127.0.0.1' });
    const server = createServer();
    const start = vi.spyOn(server.callbackServer, 'start').mockResolvedValue({ success: true });

    await server.handleStartAuth({ clientId: 'id', clientSecret: 'secret', callbackServerExternalAddress: 'localhost' });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ bindAddr: '127.0.0.1' }));
  });
});

describe('CallbackServer auto-stop', () => {
  it('stops itself when the TTL elapses and clears the timer on stop', async () => {
    vi.useFakeTimers();
    try {
      const callbackServer = new ui.CallbackServer();
      const close = vi.fn((cb: () => void) => cb());
      callbackServer.server = { close };
      callbackServer.scheduleAutoStop(1000);

      vi.advanceTimersByTime(999);
      expect(close).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(close).toHaveBeenCalledTimes(1);
      expect(callbackServer.server).toBeNull();

      callbackServer.server = { close };
      callbackServer.scheduleAutoStop(1000);
      await callbackServer.stop();
      expect(callbackServer.ttlTimer).toBeNull();
      vi.advanceTimersByTime(5000);
      expect(close).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('SSLUtils.validateHostname', () => {
  it.each([
    'host; rm -rf /',
    '$(id)',
    '`id`',
    'a b',
    'a|b',
    'a&b',
    'a"b',
    'a\'b',
    'a>b',
    'a\nb',
  ])('rejects %j', (hostname) => {
    expect(() => ui.SSLUtils.validateHostname(hostname)).toThrow(/disallowed/);
  });

  it('rejects empty and overly long hostnames', () => {
    expect(() => ui.SSLUtils.validateHostname('')).toThrow();
    expect(() => ui.SSLUtils.validateHostname('a'.repeat(254))).toThrow(/too long/);
  });

  it.each(['homebridge.local', '192.168.1.10', 'fe80::1', 'my_host-1'])('accepts %j', (hostname) => {
    expect(() => ui.SSLUtils.validateHostname(hostname)).not.toThrow();
  });
});

describe('/devices/list cache', () => {
  it('reuses the result per auth mode and honours refresh', async () => {
    writeToken(constants.TOKEN_FILES.mobile_app);
    const request = vi.spyOn(DaikinApi, 'requestStatic').mockResolvedValue({ data: [sampleDevice] });
    const server = createServer();

    const first = await server.handleListDevices({ mode: 'mobile_app' });
    const second = await server.handleListDevices({ mode: 'mobile_app' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.devices[0].name).toBe('Living room');

    await server.handleListDevices({ mode: 'mobile_app', refresh: true });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('expires after the TTL', async () => {
    writeToken(constants.TOKEN_FILES.mobile_app);
    const request = vi.spyOn(DaikinApi, 'requestStatic').mockResolvedValue({ data: [sampleDevice] });
    const server = createServer();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);

    await server.handleListDevices({ mode: 'mobile_app' });
    clock.mockReturnValue(now + ui.DEVICES_CACHE_TTL_MS + 1);
    await server.handleListDevices({ mode: 'mobile_app' });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures', async () => {
    writeToken(constants.TOKEN_FILES.mobile_app);
    const request = vi.spyOn(DaikinApi, 'requestStatic').mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ data: [] });
    const server = createServer();

    expect((await server.handleListDevices({ mode: 'mobile_app' })).success).toBe(false);
    expect((await server.handleListDevices({ mode: 'mobile_app' })).success).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('is invalidated by auth start, revoke and mobile test', async () => {
    writeToken(constants.TOKEN_FILES.developer_portal);
    const request = vi.spyOn(DaikinApi, 'requestStatic').mockResolvedValue({ data: [sampleDevice] });
    const server = createServer();
    vi.spyOn(server.callbackServer, 'start').mockResolvedValue({ success: true });

    await server.handleListDevices({ mode: 'developer_portal' });
    await server.handleStartAuth({ clientId: 'id', clientSecret: 'secret', callbackServerExternalAddress: '192.168.1.10' });
    await server.handleListDevices({ mode: 'developer_portal' });
    expect(request).toHaveBeenCalledTimes(2);

    vi.spyOn(DaikinOAuth, 'revokeTokenStatic').mockResolvedValue(undefined);
    await server.handleRevokeAuth({});
    writeToken(constants.TOKEN_FILES.developer_portal);
    await server.handleListDevices({ mode: 'developer_portal' });
    expect(request).toHaveBeenCalledTimes(3);

    const mobileOAuth = require(path.join(distApi, 'daikin-mobile-oauth')).DaikinMobileOAuth;
    vi.spyOn(mobileOAuth.prototype, 'authenticate').mockRejectedValue(new Error('bad credentials'));
    await server.handleMobileAuthTest({ email: 'a@b.c', password: 'x' });
    await server.handleListDevices({ mode: 'developer_portal' });
    expect(request).toHaveBeenCalledTimes(4);
  });
});

describe('/api/rate-limit', () => {
  it('reports that no data is available yet without calling the API', async () => {
    const request = vi.spyOn(DaikinApi, 'requestStatic');
    writeToken(constants.TOKEN_FILES.developer_portal);
    const server = createServer();

    const result = await server.handleGetRateLimit({ mode: 'developer_portal' });

    expect(result.success).toBe(false);
    expect(result.noData).toBe(true);
    expect(result.message).toMatch(/next API call/);
    expect(request).not.toHaveBeenCalled();
  });

  it('returns the status recorded by the plugin with its age', async () => {
    const request = vi.spyOn(DaikinApi, 'requestStatic');
    const updatedAt = new Date(Date.now() - 60_000).toISOString();
    fs.writeFileSync(path.join(storageDir, constants.RATE_LIMIT_STATUS_FILE), JSON.stringify({
      limitMinute: 20, remainingMinute: 19, limitDay: 200, remainingDay: 150, mode: 'developer_portal', updatedAt,
    }));
    const server = createServer();

    const result = await server.handleGetRateLimit({ mode: 'developer_portal' });

    expect(result.success).toBe(true);
    expect(result.rateLimit).toEqual({ limitMinute: 20, remainingMinute: 19, limitDay: 200, remainingDay: 150 });
    expect(result.mode).toBe('developer_portal');
    expect(result.updatedAt).toBe(updatedAt);
    expect(result.ageMs).toBeGreaterThanOrEqual(60_000);
    expect(result.ageMs).toBeLessThan(120_000);
    expect(request).not.toHaveBeenCalled();
  });

  it('handles a corrupt status file', async () => {
    fs.writeFileSync(path.join(storageDir, constants.RATE_LIMIT_STATUS_FILE), '{not json');
    const server = createServer();
    const result = await server.handleGetRateLimit({});
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Could not read/);
  });
});

describe('/config/validate', () => {
  const valid = {
    clientId: 'id',
    clientSecret: 'secret',
    callbackServerExternalAddress: '192.168.1.10',
    callbackServerPort: '8582',
  };

  it('accepts a complete Developer Portal config', async () => {
    const result = await createServer().handleValidateConfig(valid);
    expect(result).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('reports missing credentials and address', async () => {
    const result = await createServer().handleValidateConfig({ callbackServerPort: '8582' });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(3);
    expect(result.warnings).toEqual([]);
  });

  it('rejects localhost as the callback address', async () => {
    for (const address of ['localhost', '127.0.0.1']) {
      const result = await createServer().handleValidateConfig({ ...valid, callbackServerExternalAddress: address });
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(['Callback address cannot be localhost. Use your external IP or domain.']);
    }
  });

  it('rejects an invalid port and warns about a privileged one', async () => {
    const invalid = await createServer().handleValidateConfig({ ...valid, callbackServerPort: '70000' });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors[0]).toMatch(/Invalid port number/);

    const privileged = await createServer().handleValidateConfig({ ...valid, callbackServerPort: '443' });
    expect(privileged.valid).toBe(true);
    expect(privileged.warnings[0]).toMatch(/privileged/);
  });

  it('treats an empty port as the default', async () => {
    const result = await createServer().handleValidateConfig({ ...valid, callbackServerPort: '' });
    expect(result.valid).toBe(true);
  });
});

describe('Assistant routes', () => {
  it('registers the /ai routes and reports ready once they are in place', async () => {
    const ready = vi.spyOn(FakePluginUiServer.prototype, 'ready');
    const server = createServer();
    // Servers built by earlier tests may still be finishing their own import(), so only
    // count calls made on this instance.
    const readyCalls = () => ready.mock.contexts.filter((context) => context === server).length;
    expect(readyCalls()).toBe(0);

    await server.assistantReady;

    expect(readyCalls()).toBe(1);
    expect(Object.keys(server.handlers)).toEqual(expect.arrayContaining(['/ai/status', '/ai/explain', '/ai/ask', '/ai/config']));
  });
});
