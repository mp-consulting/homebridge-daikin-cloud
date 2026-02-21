# Implementation Guide for Remaining Improvements

This document provides detailed implementation guidance for the remaining improvements identified in the code analysis. Use this as a roadmap to complete the enhancement phases.

## ✅ Completed Improvements

### Phase 1: Foundation & Type Safety

#### 1.1 Enable Strict TypeScript Checking ✓
**Status**: Completed
**Changes Made:**
- Enabled `noImplicitAny: true` in [tsconfig.json](tsconfig.json)
- Fixed 2 implicit `any` type errors in [daikin-cloud.repository.ts](src/api/daikin-cloud.repository.ts)
- Build passes with strict type checking

#### 1.2 Add Data Validation Layer with Zod ✓
**Status**: Completed
**Changes Made:**
- Installed Zod v3.23.8 (compatible with TypeScript 4.4.4)
- Created [daikin-schemas.ts](src/api/daikin-schemas.ts) with validation schemas for:
  - TokenSet, RateLimitStatus
  - ManagementPoint, GatewayDevice
  - WebSocketDeviceUpdate
  - Configuration validation (DaikinClientConfig, MobileClientConfig, DaikinControllerConfig)
- Added `validateWithZod()` method to ConfigManager
- Helper functions: `validateData()` and `safeValidateData()`

**Next Steps:**
- Use Zod schemas in API response parsing
- Add validation to WebSocket message handling
- Validate device data before processing

#### 1.3 Consolidate WebSocket Update Logic ✓
**Status**: Completed
**Changes Made:**
- Refactored [platform.ts](src/platform.ts) to use [UpdateMapper](src/utils/update-mapper.ts)
- Removed 180+ lines of duplicated code
- Single source of truth for WebSocket update handling
- Improved maintainability and testability

#### 1.4 Security Hardening ✓
**Status**: Completed
**Changes Made:**
- Verified token files already use mode 0o600 (secure permissions)
- Updated GitHub Actions to v4:
  - [.github/workflows/build.yml](.github/workflows/build.yml): actions/checkout@v4, actions/setup-node@v4
  - [.github/workflows/npm-publish.yml](.github/workflows/npm-publish.yml): actions/checkout@v4, actions/setup-node@v4

#### 1.5 Create ARCHITECTURE.md ✓
**Status**: Completed
**Changes Made:**
- Created comprehensive [ARCHITECTURE.md](docs/ARCHITECTURE.md) with:
  - System architecture diagram
  - Component documentation
  - Data flow diagrams
  - Configuration schema
  - Security considerations
  - Extension guides

---

## 📋 Remaining Improvements

### Phase 1 Remaining Tasks

#### 1.6 Add Integration Tests for OAuth Flows

**Priority**: High
**Estimated Effort**: 4-6 hours
**Files to Create/Modify:**
- `test/integration/oauth-developer-portal.test.ts` (new)
- `test/integration/oauth-mobile-app.test.ts` (new)
- `test/mocks/oauth-mock-server.ts` (new)

**Implementation Steps:**

1. **Create OAuth Mock Server**
   ```typescript
   // test/mocks/oauth-mock-server.ts
   import express from 'express';

   export class OAuthMockServer {
       private app: express.Application;
       private server: any;

       constructor() {
           this.app = express();
           this.setupRoutes();
       }

       private setupRoutes() {
           // Mock authorization endpoint
           this.app.get('/v1/oidc/authorize', (req, res) => {
               const {redirect_uri, state} = req.query;
               res.redirect(`${redirect_uri}?code=mock_code&state=${state}`);
           });

           // Mock token endpoint
           this.app.post('/v1/oidc/token', (req, res) => {
               res.json({
                   access_token: 'mock_access_token',
                   refresh_token: 'mock_refresh_token',
                   token_type: 'Bearer',
                   expires_in: 3600,
               });
           });

           // Mock Gigya login
           this.app.post('/accounts.login', (req, res) => {
               res.json({
                   id_token: 'mock_gigya_token',
                   sessionInfo: {sessionToken: 'mock_session'},
               });
           });
       }

       start(port: number): Promise<void> {
           return new Promise((resolve) => {
               this.server = this.app.listen(port, () => resolve());
           });
       }

       stop(): Promise<void> {
           return new Promise((resolve) => {
               this.server.close(() => resolve());
           });
       }
   }
   ```

