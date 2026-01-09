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
| `/auth/start` | Start OAuth authorization flow |
| `/auth/callback` | Handle OAuth callback with auth code |
| `/auth/revoke` | Revoke current authentication |
| `/auth/test` | Test API connection |
| `/config/validate` | Validate configuration |
