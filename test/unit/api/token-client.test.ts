import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  TokenClient,
  isTokenExpiring,
  parseJsonBody,
  parseTokenResponse,
  withExpiresAt,
} from '../../../src/api/token-client';
import type { TokenSet } from '../../../src/api/daikin-types';
import { TOKEN_EXPIRY_BUFFER_SECONDS } from '../../../src/constants';

const URL_ = 'https://idp.example.com/token';
const now = () => Math.floor(Date.now() / 1000);

class TestClient extends TokenClient {
  refreshImpl = vi.fn<(refreshToken: string) => Promise<TokenSet>>();

  constructor(
    tokenFilePath: string,
    onTokenUpdate?: (tokenSet: TokenSet) => void,
    onError?: (error: Error) => void,
  ) {
    super(tokenFilePath, onTokenUpdate, onError);
  }

  store(tokenSet: TokenSet): TokenSet {
    return this.setTokenSet(tokenSet);
  }

  protected requestTokenRefresh(refreshToken: string): Promise<TokenSet> {
    return this.refreshImpl(refreshToken);
  }
}

describe('token-client helpers', () => {
  it('withExpiresAt derives expires_at from expires_in without mutating', () => {
    const input: TokenSet = { access_token: 'a', token_type: 'Bearer', expires_in: 3600 };
    const out = withExpiresAt(input);
    expect(out.expires_at).toBeGreaterThanOrEqual(now() + 3599);
    expect(input.expires_at).toBeUndefined();
  });

  it('withExpiresAt keeps an existing expires_at', () => {
    const input: TokenSet = { access_token: 'a', token_type: 'Bearer', expires_in: 3600, expires_at: 42 };
    expect(withExpiresAt(input).expires_at).toBe(42);
  });

  it('isTokenExpiring honours TOKEN_EXPIRY_BUFFER_SECONDS', () => {
    const base = { access_token: 'a', token_type: 'Bearer' };
    expect(isTokenExpiring({ ...base, expires_at: now() + TOKEN_EXPIRY_BUFFER_SECONDS + 60 })).toBe(false);
    expect(isTokenExpiring({ ...base, expires_at: now() + TOKEN_EXPIRY_BUFFER_SECONDS - 1 })).toBe(true);
    expect(isTokenExpiring({ ...base, expires_at: now() - 1 })).toBe(true);
    expect(isTokenExpiring(base)).toBe(true);
  });

  it('parseJsonBody reports host and status for HTML bodies', () => {
    expect(() => parseJsonBody({ statusCode: 403, body: '<html>Forbidden</html>' }, URL_, 'Ctx'))
      .toThrow('Ctx: idp.example.com returned a non-JSON response (HTTP 403): <html>Forbidden</html>');
  });

  it('parseJsonBody reports empty bodies', () => {
    expect(() => parseJsonBody({ statusCode: 502, body: '' }, URL_, 'Ctx'))
      .toThrow('Ctx: idp.example.com returned a non-JSON response (HTTP 502) with an empty body');
  });

  it('parseTokenResponse returns a validated token set', () => {
    const body = JSON.stringify({ access_token: 'a', token_type: 'Bearer', expires_in: 60, id_token: 'x' });
    expect(parseTokenResponse({ statusCode: 200, body }, URL_, 'Ctx'))
      .toEqual({ access_token: 'a', token_type: 'Bearer', expires_in: 60 });
  });

  it('parseTokenResponse surfaces OAuth error bodies with the error code', () => {
    const body = JSON.stringify({ error: 'invalid_grant', error_description: 'Refresh token expired' });
    expect(() => parseTokenResponse({ statusCode: 400, body }, URL_, 'Token refresh failed'))
      .toThrow('Token refresh failed: invalid_grant - Refresh token expired (HTTP 400)');
  });

  it('parseTokenResponse rejects a non-2xx JSON body without an error field', () => {
    expect(() => parseTokenResponse({ statusCode: 500, body: '{"message":"boom"}' }, URL_, 'Ctx'))
      .toThrow('Ctx: idp.example.com returned HTTP 500');
  });

  it('parseTokenResponse rejects malformed token sets without echoing values', () => {
    const body = JSON.stringify({ access_token: 'secret-value', token_type: 7 });
    let message = '';
    try {
      parseTokenResponse({ statusCode: 200, body }, URL_, 'Ctx');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('invalid token response (missing or malformed: token_type)');
    expect(message).not.toContain('secret-value');
  });
});

describe('TokenClient', () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daikin-token-client-'));
    filePath = path.join(tempDir, 'tokenset');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads an existing token file on construction', () => {
    const tokenSet = { access_token: 'a', token_type: 'Bearer', expires_at: now() + 3600 };
    fs.writeFileSync(filePath, JSON.stringify(tokenSet));
    const client = new TestClient(filePath);
    expect(client.isAuthenticated()).toBe(true);
    expect(client.getTokenSet()).toEqual(tokenSet);
    expect(client.getTokenExpiration()?.getTime()).toBe(tokenSet.expires_at * 1000);
  });

  it('is not authenticated without a token file', () => {
    const client = new TestClient(filePath);
    expect(client.isAuthenticated()).toBe(false);
    expect(client.getTokenExpiration()).toBeNull();
  });

  it('persists stored tokens, fills expires_at and notifies', () => {
    const onTokenUpdate = vi.fn();
    const client = new TestClient(filePath, onTokenUpdate);
    const before = now();
    const stored = client.store({ access_token: 'a', token_type: 'Bearer', expires_in: 100 });
    expect(stored.expires_at).toBeGreaterThanOrEqual(before + 100);
    expect(stored.expires_at).toBeLessThanOrEqual(now() + 100);
    expect(onTokenUpdate).toHaveBeenCalledWith(stored);
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual(stored);
  });

  it('reports save failures through onError instead of throwing', () => {
    const onError = vi.fn();
    const client = new TestClient(path.join(tempDir, 'missing-dir', 'tokenset'), undefined, onError);
    client.store({ access_token: 'a', token_type: 'Bearer' });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Failed to save token file'),
    }));
    expect(client.isAuthenticated()).toBe(true);
  });

  it('clearTokens deletes the file and forgets the tokens', () => {
    const client = new TestClient(filePath);
    client.store({ access_token: 'a', token_type: 'Bearer' });
    client.clearTokens();
    expect(fs.existsSync(filePath)).toBe(false);
    expect(client.isAuthenticated()).toBe(false);
  });

  it('keeps the previous refresh token when the refresh response omits it', async () => {
    const client = new TestClient(filePath);
    client.store({ access_token: 'old', refresh_token: 'rt', token_type: 'Bearer', expires_at: now() - 1 });
    client.refreshImpl.mockResolvedValue({ access_token: 'new', token_type: 'Bearer', expires_in: 3600 });

    await expect(client.getAccessToken()).resolves.toBe('new');
    expect(client.refreshImpl).toHaveBeenCalledWith('rt');
    expect(client.getTokenSet()?.refresh_token).toBe('rt');
  });
});
