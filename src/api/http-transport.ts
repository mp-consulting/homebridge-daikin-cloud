/**
 * HTTP transport layer for all Daikin cloud requests.
 *
 * Two interchangeable transports produce the same response shape:
 *
 * - 'node' (default): Node's https module with the shared TLS/UA defaults.
 * - 'curl': shells out to the system curl binary. Opt-in escape hatch for
 *   networks where the WAF in front of the Daikin endpoints drops Node's TLS
 *   ClientHello fingerprint outright — parts of the fingerprint (extension
 *   order, ALPN set) are not reachable from Node's public TLS options, while
 *   curl's fingerprint passes (see GitHub issue #6).
 *
 * The curl transport keeps secrets off the command line: URL, headers and
 * body travel via a 0600 config file in a private temp dir (argv is visible
 * to every process on the host via ps). curl exit codes are mapped onto
 * Node-style error codes so the callers' retry logic works unchanged.
 */

import * as https from 'node:https';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { withHttpDefaults } from './http-defaults';
import { HTTP_REQUEST_TIMEOUT_MS } from '../constants';

export type HttpTransportMode = 'node' | 'curl';

export interface TransportOptions {
    method: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
}

export interface TransportResponse {
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
}

// The env var wins over config so a transport can be forced without editing
// config.json (useful on HOOBS where the child bridge env is easy to set).
const ENV_MODE = process.env.DAIKIN_HTTP_TRANSPORT as HttpTransportMode | undefined;
let configuredMode: HttpTransportMode = ENV_MODE === 'curl' ? 'curl' : 'node';

export function configureHttpTransport(mode: HttpTransportMode | undefined): void {
  if (ENV_MODE === 'curl' || ENV_MODE === 'node') {
    configuredMode = ENV_MODE;
    return;
  }
  configuredMode = mode === 'curl' ? 'curl' : 'node';
}

export function getHttpTransportMode(): HttpTransportMode {
  return configuredMode;
}

/**
 * Perform an HTTPS request through the configured transport.
 */
export function httpRequest(
  url: string,
  options: TransportOptions,
  postData?: string,
): Promise<TransportResponse> {
  if (configuredMode === 'curl') {
    return curlRequest(url, options, postData);
  }
  return nodeRequest(url, options, postData);
}

// ---------------------------------------------------------------------------
// Node transport
// ---------------------------------------------------------------------------