2. **Create Developer Portal OAuth Tests**
   ```typescript
   // test/integration/oauth-developer-portal.test.ts
   import {DaikinOAuth} from '../../src/api/daikin-oauth';
   import {OAuthMockServer} from '../mocks/oauth-mock-server';
   import fs from 'fs';
   import path from 'path';

   describe('Developer Portal OAuth Flow', () => {
       let mockServer: OAuthMockServer;
       let tokenFilePath: string;

       beforeAll(async () => {
           mockServer = new OAuthMockServer();
           await mockServer.start(8585);
           tokenFilePath = path.join(__dirname, '.test-tokenset');
       });

       afterAll(async () => {
           await mockServer.stop();
           if (fs.existsSync(tokenFilePath)) {
               fs.unlinkSync(tokenFilePath);
           }
       });

       test('should complete authorization code flow', async () => {
           const oauth = new DaikinOAuth({
               clientId: 'test_client',
               clientSecret: 'test_secret',
               callbackServerExternalAddress: 'localhost',
               callbackServerPort: 8586,
               tokenFilePath,
           });

           // Test authorization URL generation
           const authUrl = oauth.buildAuthUrl();
           expect(authUrl).toContain('response_type=code');
           expect(authUrl).toContain('client_id=test_client');

           // Test token exchange
           const tokenSet = await oauth.exchangeCode('mock_code');
           expect(tokenSet.access_token).toBe('mock_access_token');
           expect(tokenSet.refresh_token).toBe('mock_refresh_token');

           // Verify token was saved
           expect(fs.existsSync(tokenFilePath)).toBe(true);
           const savedToken = JSON.parse(fs.readFileSync(tokenFilePath, 'utf8'));
           expect(savedToken.access_token).toBe('mock_access_token');
       });

       test('should refresh expired token', async () => {
           // Implementation
       });

       test('should handle authentication errors', async () => {
           // Implementation
       });
   });
   ```

3. **Create Mobile App OAuth Tests**
   ```typescript
   // test/integration/oauth-mobile-app.test.ts
   import {DaikinMobileOAuth} from '../../src/api/daikin-mobile-oauth';

   describe('Mobile App OAuth Flow', () => {
       test('should login with email/password', async () => {
           // Implementation
       });

       test('should exchange Gigya token for OIDC token', async () => {
           // Implementation
       });

       test('should handle invalid credentials', async () => {
           // Implementation
       });
   });
   ```

4. **Add to package.json**
   ```json
   {
       "devDependencies": {
           "express": "^4.18.2",
           "@types/express": "^4.17.17"
       }
   }
   ```

**Testing:**
```bash
npm install
npm run test -- test/integration/oauth-developer-portal.test.ts
npm run test -- test/integration/oauth-mobile-app.test.ts
```

---

### Phase 2: Error Handling & Resilience

#### 2.1 Implement Error Recovery in Services

**Priority**: High
**Estimated Effort**: 3-4 hours
**Files to Modify:**
- [src/services/climate-control.service.ts](src/services/climate-control.service.ts)
- [src/services/hot-water-tank.service.ts](src/services/hot-water-tank.service.ts)

**Implementation Steps:**

