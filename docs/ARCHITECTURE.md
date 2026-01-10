# Architecture Documentation

## Overview

This Homebridge plugin integrates Daikin air conditioning units via the Daikin Cloud (Onecta) API with Apple HomeKit. The architecture supports dual authentication modes, real-time WebSocket updates, and extensible feature management.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Apple HomeKit                            │
│                  (iOS Home App / Siri)                       │
└───────────────────────────┬─────────────────────────────────┘
                            │ HAP Protocol
┌───────────────────────────┴─────────────────────────────────┐
│                      Homebridge                              │
│                   (HAP-nodejs)                               │
└───────────────────────────┬─────────────────────────────────┘
                            │ Plugin API
┌───────────────────────────┴─────────────────────────────────┐
│            Daikin Cloud Platform Plugin                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              DaikinCloudPlatform                      │   │
│  │  - Manages accessories lifecycle                     │   │
│  │  - Coordinates controllers & services                │   │
│  │  - Handles WebSocket events                          │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Accessories │  │   Services   │  │    Features      │  │
│  │  - AC Unit  │  │  - Climate   │  │  - Powerful Mode │  │
│  │  - Altherma │  │  - Hot Water │  │  - Econo Mode    │  │
│  └─────────────┘  └──────────────┘  └──────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           DaikinCloudController                       │   │
│  │  - OAuth management                                   │   │
│  │  - API rate limiting                                  │   │
│  │  - Device data management                             │   │
│  └──────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                  ┌─────────┴─────────┐
                  │                   │
       ┌──────────┴─────────┐   ┌────┴────────────┐
       │ OAuth Provider     │   │  WebSocket      │
       │ - Developer Portal │   │  - Real-time    │
       │ - Mobile App       │   │  - Device Events│
       └──────────┬─────────┘   └────┬────────────┘
                  │                   │
       ┌──────────┴───────────────────┴────────────┐
       │       Daikin Cloud API (Onecta)            │
       │    https://api.onecta.daikineurope.com     │
       └────────────────────────────────────────────┘
```

## Core Components

### 1. Platform Layer

#### DaikinCloudPlatform ([platform.ts](src/platform.ts))

The main entry point implementing Homebridge's `DynamicPlatformPlugin` interface.

**Responsibilities:**
- Initialize and configure the plugin
- Discover and register HAP accessories
- Manage device polling and WebSocket connections
- Handle configuration validation
- Coordinate between controllers, services, and accessories

**Key Methods:**
- `discoverDevices()`: Fetches devices from API and creates/updates accessories
- `configureAccessory()`: Restores cached accessories on Homebridge restart
- `updateDevices()`: Periodic polling for device state changes
- `handleWebSocketDeviceUpdate()`: Processes real-time WebSocket updates

**Lifecycle:**
1. Constructor: Initialize services, validate config
2. `didFinishLaunching()`: Start authentication and device discovery
3. Periodic updates or WebSocket events
4. Cleanup on shutdown

### 2. Authentication Layer

#### DaikinCloudController ([api/daikin-controller.ts](src/api/daikin-controller.ts))

Unified controller managing both authentication modes.

**Dual Authentication Support:**

##### Developer Portal Mode
- Uses OAuth 2.0 Authorization Code flow
- Requires Client ID/Secret from Daikin Developer Portal
- 200 API calls/day limit
- No WebSocket support
- **Flow:**
  1. Generate authorization URL
  2. User authenticates via browser
  3. Exchange code for access/refresh tokens
  4. Store tokens securely (mode 0o600)

##### Mobile App Mode
- Uses Gigya authentication + PKCE
- Requires email/password (same as Onecta app)
- 5000 API calls/day limit
- WebSocket support for real-time updates
- **Flow:**
  1. Login via Gigya API
  2. Exchange Gigya token for Daikin OIDC token
  3. Use access token for API calls
  4. Establish WebSocket connection

#### OAuth Providers

- [daikin-oauth.ts](src/api/daikin-oauth.ts): Developer Portal OAuth implementation
- [daikin-mobile-oauth.ts](src/api/daikin-mobile-oauth.ts): Mobile App Gigya authentication

**Token Management:**
- Automatic token refresh before expiration
- Exponential backoff for failed refreshes
- Secure file storage with restricted permissions
- Event-driven token updates

### 3. API Integration Layer

#### DaikinApi ([api/daikin-api.ts](src/api/daikin-api.ts))

HTTP client for Daikin Cloud API with built-in resilience.

**Features:**
- Rate limit tracking (per-minute and per-day)
- Automatic retry with exponential backoff
- Gateway timeout handling (502, 503, 504)
- Request/response logging
- Error categorization

**Rate Limiting:**
```typescript
Headers:
- x-ratelimit-limit-minute: 10
- x-ratelimit-remaining-minute: 9
- x-ratelimit-limit-day: 200 (Developer) / 5000 (Mobile)
- x-ratelimit-remaining-day: 195
```

**Retry Strategy:**
- Initial delay: 1s
- Max delay: 60s
- Exponential backoff with jitter
- Max retries: 3

#### WebSocket Integration ([api/daikin-websocket.ts](src/api/daikin-websocket.ts))

Real-time device state updates (Mobile App mode only).

**Connection Management:**
- Automatic reconnection on disconnect
- Exponential backoff (1s → 5min)
- Heartbeat/ping-pong for connection health
- Event-driven architecture

**Message Flow:**
```
Device State Change
     ↓