function nodeRequest(
  url: string,
  options: TransportOptions,
  postData?: string,
): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const timeoutMs = options.timeoutMs ?? HTTP_REQUEST_TIMEOUT_MS;
    const reqOptions = withHttpDefaults({
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: options.method,
      headers: {
        ...options.headers,
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData).toString() } : {}),
      },
    });

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({
        statusCode: res.statusCode || 0,
        headers: res.headers,
        body: data,
      }));
    });

    req.setTimeout(timeoutMs, () => {
      const timeoutError: NodeJS.ErrnoException = new Error(`no response after ${timeoutMs}ms`);
      timeoutError.code = 'ETIMEDOUT';
      req.destroy(timeoutError);
    });

    req.on('error', reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// curl transport
// ---------------------------------------------------------------------------

/** curl exit code → Node error code, so retry classification works unchanged. */
const CURL_EXIT_CODES: Record<number, string> = {
  6: 'ENOTFOUND',    // could not resolve host
  7: 'ECONNREFUSED', // failed to connect
  28: 'ETIMEDOUT',   // operation timed out
  35: 'ECONNRESET',  // TLS connect error
  52: 'ECONNRESET',  // empty reply from server
  55: 'EPIPE',       // send failure
  56: 'ECONNRESET',  // receive failure
};

/** Escape a value for a double-quoted curl config entry. */
function curlQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function buildCurlConfig(
  url: string,
  options: TransportOptions,
  bodyFile: string | undefined,
): string {
  const timeoutSecs = Math.ceil((options.timeoutMs ?? HTTP_REQUEST_TIMEOUT_MS) / 1000);
  const lines = [
    `url = ${curlQuote(url)}`,
    `request = ${curlQuote(options.method)}`,
    `max-time = ${timeoutSecs}`,
    'silent',
    'show-error',
    'include',
  ];
  for (const [key, value] of Object.entries(withHttpDefaults({ headers: options.headers }).headers ?? {})) {
    // curl computes Content-Length itself from the body; a duplicate is invalid
    if (key.toLowerCase() !== 'content-length' && value !== undefined) {
      lines.push(`header = ${curlQuote(`${key}: ${value}`)}`);
    }
  }
  if (bodyFile) {
    lines.push(`data-binary = ${curlQuote(`@${bodyFile}`)}`);
  }
  return lines.join('\n') + '\n';
}

function curlRequest(
  url: string,
  options: TransportOptions,
  postData?: string,
): Promise<TransportResponse> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daikin-curl-') );
  const configFile = path.join(tempDir, 'request.conf');
  let bodyFile: string | undefined;
  if (postData !== undefined) {
    bodyFile = path.join(tempDir, 'body');
    fs.writeFileSync(bodyFile, postData, { mode: 0o600 });
  }
  fs.writeFileSync(configFile, buildCurlConfig(url, options, bodyFile), { mode: 0o600 });

  const timeoutMs = (options.timeoutMs ?? HTTP_REQUEST_TIMEOUT_MS) + 5000;
  return new Promise<TransportResponse>((resolve, reject) => {
    execFile('curl', ['--config', configFile], { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(describeCurlError(error as NodeJS.ErrnoException & { code?: string | number }, stderr));
          return;
        }
        try {
          resolve(parseCurlResponse(stdout));
        } catch (parseError) {
          reject(parseError);
        }
      });
  }).finally(() => fs.rmSync(tempDir, { recursive: true, force: true }));
}

function describeCurlError(
  error: NodeJS.ErrnoException & { code?: string | number },
  stderr: string,
): NodeJS.ErrnoException {
  if (error.code === 'ENOENT') {
    return Object.assign(
      new Error('httpTransport "curl" requires the curl binary, but none was found on this system'),
      { code: 'ENOENT' },
    );
  }
  const exitCode = typeof error.code === 'number' ? error.code : undefined;
  const mapped = exitCode !== undefined ? CURL_EXIT_CODES[exitCode] : undefined;
  const err: NodeJS.ErrnoException = new Error(
    `curl failed${exitCode !== undefined ? ` (exit ${exitCode})` : ''}: ${stderr.trim() || error.message}`,
  );
  err.code = mapped ?? 'ECURL';
  return err;
}

/**
 * Parse `curl --include` output: one or more header blocks (interim 1xx or
 * proxy CONNECT responses precede the final one) followed by the body.
 * Repeated headers (set-cookie) collect into arrays, matching Node's parser.
 */
export function parseCurlResponse(raw: string): TransportResponse {
  let rest = raw;
  for (;;) {
    const match = rest.match(/^HTTP\/[\d.]+\s+(\d{3})[^\r\n]*\r?\n/);
    if (!match) {
      throw new Error('Could not parse curl response (no HTTP status line)');
    }
    const statusCode = parseInt(match[1], 10);
    const headerEnd = rest.search(/\r?\n\r?\n/);
    const headerBlock = rest.slice(match[0].length, headerEnd === -1 ? rest.length : headerEnd);
    rest = headerEnd === -1 ? '' : rest.slice(headerEnd).replace(/^\r?\n\r?\n/, '');
    if (statusCode >= 100 && statusCode < 200 || rest.match(/^HTTP\/[\d.]+\s+\d{3}/)) {
      continue; // interim response or another header block follows
    }
    return { statusCode, headers: parseHeaderBlock(headerBlock), body: rest };
  }
}

function parseHeaderBlock(block: string): Record<string, string | string[] | undefined> {
  const headers: Record<string, string | string[] | undefined> = {};
  for (const line of block.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) {
      continue;
    }
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    const existing = headers[key];
    if (existing === undefined) {
      headers[key] = key === 'set-cookie' ? [value] : value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      headers[key] = [existing, value];
    }
  }
  return headers;
}