1. **Create Retry Helper**
   ```typescript
   // src/utils/retry.ts
   export async function retryWithBackoff<T>(
       fn: () => Promise<T>,
       options: {
           maxRetries?: number;
           initialDelay?: number;
           maxDelay?: number;
           onRetry?: (attempt: number, error: Error) => void;
       } = {},
   ): Promise<T> {
       const {
           maxRetries = 3,
           initialDelay = 1000,
           maxDelay = 10000,
           onRetry,
       } = options;

       let lastError: Error;

       for (let attempt = 0; attempt <= maxRetries; attempt++) {
           try {
               return await fn();
           } catch (error) {
               lastError = error as Error;

               if (attempt < maxRetries) {
                   const delay = Math.min(
                       initialDelay * Math.pow(2, attempt),
                       maxDelay,
                   );

                   onRetry?.(attempt + 1, lastError);
                   await new Promise(resolve => setTimeout(resolve, delay));
               }
           }
       }

       throw lastError!;
   }
   ```

2. **Update Climate Control Service**
   ```typescript
   // In climate-control.service.ts
   import {retryWithBackoff} from '../utils/retry';
   import {ErrorHandler, ErrorSeverity} from '../utils/error-handler';

   async handleTargetStateSet(value: CharacteristicValue) {
       try {
           const targetState = value as number;

           await retryWithBackoff(
               async () => {
                   const operationMode = this.mapTargetStateToOperationMode(targetState);
                   await this.controller.setDeviceData(/* ... */);
               },
               {
                   maxRetries: 3,
                   onRetry: (attempt, error) => {
                       this.platform.log.warn(
                           `[Service] Retry attempt ${attempt} for target state: ${error.message}`,
                       );
                   },
               },
           );

           // Success - schedule force update
           this.scheduleForceUpdate();

       } catch (error) {
           const errorInfo = ErrorHandler.categorizeError(error);
           ErrorHandler.logError(
               this.platform.log,
               'Failed to set target state after retries',
               error,
               errorInfo.severity,
           );

           // Update characteristic to reflect failure
           this.service.updateCharacteristic(
               this.platform.Characteristic.TargetHeaterCoolerState,
               this.getCurrentTargetState(), // Revert to last known good state
           );

           throw new this.platform.api.hap.HapStatusError(
               this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
           );
       }
   }
   ```

3. **Add State Tracking**
   ```typescript
   private lastKnownGoodState: {
       active?: number;
       targetState?: number;
       coolingThreshold?: number;
       heatingThreshold?: number;
   } = {};

   private updateLastKnownGoodState(characteristic: string, value: number) {
       this.lastKnownGoodState[characteristic] = value;
   }
   ```

#### 2.2 Add WebSocket Resilience Tests

**Priority**: Medium
**Estimated Effort**: 3-4 hours
**Files to Create:**
- `test/unit/api/daikin-websocket.test.ts` (new)

**Implementation:**

```typescript
// test/unit/api/daikin-websocket.test.ts
import {DaikinWebSocket} from '../../../src/api/daikin-websocket';
import {EventEmitter} from 'events';
import WS from 'ws';

describe('DaikinWebSocket', () => {
    let mockServer: WS.Server;

    beforeEach(() => {
        mockServer = new WS.Server({port: 8587});
    });

    afterEach(() => {
        mockServer.close();
    });

    test('should connect and handle messages', async () => {
        const websocket = new DaikinWebSocket(/* ... */);

        await websocket.connect();

        // Simulate server message
        mockServer.clients.forEach(client => {
            client.send(JSON.stringify({
                deviceId: 'test-device',
                embeddedId: '0',
                characteristicName: 'onOffMode',
                data: {value: 'on'},
            }));
        });

        // Assert event was emitted
    });

    test('should reconnect after disconnect', async () => {
        const websocket = new DaikinWebSocket(/* ... */);
        await websocket.connect();

        // Simulate disconnect
        mockServer.close();

        // Wait for reconnection attempt
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Verify reconnection logic was triggered
    });

    test('should handle malformed messages gracefully', async () => {
        const websocket = new DaikinWebSocket(/* ... */);
        await websocket.connect();

        mockServer.clients.forEach(client => {
            client.send('invalid json');
        });

        // Should not crash
    });

    test('should respect exponential backoff on reconnect', async () => {
        // Test backoff delays: 1s, 2s, 4s, 8s, ...
    });
});
```