Daikin Cloud
     ↓ (WebSocket)
Plugin WebSocket Client
     ↓ (Event)
Platform.handleWebSocketDeviceUpdate()
     ↓
UpdateMapper.applyUpdate()
     ↓
HAP Service.updateCharacteristic()
     ↓
HomeKit
```

### 4. Device Management Layer

#### DaikinCloudDevice ([api/daikin-device.ts](src/api/daikin-device.ts))

Represents a single Daikin device with management points (embedded units).

**Structure:**
```
Gateway Device
  └─ Management Point 1 (e.g., Indoor Unit #1)
      ├─ onOffMode
      ├─ operationMode
      ├─ temperatureControl
      ├─ sensoryData
      └─ fanControl
  └─ Management Point 2 (e.g., Hot Water Tank)
      ├─ onOffMode
      ├─ tankTemperature
      └─ targetTemperature
```

**Key Methods:**
- `getData(embeddedId, characteristicName)`: Retrieve device data
- `updateData(updates)`: Apply API response updates
- `getEmbeddedIds()`: List all management points

#### Capability Detection ([device/capability-detector.ts](src/device/capability-detector.ts))

Analyzes device capabilities to determine supported features.

**Detection Logic:**
```typescript
detectCapabilities(device: GatewayDevice) {
  // Check device type
  if (device.type === 'climateControl') {
    // Detect operation modes (cooling, heating, auto)
    // Detect fan control
    // Detect swing mode
  } else if (device.type === 'domesticHotWaterTank') {
    // Detect tank temperature
    // Detect target temperature range
  }
}
```

### 5. Accessory Layer

#### Base Accessory ([accessories/base-accessory.ts](src/accessories/base-accessory.ts))

Abstract base class for all accessories providing common functionality.

**Responsibilities:**
- Service lifecycle management
- Characteristic binding
- Error handling
- Feature integration

#### Air Conditioning Accessory ([accessories/air-conditioning-accessory.ts](src/accessories/air-conditioning-accessory.ts))

Maps Daikin AC unit to HAP HeaterCooler or Thermostat service.

**Service Selection:**
- Default: HeaterCooler (iOS 11+)
- Fallback: Thermostat (older compatibility)

**Characteristic Mapping:**

| Daikin | HomeKit (HeaterCooler) | HomeKit (Thermostat) |
|--------|----------------------|---------------------|
| onOffMode | Active | CurrentHeatingCoolingState |
| operationMode (cooling) | TargetHeaterCoolerState.COOL | TargetHeatingCoolingState.COOL |
| operationMode (heating) | TargetHeaterCoolerState.HEAT | TargetHeatingCoolingState.HEAT |
| operationMode (auto) | TargetHeaterCoolerState.AUTO | TargetHeatingCoolingState.AUTO |
| temperatureControl | CoolingThresholdTemperature<br>HeatingThresholdTemperature | TargetTemperature |
| sensoryData.roomTemperature | CurrentTemperature | CurrentTemperature |
| fanControl | RotationSpeed (%) | - |

#### Altherma Accessory ([accessories/altherma-accessory.ts](src/accessories/altherma-accessory.ts))

Heat pump and hot water tank management.

**Services:**
- Climate Control: Thermostat service
- Hot Water: Thermostat service

### 6. Service Layer

Services encapsulate HAP service logic for climate control and hot water.

#### Climate Control Service ([services/climate-control.service.ts](src/services/climate-control.service.ts))

**Characteristic Handlers:**
- `Active` (GET/SET): Turn unit on/off
- `CurrentHeaterCoolerState` (GET): Current operating state
- `TargetHeaterCoolerState` (GET/SET): Cooling/heating/auto mode
- `CurrentTemperature` (GET): Room temperature
- `CoolingThresholdTemperature` (GET/SET): Target cooling temp
- `HeatingThresholdTemperature` (GET/SET): Target heating temp
- `RotationSpeed` (GET/SET): Fan speed (percentage)
- `SwingMode` (GET/SET): Fan swing (if supported)

**Update Flow:**
```
User changes target temp in Home app
     ↓
HAP SET handler
     ↓
Service validates value
     ↓
API PATCH request to Daikin
     ↓
Force update after delay (60s)
     ↓
Refresh device state from API
```

### 7. Feature System

Extensible feature modules for extra modes (Powerful, Econo, etc.).

#### Feature Architecture

```
BaseFeature (abstract)
  ├─ PowerfulModeFeature
  ├─ EconoModeFeature
  ├─ StreamerModeFeature
  ├─ OutdoorSilentModeFeature
  ├─ IndoorSilentModeFeature
  ├─ DryOperationModeFeature
  └─ FanOnlyOperationModeFeature
```

**Feature Lifecycle:**
1. FeatureRegistry discovers available features
2. Platform checks device capabilities
3. FeatureManager creates feature instances
4. Features register as Switch services
5. User toggles switch in Home app
6. Feature sends API request
7. State synced via polling or WebSocket

#### Adding a New Feature

```typescript
// 1. Create feature class
export class CustomModeFeature extends BaseFeature {
    featureName = 'customMode';
    displayName = 'Custom Mode';

    async isSupported(): Promise<boolean> {
        return this.device.getData(this.embeddedId, 'customMode') !== undefined;
    }

    async getState(): Promise<boolean> {
        const data = this.device.getData(this.embeddedId, 'customMode', undefined);
        return data.value === 'on';
    }

    async setState(enabled: boolean): Promise<void> {
        await this.controller.setDeviceData(/* ... */);
    }
}

// 2. Register in FeatureRegistry
import {CustomModeFeature} from './modes/custom-mode.feature';
export const FEATURE_REGISTRY = {
    customMode: CustomModeFeature,
    // ...
};

// 3. Add config option
showCustomMode?: boolean;

// 4. Update FeatureManager logic
```

### 8. Utility Layer

#### UpdateMapper ([utils/update-mapper.ts](src/utils/update-mapper.ts))

Centralized WebSocket update mapping logic.

**Consolidates:**
- Characteristic name mapping
- Service type handling (HeaterCooler vs Thermostat)
- State conversion logic
- Logging

**Before (duplicated in platform.ts):**
```typescript
switch (characteristicName) {
    case 'onOffMode':
        // 50 lines of logic
    case 'operationMode':
        // 50 lines of logic
}
```

**After (single source of truth):**
```typescript
const result = updateMapper.applyUpdate(accessory, update);
this.log.debug(`Updated ${result.updated.join(', ')}`);
```

#### Error Handler ([utils/error-handler.ts](src/utils/error-handler.ts))

Comprehensive error categorization and handling.

**Error Categories:**
- Network errors (timeout, connection refused)
- Authentication errors (401, 403)
- Rate limit errors (429)
- Server errors (500, 502, 503, 504)
- Validation errors (400)

**Severity Levels:**
- Critical: Authentication failure, controller not initialized
- Error: API errors, device not found
- Warning: Rate limit approaching, retry attempts
- Info: Normal operations

#### Config Manager ([config/config-manager.ts](src/config/config-manager.ts))

Centralized configuration with validation and defaults.

**Features:**
- Type-safe configuration access
- Zod schema validation
- Sensible defaults
- Validation with warnings/errors
- Normalized configuration caching

## Data Flow

### Device Discovery Flow

```
1. Homebridge starts
     ↓
2. Platform.constructor()
     ↓
3. Platform.didFinishLaunching()
     ↓
4. Authenticate (Developer Portal or Mobile App)
     ↓
5. DaikinController.updateAllDeviceData()
     ↓
6. API GET /v1/gateway-devices
     ↓
7. Parse device list
     ↓
8. For each device:
     ├─ Create DaikinCloudDevice
     ├─ Detect capabilities
     ├─ AccessoryFactory.create()
     ├─ Register with platform
     └─ Setup services and characteristics
     ↓
9. Start polling interval (Developer Portal)
   OR
   Connect WebSocket (Mobile App)
```

### State Update Flow (Polling)

```
1. setInterval fires (every N minutes)
     ↓
2. Platform.updateDevices()
     ↓
3. Controller.updateAllDeviceData()
     ↓
4. API GET /v1/gateway-devices
     ↓
5. For each device:
     ├─ device.updateData(apiResponse)
     ├─ Service reads new values
     └─ HAP pushes to HomeKit
```

### State Update Flow (WebSocket)

```
1. User changes setting on physical remote
     ↓
2. Daikin device sends update to cloud
     ↓
3. Cloud pushes WebSocket message
     ↓
4. Plugin WebSocket client receives message
     ↓
5. Parse and validate message
     ↓
6. Emit 'websocket_device_update' event
     ↓
7. Platform.handleWebSocketDeviceUpdate()
     ↓
8. UpdateMapper.applyUpdate()
     ↓
9. Service.updateCharacteristic()
     ↓
10. HomeKit reflects new state instantly
```

### User Control Flow

```
1. User adjusts temp in Home app
     ↓
2. HAP SET request
     ↓
3. Service.handleSet()
     ↓
4. Validate value
     ↓
5. Controller.setDeviceData()
     ↓
6. API PATCH /v1/gateway-devices/{id}
     ↓
7. Daikin Cloud processes request
     ↓
8. Physical device updates
     ↓
9. (After 60s delay)
     ├─ Force update
     └─ Refresh state from API
```

## Configuration Schema

```json
{
  "platform": "DaikinCloud",
  "authMode": "mobile_app",

  // Mobile App credentials
  "daikinEmail": "user@example.com",
  "daikinPassword": "password",

  // Developer Portal credentials
  "clientId": "abc123",
  "clientSecret": "xyz789",
  "callbackServerExternalAddress": "192.168.1.100",
  "callbackServerPort": 8582,
  "oidcCallbackServerBindAddr": "0.0.0.0",

  // Update settings
  "updateIntervalInMinutes": 15,
  "forceUpdateDelay": 60000,
  "enableWebSocket": true,

  // Device exclusions
  "excludedDevicesByDeviceId": ["device-id-1"],

  // Feature toggles
  "showPowerfulMode": true,
  "showEconoMode": true,
  "showStreamerMode": false,
  "showOutdoorSilentMode": false,
  "showIndoorSilentMode": false,
  "showDryMode": false,
  "showFanOnlyMode": false
}
```

## Security Considerations

1. **Token Storage**: Tokens saved with mode 0o600 (owner read/write only)
2. **Credential Logging**: Passwords and secrets masked in logs
3. **HTTPS**: All API communication over TLS
4. **Rate Limiting**: Proactive rate limit management prevents API lockout
5. **Input Validation**: Zod schemas validate all configuration input

## Performance Optimizations

1. **WebSocket vs Polling**: Real-time updates reduce API calls from ~96/day to ~10/day
2. **Update Mapper**: Centralized logic reduces code duplication and improves maintainability
3. **Force Update Delay**: 60s delay after user changes prevents rapid polling
4. **Capability Caching**: Device capabilities detected once at startup
5. **Exponential Backoff**: Failed requests don't overwhelm API

## Testing Strategy

### Unit Tests
- API client mocking
- Service characteristic handling
- Feature state management
- Config validation

### Integration Tests
- OAuth flows (Developer Portal + Mobile App)
- WebSocket connection/reconnection
- Device discovery and sync
- Full platform lifecycle

### Test Fixtures
Located in [test/fixtures/](test/fixtures/):
- Real device API responses
- Various device types (AC, Altherma, Heat Pump)
- Edge cases (unknown devices, missing data)

## Extending the Plugin

### Adding a New Device Type

1. Create device profile in [src/device/profiles/](src/device/profiles/)
2. Update capability detector for new characteristics
3. Create accessory class extending BaseAccessory
4. Register in AccessoryFactory
5. Add integration tests with fixture data

### Adding a New Authentication Method

1. Implement OAuthProvider interface
2. Add token management logic
3. Update DaikinControllerConfig type
4. Add configuration validation
5. Update platform initialization logic

### Adding a New API Endpoint

1. Add method to DaikinApi class
2. Define TypeScript types for request/response
3. Add Zod validation schema
4. Implement error handling
5. Add unit tests with mocked responses

## Troubleshooting

### Common Issues

1. **Token Expired**: Delete token file and re-authenticate
2. **Rate Limit Exceeded**: Increase polling interval or use Mobile App mode
3. **WebSocket Disconnects**: Check logs for reconnection attempts; firewall may block
4. **Device Not Found**: Verify device in Onecta app; check exclusion list

### Debug Logging

Enable debug mode:
```bash
homebridge -D
```

Look for log prefixes:
- `[Platform]`: Platform lifecycle
- `[OAuth]`: Authentication
- `[API]`: API requests/responses
- `[WebSocket]`: WebSocket events
- `[UpdateMapper]`: State updates
- `[Service]`: HAP service operations

## Future Enhancements

1. **Differential Updates**: Only sync changed devices
2. **Status UI**: Dashboard showing API usage, connection health
3. **Device-Level Error Tracking**: Per-device error states
4. **Advanced Scheduling**: HomeKit automation integration
5. **Multi-Language Support**: Internationalized device names
6. **Performance Profiling**: Memory leak detection, optimization

## References

- [Homebridge Plugin Development](https://developers.homebridge.io/)
- [HAP-nodejs Documentation](https://github.com/homebridge/HAP-NodeJS)
- [Daikin Developer Portal](https://developer.cloud.daikineurope.com/)
- [Onecta App Information](https://www.daikin.eu/en_us/product-group/control-systems/onecta.html)
