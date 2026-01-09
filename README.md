# Homebridge Daikin Cloud

A [Homebridge](https://homebridge.io) plugin that integrates Daikin air conditioning units via the Daikin Cloud (Onecta) API, allowing you to control your devices through Apple HomeKit.

![HomeKit Controls](images/homekit-controls.jpeg) ![HomeKit Settings](images/homekit-settings.jpeg)

## Features

- **Temperature Control**: View current room temperature and set target temperature
- **Operation Modes**: Cooling, heating, and auto modes
- **Fan Control**: Adjust fan speed from the accessory settings
- **Swing Mode**: Enable/disable swing (if supported by your device)
- **Extra Features** (individually configurable):
  - Powerful mode (`showPowerfulMode`)
  - Econo mode (`showEconoMode`)
  - Streamer mode (`showStreamerMode`)
  - Outdoor silent mode (`showOutdoorSilentMode`)
  - Indoor quiet mode (`showIndoorSilentMode`)
  - Dry mode (`showDryMode`)
  - Fan only mode (`showFanOnlyMode`)

> **Note**: HomeKit doesn't natively support all Daikin operation modes. Extra features appear as switches in the Home app. Enable them individually in the plugin settings UI.

## Requirements

- Node.js >= 18.15.0
- Homebridge >= 1.5.0
- A Daikin account with devices registered in the Onecta app
- Daikin Developer Portal credentials (see [Setup](#setup))

## Installation

Install via the Homebridge UI or manually:

```bash
npm install -g @mp-consulting/homebridge-daikin-cloud
```

## Setup

### 1. Create a Daikin Developer App

1. Go to the [Daikin Developer Portal](https://developer.cloud.daikineurope.com/)
2. Sign in and navigate to **My Apps** (top-right menu)
3. Click **+ New App**
4. Fill in:
   - **Application name**: Any name (e.g., "Homebridge")
   - **Auth strategy**: Onecta OIDC
   - **Redirect URI**: `https://<your-homebridge-ip>:<callback-port>` (e.g., `https://192.168.1.100:8582`)
5. Save and note your **Client ID** and **Client Secret**

### 2. Configure the Plugin

Add the platform to your Homebridge `config.json`:

```json
{
  "platforms": [
    {
      "platform": "DaikinCloud",
      "clientId": "<your-client-id>",
      "clientSecret": "<your-client-secret>",
      "oidcCallbackServerBindAddr": "0.0.0.0",
      "callbackServerExternalAddress": "<your-homebridge-ip>",
      "callbackServerPort": 8582
    }
  ]
}
```

### 3. Authenticate

1. Restart Homebridge
2. Open the Homebridge UI and go to the plugin settings
3. Click **Authenticate** and follow the OAuth flow
4. After successful authentication, restart Homebridge

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `clientId` | string | *required* | Your Daikin Developer App Client ID |
| `clientSecret` | string | *required* | Your Daikin Developer App Client Secret |
| `callbackServerExternalAddress` | string | *required* | External IP/hostname for OAuth callback |
| `callbackServerPort` | number | `8582` | Port for OAuth callback server (1-65535) |
| `oidcCallbackServerBindAddr` | string | `0.0.0.0` | Address to bind callback server (valid IPv4) |
| `updateIntervalInMinutes` | number | `15` | Polling interval for device updates (1-60) |
| `forceUpdateDelay` | number | `60000` | Delay (ms) before refreshing after a change |
| `excludedDevicesByDeviceId` | string[] | `[]` | Device IDs to exclude from HomeKit |
| `showPowerfulMode` | boolean | `false` | Show Powerful mode switch |
| `showEconoMode` | boolean | `false` | Show Econo mode switch |
| `showStreamerMode` | boolean | `false` | Show Streamer mode switch |
| `showOutdoorSilentMode` | boolean | `false` | Show Outdoor Silent mode switch |
| `showIndoorSilentMode` | boolean | `false` | Show Indoor Silent mode switch |
| `showDryMode` | boolean | `false` | Show Dry mode switch |
| `showFanOnlyMode` | boolean | `false` | Show Fan Only mode switch |

## API Rate Limits

The Daikin API limits you to **200 requests per day**. The plugin manages this by:

- Polling at configurable intervals (default: 15 minutes)
- Triggering immediate updates after changes
- Blocking requests when the rate limit is reached

## Fan Speed

Fan speed in HomeKit uses percentages (0-100%). Map these to your device's fan levels:

| Daikin Levels | HomeKit % |
|---------------|-----------|
| 5 levels | 20%, 40%, 60%, 80%, 100% |
| 3 levels | 33%, 66%, 100% |

![Fan Speed](images/fan-speed.jpeg)

## Swing Mode

Toggle swing mode from the accessory settings. Both horizontal and vertical swing are activated together if supported.

![Swing Mode](images/swing-mode.png)

## Troubleshooting

### Token Expired or Invalid

Delete the token file and restart Homebridge:
```bash
rm ~/.homebridge/.daikin-controller-cloud-tokenset
# or in your custom storage path
```

### Authentication Flow Issues

- Ensure your redirect URI in the Daikin Developer Portal matches exactly: `https://<callbackServerExternalAddress>:<callbackServerPort>`
- Try setting `oidcCallbackServerBindAddr` to `0.0.0.0`
- Check firewall rules for the callback port

### Device Not Appearing

- Check the Homebridge logs for device discovery
- Verify the device is registered in the Daikin Onecta app
- Check if the device ID is in `excludedDevicesByDeviceId`

## Supported Devices

Any device compatible with the [Daikin Onecta app](https://www.daikin.eu/en_us/product-group/control-systems/onecta/connectable-units.html), including:

- BRP069C4x
- BRP069A8x
- BRP069A78 (Altherma heat pump)

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run with watch mode
npm run watch

# Run tests
npm test
```

## License

[Apache-2.0](LICENSE)