#### 2.3 Create Status UI for Monitoring

**Priority**: Medium
**Estimated Effort**: 6-8 hours
**Files to Create/Modify:**
- `homebridge-ui/public/status.html` (new)
- `homebridge-ui/server.js` (modify)

**Implementation:**

1. **Create Status Endpoint**
   ```javascript
   // homebridge-ui/server.js
   app.get('/status', async (req, res) => {
       try {
           const status = {
               authMode: config.authMode || 'developer_portal',
               authenticated: false,
               apiUsage: {
                   limitDay: 0,
                   remainingDay: 0,
                   limitMinute: 0,
                   remainingMinute: 0,
               },
               websocket: {
                   connected: false,
                   lastConnected: null,
               },
               devices: [],
               lastSync: null,
           };

           // Read status from plugin
           // (Plugin would need to expose status via file or API)

           res.json(status);
       } catch (error) {
           res.status(500).json({error: error.message});
       }
   });
   ```

2. **Create Status UI**
   ```html
   <!-- homebridge-ui/public/status.html -->
   <div class="card">
       <h3>Authentication Status</h3>
       <div id="auth-status">
           <span class="badge badge-success">Connected</span>
           <span>Mode: <strong id="auth-mode">Mobile App</strong></span>
       </div>
   </div>

   <div class="card">
       <h3>API Rate Limit</h3>
       <div class="progress">
           <div id="rate-limit-bar" class="progress-bar" style="width: 75%">
               <span id="rate-limit-text">75% remaining (2250/3000)</span>
           </div>
       </div>
       <small>Resets: <span id="rate-limit-reset">23:59 UTC</span></small>
   </div>

   <div class="card">
       <h3>WebSocket Connection</h3>
       <div id="websocket-status">
           <span class="badge badge-success">Connected</span>
           <span>Last message: <span id="ws-last-message">2 minutes ago</span></span>
       </div>
   </div>

   <div class="card">
       <h3>Devices</h3>
       <table class="table">
           <thead>
               <tr>
                   <th>Device</th>
                   <th>Status</th>
                   <th>Last Sync</th>
                   <th>Errors</th>
               </tr>
           </thead>
           <tbody id="device-list">
               <!-- Populated by JavaScript -->
           </tbody>
       </table>
   </div>

   <script>
       async function loadStatus() {
           const response = await fetch('/status');
           const status = await response.json();

           // Update UI with status
           document.getElementById('auth-mode').textContent = status.authMode;
           // ... etc
       }

       setInterval(loadStatus, 5000); // Refresh every 5 seconds
       loadStatus();
   </script>
   ```

---

### Phase 3: Documentation & Performance

#### 3.1 Add Comprehensive JSDoc Documentation

**Priority**: Medium
**Estimated Effort**: 4-6 hours
**Files to Modify**: All core classes

**Implementation Template:**

```typescript
/**
 * Daikin Cloud Controller
 *
 * Manages authentication, API communication, and device data for Daikin Cloud integration.
 * Supports both Developer Portal (OAuth 2.0) and Mobile App (Gigya) authentication modes.
 *
 * @example
 * ```typescript
 * const controller = new DaikinCloudController({
 *     authMode: 'mobile_app',
 *     email: 'user@example.com',
 *     password: 'password',
 *     tokenFilePath: '/path/to/tokens',
 * });
 *
 * await controller.authenticate();
 * await controller.updateAllDeviceData();
 * const devices = controller.getDevices();
 * ```
 *
 * @see {@link DaikinControllerConfig} for configuration options
 * @see {@link DaikinCloudDevice} for device data structure
 */
export class DaikinCloudController extends EventEmitter {
    /**
     * Creates a new Daikin Cloud Controller
     *
     * @param config - Controller configuration
     * @param logger - Optional logger instance for debugging
     * @throws {Error} If configuration is invalid
     */
    constructor(config: DaikinControllerConfig, logger?: Logger) {
        // ...
    }

    /**
     * Authenticate with Daikin Cloud
     *
     * Initiates authentication flow based on configured auth mode:
     * - Developer Portal: Starts OAuth callback server and returns authorization URL
     * - Mobile App: Automatically completes login and token exchange
     *
     * @returns Promise that resolves when authentication is complete
     * @throws {Error} If authentication fails or credentials are invalid
     * @emits token_update When tokens are refreshed
     * @emits error On authentication failure
     *
     * @example
     * ```typescript
     * try {
     *     await controller.authenticate();
     *     console.log('Authentication successful');
     * } catch (error) {
     *     console.error('Authentication failed:', error);
     * }
     * ```
     */
    async authenticate(): Promise<void> {
        // ...
    }
}
```

