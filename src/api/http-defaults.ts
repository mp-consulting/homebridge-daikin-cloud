/**
 * Shared HTTP/TLS defaults for every request to the Daikin cloud.
 *
 * The Daikin endpoints sit behind AWS CloudFront with a WAF that classifies
 * clients by TLS ClientHello fingerprint (JA3) and silently drops traffic it
 * categorises as bot-like: the TLS handshake completes, then no HTTP response
 * ever arrives (see GitHub issue #6). Two rules matter here:
 *
 * - Node's hand-picked default cipher list produces the canonical "Node.js"
 *   fingerprint, which such WAFs single out. OpenSSL's DEFAULT list instead
 *   yields the generic OpenSSL fingerprint shared by curl and countless other
 *   clients, which passes.
 * - A browser User-Agent combined with a non-browser TLS fingerprint is
 *   flagged as an impersonation mismatch, so never claim to be Chrome. The
 *   plugin identifies as OkHttp, matching the official Onecta app whose
 *   OAuth client the mobile flow already emulates.
 */
import type { OutgoingHttpHeaders } from 'http';

// Both are overridable via environment for diagnostics without a rebuild.
export const DAIKIN_USER_AGENT = process.env.DAIKIN_USER_AGENT || 'okhttp/4.12.0';
export const DAIKIN_TLS_CIPHERS = process.env.DAIKIN_TLS_CIPHERS || 'DEFAULT';

/**
 * Apply the shared User-Agent and TLS fingerprint defaults to the options of
 * an https.request (or ws) call. Explicit options and headers win.
 */
export function withHttpDefaults<T extends { headers?: OutgoingHttpHeaders }>(
  options: T,
): T & { autoSelectFamily: boolean; ciphers: string } {
  return {
    // Happy Eyeballs: fall back to IPv4 when advertised IPv6 is broken
    // instead of hanging on connect until the request timeout.
    autoSelectFamily: true,
    ciphers: DAIKIN_TLS_CIPHERS,
    ...options,
    headers: {
      'User-Agent': DAIKIN_USER_AGENT,
      ...options.headers,
    },
  };
}
