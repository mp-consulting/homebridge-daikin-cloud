import { describe, it, expect } from 'vitest';
import { withHttpDefaults, DAIKIN_USER_AGENT, DAIKIN_TLS_CIPHERS } from '../../../src/api/http-defaults';

describe('withHttpDefaults', () => {
  it('applies the shared User-Agent, cipher list and Happy Eyeballs', () => {
    const options = withHttpDefaults({ hostname: 'example.com', method: 'GET' });

    expect(options.headers?.['User-Agent']).toBe(DAIKIN_USER_AGENT);
    expect(options.ciphers).toBe(DAIKIN_TLS_CIPHERS);
    expect(options.autoSelectFamily).toBe(true);
    expect(options.hostname).toBe('example.com');
    expect(options.method).toBe('GET');
  });

  it('keeps caller-provided headers and lets them win over defaults', () => {
    const options = withHttpDefaults({
      headers: { 'Authorization': 'Bearer token', 'User-Agent': 'custom/1.0' },
    });

    expect(options.headers?.Authorization).toBe('Bearer token');
    expect(options.headers?.['User-Agent']).toBe('custom/1.0');
  });

  it('does not identify as a browser (WAF impersonation-mismatch rule, issue #6)', () => {
    expect(DAIKIN_USER_AGENT).not.toMatch(/Mozilla|Chrome|Safari|Firefox/);
  });
});