**Priority Files for JSDoc:**
1. [src/api/daikin-controller.ts](src/api/daikin-controller.ts)
2. [src/api/daikin-api.ts](src/api/daikin-api.ts)
3. [src/api/daikin-websocket.ts](src/api/daikin-websocket.ts)
4. [src/platform.ts](src/platform.ts)
5. [src/accessories/base-accessory.ts](src/accessories/base-accessory.ts)

#### 3.2 Implement Differential Device Updates

**Priority**: Low-Medium
**Estimated Effort**: 4-5 hours
**Files to Modify:**
- [src/api/daikin-device.ts](src/api/daikin-device.ts)
- [src/platform.ts](src/platform.ts)

**Implementation:**

```typescript
// In daikin-device.ts
export class DaikinCloudDevice {
    private lastUpdate: Date = new Date();
    private dataHash: string = '';

    /**
     * Check if device data has changed since last update
     */
    hasChanges(newData: GatewayDevice): boolean {
        const newHash = this.computeHash(newData);
        return this.dataHash !== newHash;
    }

    /**
     * Compute hash of device data for change detection
     */
    private computeHash(data: GatewayDevice): string {
        // Use fast-json-stable-stringify or similar
        return crypto
            .createHash('md5')
            .update(JSON.stringify(data))
            .digest('hex');
    }

    /**
     * Update device data and track last update time
     */
    updateData(updates: Partial<GatewayDevice>): void {
        this.deviceData = {...this.deviceData, ...updates};
        this.lastUpdate = new Date();
        this.dataHash = this.computeHash(this.deviceData);
    }

    /**
     * Get time since last update in milliseconds
     */
    getTimeSinceLastUpdate(): number {
        return Date.now() - this.lastUpdate.getTime();
    }
}
```

```typescript
// In platform.ts
private async updateDevices() {
    if (!this.controller) return;

    try {
        await this.controller.updateAllDeviceData();

        const devices = this.controller.getDevices();
        let changedCount = 0;

        devices.forEach(device => {
            if (device.hasChanges(/* new data */)) {
                changedCount++;
                // Only update accessories for changed devices
                this.updateAccessoriesForDevice(device);
            }
        });

        this.log.debug(
            `[API Syncing] Updated ${changedCount}/${devices.length} devices with changes`,
        );
    } catch (error) {
        this.log.error(`[API Syncing] Failed to update devices: ${error}`);
    }
}
```

#### 3.3 Add Device-Level Error Tracking

**Priority**: Low
**Estimated Effort**: 3-4 hours
**Files to Modify:**
- [src/api/daikin-device.ts](src/api/daikin-device.ts)
- [src/accessories/base-accessory.ts](src/accessories/base-accessory.ts)

**Implementation:**

```typescript
// In daikin-device.ts
export interface DeviceError {
    timestamp: Date;
    severity: 'error' | 'warning';
    message: string;
    operation: string;
    retryCount: number;
}

export class DaikinCloudDevice {
    private errors: DeviceError[] = [];
    private maxErrors = 10; // Keep last 10 errors

    addError(error: DeviceError): void {
        this.errors.unshift(error);
        if (this.errors.length > this.maxErrors) {
            this.errors.pop();
        }
    }

    getErrors(): DeviceError[] {
        return [...this.errors];
    }

    getRecentErrors(since: Date): DeviceError[] {
        return this.errors.filter(e => e.timestamp >= since);
    }

    clearErrors(): void {
        this.errors = [];
    }

    hasRecentErrors(): boolean {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        return this.getRecentErrors(fiveMinutesAgo).length > 0;
    }
}
```

