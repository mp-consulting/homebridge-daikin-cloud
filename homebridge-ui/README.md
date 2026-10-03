# Homebridge UI

Custom UI for the Daikin Cloud plugin, providing an integrated authentication experience.

## Features

- **Setup Wizard** - Step-by-step guide for first-time setup
- **OAuth Integration** - Authenticate with Daikin Cloud directly from Homebridge UI
- **Status Panel** - View authentication status and token expiration
- **Connection Test** - Verify API connectivity
- **Revoke Access** - Remove authentication when needed

## Files

- `server.js` - Server-side handlers for OAuth flow and API communication
- `public/index.html` - Custom UI with authentication wizard
- `public/script.js` - Client-side logic for the custom UI

## How It Works

1. User enters credentials from Daikin Developer Portal
2. Plugin generates OAuth authorization URL
3. User opens URL in browser and logs in to Daikin
4. Authorization code is exchanged for access tokens
5. Tokens are stored locally for API access

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `/auth/status` | Get current authentication status |
| `/auth/start` | Start the OAuth authorization flow and the HTTPS callback server |
| `/auth/` | Complete the flow manually from a pasted callback URL (code and `state` required) |
| `/auth/poll` | Poll for the result captured by the callback server |
| `/auth/stop-server` | Cancel the flow and stop the callback server |
| `/auth/mobile-test` | Test and store Mobile App (Onecta) credentials |
| `/auth/revoke` | Revoke current authentication |
| `/auth/test` | Test API connection |
| `/config/validate` | Validate configuration |
| `/devices/list` | List devices (cached for 5 minutes per auth mode; pass `refresh: true` to bypass) |
| `/api/rate-limit` | Last rate limit status recorded by the running plugin (no API call) |
| `/server/info` | Host IP addresses, used to prefill the callback address |

## Security Notes

- The callback server binds to `oidcCallbackServerBindAddr` (an IPv4/IPv6 literal, default `0.0.0.0`).
  A loopback bind address is refused when the callback address is not loopback, because the
  browser redirect could never reach it.
- The callback server stops automatically when the 10-minute authorization window expires.
- Callback requests are only honoured when their `state` matches the pending authorization; the
  callback page is served with a restrictive Content-Security-Policy and escaped content.

## API Quota

The Daikin API has a daily quota (200 requests for the Developer Portal). The UI shares one
`/devices/list` request between the Devices and Settings tabs, the server caches that result for
5 minutes (cleared on any authentication change), and the rate limit check reads the status file
the plugin writes (`.daikin-rate-limit.json` in the Homebridge storage path) instead of calling the API.
