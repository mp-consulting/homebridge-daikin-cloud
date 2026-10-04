/**
 * Assistant routes for the custom settings UI (/ai/status, /ai/explain, /ai/ask,
 * /ai/config), from @mp-consulting/homebridge-ai-core/plugin. The provider is set up
 * once in the shared `HomebridgeAiKit` block of config.json; its key never reaches
 * the browser.
 *
 * ai-core is ESM-only and this UI server is CommonJS, so it is loaded lazily with
 * import(). When it cannot be loaded the routes are simply missing: the UI calls
 * /ai/status, gets an error and hides everything Assistant-related.
 */

const ASSISTANT_PLUGIN_NAME = '@mp-consulting/homebridge-daikin-cloud';

/**
 * Daikin background the Assistant gets with every request from this plugin's
 * settings UI. Keep it short: it is sent with each prompt.
 */
const DAIKIN_AI_CONTEXT = [
  'The plugin bridges Daikin air conditioners and Altherma heat pumps (climateControl and domesticHotWaterTank',
  'management points) from the Daikin Onecta cloud to HomeKit; it never talks to the units on the LAN.',
  'Authentication methods ("authMode"): "developer_portal" uses OAuth 2.0 with a Client ID and Client Secret from',
  'the Daikin Developer Portal and allows 200 API calls per day; "mobile_app" logs in with the Onecta app email and',
  'password (Gigya login at id.daikin.eu), allows 3000 calls per day and adds real-time WebSocket updates',
  '("enableWebSocket"). Developer Portal login needs a temporary HTTPS callback server with a self-signed certificate',
  '(the browser warns about it): the redirect URI registered in the portal must be exactly',
  'https://<callbackServerExternalAddress>:<callbackServerPort> (default port 8582), the port must be reachable from',
  'the browser, the bind address ("oidcCallbackServerBindAddr", default 0.0.0.0) may only be loopback when the browser',
  'runs on the Homebridge host, and the callback server stops after 10 minutes. Tokens are stored in',
  '.daikin-controller-cloud-tokenset (Developer Portal) or .daikin-mobile-tokenset (Mobile App) in the Homebridge',
  'storage path. Common errors: "Unauthorized (401): Token refresh failed. Please re-authenticate." or "invalid_grant"',
  'means the refresh token expired or was revoked, so authenticate again; "Rate limited. Retry after N seconds." (HTTP',
  '429) means the daily or per-minute quota is used up, so raise "updateIntervalInMinutes" (15+ for Developer Portal)',
  'or switch to Mobile App; "Bad Gateway (502)", "Service Unavailable (503)" or "Gateway Timeout (504)" with "The',
  'Daikin API is temporarily unavailable" is a Daikin-side outage (polls back off on their own); "Device <id> is',
  'offline (cloud connection down)" or a device shown Offline means its Wi-Fi adapter lost the Onecta cloud',
  'connection (check power, Wi-Fi and the Onecta app); "Request to <host> failed after N attempts" (ETIMEDOUT,',
  'ECONNRESET, ECONNREFUSED) points at the Homebridge host network: DNS, firewall, broken IPv6 or a low MTU; "returned',
  'a non-JSON response" usually means a proxy or WAF answered instead of Daikin, and some WAFs drop Node\'s TLS',
  'fingerprint, which "httpTransport": "curl" works around. Mobile App login errors carry the Gigya error code in',
  'parentheses. Hidden devices are listed in "excludedDevicesByDeviceId". Never ask the user for their password,',
  'Client Secret, tokens or API keys.',
].join(' ');

/**
 * Adds the Assistant routes to the plugin UI server. Resolves once they are
 * registered (or immediately when ai-core cannot be loaded).
 *
 * `options` is passed through to `registerAiRoutes` (tests inject a provider).
 */
function registerAssistant(server, options = {}) {
  return import('@mp-consulting/homebridge-ai-core/plugin')
    .then(({ registerAiRoutes }) => registerAiRoutes(server, {
      pluginName: ASSISTANT_PLUGIN_NAME,
      systemContext: DAIKIN_AI_CONTEXT,
      ...options,
    }))
    .catch((error) => {
      console.warn('[DaikinCloud] Assistant unavailable:', error.message);
    });
}

module.exports = { ASSISTANT_PLUGIN_NAME, DAIKIN_AI_CONTEXT, registerAssistant };