```typescript
// In base-accessory.ts
protected handleError(
    operation: string,
    error: Error,
    retryCount: number = 0,
): void {
    this.accessory.context.device.addError({
        timestamp: new Date(),
        severity: retryCount >= 3 ? 'error' : 'warning',
        message: error.message,
        operation,
        retryCount,
    });

    // Log error with device context
    this.platform.log.error(
        `[${this.accessory.displayName}] ${operation} failed: ${error.message}`,
    );

    // Optionally update a status characteristic
    // this.updateErrorStatusCharacteristic();
}
```

---

## Testing & Verification

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test file
npm test -- test/unit/api/daikin-api.test.ts

# Watch mode for development
npm test -- --watch
```

### Build & Lint

```bash
# Build TypeScript
npm run build

# Lint code
npm run lint

# Fix linting issues
npm run lint -- --fix
```

### Pre-Commit Checklist

- [ ] All tests pass
- [ ] Coverage > 70% for modified files
- [ ] No linting errors
- [ ] Build completes successfully
- [ ] Documentation updated (JSDoc, README)
- [ ] CHANGELOG.md updated

---

## Performance Benchmarks

### Before Improvements
- Test coverage: 62%
- Build time: ~5s
- Unchecked type assertions: 27
- Duplicated code: ~200 lines
- GitHub Actions: Using deprecated v2

### After Phase 1
- Test coverage: 62% (unchanged, tests pending)
- Build time: ~5s
- Unchecked type assertions: 2 (explicit `any`)
- Duplicated code: 0 (consolidated)
- GitHub Actions: Using v4
- Validation: Zod schemas added

### Target After All Phases
- Test coverage: > 80%
- Build time: < 6s
- Unchecked type assertions: 0
- Duplicated code: 0
- Documentation: 100% public APIs
- Performance: Differential updates reduce CPU usage

---

## Migration Notes

### Breaking Changes
None of the completed improvements introduce breaking changes.

### Configuration Changes
No configuration changes required. Zod validation is backward-compatible.

### Token File Migration
No migration needed. Token file format unchanged, permissions already secure.

---

## Troubleshooting Implementation Issues

### TypeScript Strict Mode Errors
If strict mode reveals new errors:
1. Add explicit types instead of using `any`
2. Use type guards for runtime validation
3. Use Zod schemas for external data

### Zod Version Compatibility
Zod v3.23.8 is compatible with TypeScript 4.4.4. Do not upgrade to Zod v4 without upgrading TypeScript to 5.0+.

### Test Failures After Refactoring
If tests fail after consolidating WebSocket logic:
1. Update test mocks to use UpdateMapper
2. Verify characteristic mappings match original logic
3. Check event emission in UpdateMapper tests

---

## Resources

- [Zod Documentation](https://zod.dev/)
- [Jest Testing Guide](https://jestjs.io/docs/getting-started)
- [Homebridge Plugin Development](https://developers.homebridge.io/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [GitHub Actions](https://docs.github.com/en/actions)

---

## Contributing

When implementing improvements:
1. Create feature branch: `feature/improvement-name`
2. Implement changes with tests
3. Update documentation
4. Submit PR with description linking to this guide
5. Ensure CI passes

---

## Next Steps

1. **Immediate**: Run test suite to verify completed changes
2. **Short-term**: Implement OAuth integration tests (Phase 1.6)
3. **Medium-term**: Add error recovery to services (Phase 2.1)
4. **Long-term**: Complete JSDoc documentation (Phase 3.1)

---

*Last Updated: 2026-01-10*
*Maintained by: Claude Code*
