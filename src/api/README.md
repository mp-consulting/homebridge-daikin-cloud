# API

Daikin Cloud API integration layer with support for both Developer Portal and Mobile App authentication.

## Files

- `daikin-controller.ts` - Main controller orchestrating OAuth, API, and WebSocket
- `daikin-oauth.ts` - Developer Portal OAuth 2.0 authentication
- `daikin-mobile-oauth.ts` - Mobile App OAuth with Gigya/PKCE authentication
- `daikin-api.ts` - REST API client: rate-limit tracking, retries/backoff, per-device write queue with coalescing
- `token-client.ts` - Shared token endpoint client used by both OAuth providers
- `token-storage.ts` - Token persistence (atomic writes, 0600 permissions)
- `http-transport.ts` / `http-defaults.ts` - Shared HTTP transport (`node` or `curl`) and TLS/User-Agent defaults
- `daikin-schemas.ts` - Zod schemas for API payloads and config
- `daikin-websocket.ts` - WebSocket client for real-time device updates
- `daikin-device.ts` - Device data model with get/set operations
- `daikin-types.ts` - TypeScript interfaces and constants
- `daikin-cloud.repository.ts` - Utility functions for sensitive data masking

## Authentication Modes

### Developer Portal (200 API calls/day)
Uses OAuth 2.0 with client credentials from the Daikin Developer Portal.
Requires manual OAuth flow through Homebridge UI.

### Mobile App (3000 API calls/day)
Uses the mobile app's Gigya authentication with PKCE.
Provides automatic authentication and WebSocket access for real-time updates.

## Architecture

```
DaikinCloudController
├── DaikinOAuth / DaikinMobileOAuth (OAuthProvider interface)
├── DaikinApi (REST client)
├── DaikinWebSocket (real-time updates)
└── DaikinCloudDevice[] (device instances)
```

## Events

The controller emits the following events:
- `token_update` - When tokens are refreshed
- `rate_limit_status` - After each API call with rate limit info
- `websocket_connected` - WebSocket connection established
- `websocket_disconnected` - WebSocket disconnected
- `websocket_device_update` - Real-time device state change (informational only; the platform just logs it at debug level)
- `error` - On errors

Device state updates do not flow through `websocket_device_update`. The WebSocket
handler applies each change to the in-memory `DaikinCloudDevice`, which emits
`'updated'`; accessories listen for that and call `refreshValues()` on their services.
