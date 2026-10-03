import { vi, describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const childProcess = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => childProcess);

import {
  buildCurlConfig,
  configureHttpTransport,
  curlQuote,
  httpRequest,
} from '../../../src/api/http-transport';

type ExecCallback = (error: (Error & { code?: string | number }) | null, stdout: string, stderr: string) => void;

interface Captured {
  args: string[];
  config: string;
  configMode: number;
  bodyMode?: number;
  body?: string;
  tempDir: string;
}

const isPosix = process.platform !== 'win32';

/** Mock curl: capture the config file while it exists, then answer. */
function mockCurl(result: { stdout?: string; error?: Error & { code?: string | number }; stderr?: string }): Captured[] {
  const captured: Captured[] = [];
  childProcess.execFile.mockImplementation((_file: string, args: string[], _opts: unknown, cb: ExecCallback) => {
    const configFile = args[args.indexOf('--config') + 1];
    const config = fs.readFileSync(configFile, 'utf8');
    const entry: Captured = {
      args,
      config,
      configMode: fs.statSync(configFile).mode & 0o777,
      tempDir: path.dirname(configFile),
    };
    const bodyMatch = config.match(/^data-binary = "@(.+)"$/m);
    if (bodyMatch) {
      entry.body = fs.readFileSync(bodyMatch[1], 'utf8');
      entry.bodyMode = fs.statSync(bodyMatch[1]).mode & 0o777;
    }
    captured.push(entry);
    setImmediate(() => cb(result.error ?? null, result.stdout ?? '', result.stderr ?? ''));
  });
  return captured;
}

function exitError(code: number): Error & { code: number } {
  return Object.assign(new Error(`Command failed: curl (exit ${code})`), { code });
}

describe('curl transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureHttpTransport('curl');
  });

  afterAll(() => {
    configureHttpTransport('node');
  });

  it('invokes curl with -q first (ignore ~/.curlrc) and a private config file', async () => {
    const captured = mockCurl({ stdout: 'HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n{"ok":true}' });

    const res = await httpRequest('https://api.example.com/v1/x', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret-token' },
    }, 'a=1');

    expect(res).toMatchObject({ statusCode: 200, body: '{"ok":true}' });
    expect(childProcess.execFile).toHaveBeenCalledTimes(1);
    const [file, args] = childProcess.execFile.mock.calls[0];
    expect(file).toBe('curl');
    expect(args[0]).toBe('-q');
    expect(args).toEqual(['-q', '--config', expect.any(String)]);
    // Secrets stay off argv
    expect(args.join(' ')).not.toContain('secret-token');

    const { config, configMode, bodyMode, body, tempDir } = captured[0];
    expect(config).toContain('proto = "=https"');
    expect(config).toContain('url = "https://api.example.com/v1/x"');
    expect(config).toContain('header = "Authorization: Bearer secret-token"');
    expect(body).toBe('a=1');
    if (isPosix) {
      expect(configMode).toBe(0o600);
      expect(bodyMode).toBe(0o600);
    }
    // Temp dir (config + body) is removed afterwards
    expect(fs.existsSync(tempDir)).toBe(false);
  });

  it('deletes the temp dir when curl fails', async () => {
    const captured = mockCurl({ error: exitError(28), stderr: 'Operation timed out' });

    await expect(httpRequest('https://api.example.com/', { method: 'GET' })).rejects.toThrow();
    expect(fs.existsSync(captured[0].tempDir)).toBe(false);
  });

  it.each([
    [28, 'ETIMEDOUT'],
    [7, 'ECONNREFUSED'],
    [6, 'ENOTFOUND'],
    [35, 'ECONNRESET'],
    [99, 'ECURL'],
  ])('maps curl exit code %i to %s', async (exitCode, expected) => {
    mockCurl({ error: exitError(exitCode), stderr: 'curl: failure' });

    await expect(httpRequest('https://api.example.com/', { method: 'GET' }))
      .rejects.toMatchObject({ code: expected, message: expect.stringContaining(`exit ${exitCode}`) });
  });

  it('reports a missing curl binary', async () => {
    mockCurl({ error: Object.assign(new Error('spawn curl ENOENT'), { code: 'ENOENT' }) });

    await expect(httpRequest('https://api.example.com/', { method: 'GET' }))
      .rejects.toMatchObject({ code: 'ENOENT', message: expect.stringContaining('requires the curl binary') });
  });

  it.each([
    ['newline in a header', 'https://api.example.com/', { 'X-Test': 'a\nupload-file = "/etc/passwd"' }],
    ['carriage return in a header', 'https://api.example.com/', { 'X-Test': 'a\rb' }],
    ['newline in the url', 'https://api.example.com/x\noutput = "/tmp/pwned"', {}],
    ['NUL in the url', 'https://api.example.com/x\0y', {}],
  ])('refuses a %s and never runs curl', async (_name, url, headers) => {
    mockCurl({ stdout: 'HTTP/1.1 200 OK\r\n\r\n' });
    const curlDirs = () => fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('daikin-curl-'));
    const before = curlDirs();

    await expect(httpRequest(url, { method: 'GET', headers })).rejects.toThrow('CR, LF or NUL');
    expect(childProcess.execFile).not.toHaveBeenCalled();
    // No leaked daikin-curl-* temp dirs
    expect(curlDirs().filter((name) => !before.includes(name))).toEqual([]);
  });
});

describe('curl config building', () => {
  it('escapes quotes and backslashes', () => {
    expect(curlQuote('a"b\\c')).toBe('"a\\"b\\\\c"');
  });

  it('rejects CR, LF and NUL', () => {
    expect(() => curlQuote('a\nb')).toThrow();
    expect(() => curlQuote('a\rb')).toThrow();
    expect(() => curlQuote('a\0b')).toThrow();
  });

  it('starts with the https-only protocol restriction and omits Content-Length', () => {
    const config = buildCurlConfig('https://h/', {
      method: 'POST',
      headers: { 'Content-Length': '3' },
    }, '/tmp/body');
    expect(config.split('\n')[0]).toBe('proto = "=https"');
    expect(config).not.toMatch(/content-length/i);
    expect(config).toContain('data-binary = "@/tmp/body"');
  });
});
