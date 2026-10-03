# Claude Code Settings

## Project Overview

This is a Homebridge plugin for Daikin Cloud (Onecta) integration that allows controlling Daikin air conditioning units through Apple HomeKit. The plugin supports both Developer Portal and Mobile App authentication methods.

**Key Technologies:**
- TypeScript (strict, target ES2022, CommonJS output in `dist/`)
- Homebridge Plugin API
- HAP-nodejs (HomeKit Accessory Protocol)
- Zod for runtime validation of API payloads and config
- Vitest for testing (with v8 coverage thresholds)
- ESLint (flat config, `eslint.config.mjs`) for code quality

## Git Settings

- `coAuthoredBy`: false

## Git Commit Convention

Use conventional commits format for all commit messages:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, semicolons, etc.)
- `refactor`: Code refactoring (no functional changes)
- `test`: Adding or updating tests
- `chore`: Maintenance tasks, dependencies, build changes
- `perf`: Performance improvements
- `ci`: CI/CD changes

### Scopes
Common scopes used in this project:
- `api`: Daikin API client, OAuth, WebSocket
- `service`: Climate control, hot water tank services
- `accessory`: Air conditioning, Altherma accessories
- `feature`: Feature modules (modes like powerful, econo, etc.)
- `device`: Device profiles, capability detection
- `config`: Configuration management
- `utils`: Utility functions
- `build`: Build system and TypeScript configuration
- `deps`: Dependency updates

### Examples
- `feat(api): add device capability detection`
- `fix(service): resolve temperature validation warning`
- `chore(deps): update dependencies`
- `refactor(features): extract feature modules from service`
- `test(config): cover feature flag resolution`

## Code Style Guidelines

### TypeScript & Code Quality

1. **Indentation**: 2 spaces (enforced by ESLint)
2. **Quotes**: Single quotes for strings
3. **Semicolons**: Required
4. **Trailing commas**: Required in multiline objects/arrays
5. **Type safety**:
   - `strict: true` and `noImplicitAny: true` in tsconfig
   - Use `import type` for type-only imports (enforced)
   - Prefer explicit types for public APIs

### ESLint Rules
The project uses `@typescript-eslint` with custom rules, run with `--max-warnings=0`:
- Prefer arrow callbacks
- Always use curly braces
- `eqeqeq` (smart), `prefer-const`, max line length 160
- No `console.log` in plugin code by convention - use the Homebridge logger

### File Organization

```
src/
├── accessories/          # HAP accessories (base, air-conditioning, altherma)
├── api/                  # Daikin Cloud client
│   ├── daikin-controller.ts      # Orchestrates OAuth, REST API and WebSocket
│   ├── daikin-api.ts             # REST client: rate limits, retries/backoff, write queue + coalescing
│   ├── daikin-oauth.ts / daikin-mobile-oauth.ts  # Developer Portal / Mobile App auth
│   ├── token-client.ts           # Shared token endpoint client for both auth modes
│   ├── token-storage.ts          # Atomic 0600 token file persistence
│   ├── http-transport.ts / http-defaults.ts      # node|curl transport, TLS/UA defaults
│   ├── daikin-websocket.ts       # Real-time updates (Mobile App only)
│   ├── daikin-device.ts          # Device model; emits 'updated'
│   ├── daikin-schemas.ts         # Zod schemas
│   └── daikin-cloud.repository.ts  # Masks sensitive device data for logs (nothing else)
├── config/               # ConfigManager: single source of plugin configuration
├── constants/            # Shared constants (API, auth, device, time)
├── device/               # Capability detection, accessory factory, data-paths.ts, profiles/
├── features/             # Feature switches: base-feature, feature-manager,
│   │                     #   on-off-data-point-feature.ts (shared on/off base)
│   └── modes/            # One file per mode (powerful, econo, holiday, firmware, ...)
├── services/             # HAP services
│   ├── climate-control.service.ts  # HeaterCooler service (entry point)
│   ├── climate-control/  # fan-speed, setpoint-resolver, swing-controller, separate-fan.service
│   └── hot-water-tank.service.ts
├── types/                # TypeScript type definitions
├── utils/                # errors.ts (toMessage), hap-write.ts (withHapWrite), sleep.ts,
│                         #   strings.ts
├── index.ts              # Plugin entry point
├── platform.ts           # Platform: discovery, polling schedule, WebSocket wiring
└── settings.ts           # Plugin/platform names
homebridge-ui/            # Custom settings UI (server.js + public/)
config.schema.json        # Config schema shown by Homebridge UI
```

### Test Organization

```
test/
├── fixtures/            # Device API responses (TypeScript modules)
├── mocks/               # Mock objects for testing
├── helpers/             # createTestPlatform/useFakeTimersPerTest/hap; isolated-storage setup file
├── hbConfig/            # Sample Homebridge config (config.json here is used by schema:check)
├── unit/                # Unit tests
│   ├── accessories/
│   ├── api/
│   ├── config/
│   ├── device/
│   ├── features/
│   ├── services/
│   ├── ui/              # homebridge-ui/server.js (loaded via createRequire, uses dist/)
│   └── utils/
└── integration/         # Platform/accessory integration tests
```

## Development Workflow

### Building and Testing

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run linter
npm run lint

# Type-check src/ and test/ (vitest itself does not type-check)
npm run typecheck

# Run tests (vitest)
npm test

# Run tests with coverage (thresholds in vitest.config.mts; CI fails below them)
npm run test:coverage

# Update test snapshots
npx vitest run -u

# Development with auto-rebuild
npm run watch

# Schema drift check against the LIVE Daikin API (manual only, not run in CI):
# needs real credentials in test/hbConfig/config.json and spends API quota
npm run schema:check
```

`scripts/manual/` holds ad-hoc scripts against the live Daikin endpoints (real credentials,
not run by tests or CI); see its README.

The UI server tests (`test/unit/ui`) load `homebridge-ui/server.js`, which requires
compiled code from `dist/`, so run `npm run build` before `npm test` after changing `src/`.

### Testing Guidelines

1. **Write tests for new features**: All new functionality should include unit tests
2. **Update snapshots carefully**: Review snapshot changes before committing
3. **Use fixtures**: Add device response fixtures in `test/fixtures/` for new device types
4. **Mock external dependencies**: Use mocks from `test/mocks/` for API calls
5. **Test coverage**: Keep above the thresholds in `vitest.config.mts` (covers `src/` and `homebridge-ui/server.js`)
6. **Platform & HAP in tests**: build platforms with `createTestPlatform()` and use `hap` from
   `test/helpers/platform.ts` (homebridge's HAP, not the standalone `hap-nodejs`); a vitest
   setup file points the Homebridge storage path at a temp dir, so tests never touch `~/.homebridge`

### Common Development Tasks

#### Adding a New Feature Mode

1. Create feature class in `src/features/modes/` (extend `BaseFeature`, or
   `OnOffDataPointFeature` for a simple on/off data point)
2. Register it in `CLIMATE_CONTROL_FEATURES` / `HOT_WATER_TANK_FEATURES` in `src/features/feature-manager.ts`
3. Add the `show*` toggle to `config.schema.json` (no `default` for extra features), `FEATURE_CONFIG_KEYS` in `src/config/config-manager.ts` and the custom UI's `FEATURE_KEYS`/`STANDALONE_KEYS` (a test keeps all three in sync)
4. Add tests in `test/unit/features/`
5. Update README (Features list and Configuration Options table)

#### Adding Device Support

1. Add device response fixture in `test/fixtures/`
2. Update capability detector if needed
3. Create/update device profile in `src/device/profiles/`
4. Add integration test
5. Document in [README.md](README.md)

#### Fixing API Issues

1. Rate limiting, retries/backoff and write coalescing live in `src/api/daikin-api.ts`
2. Poll scheduling (WebSocket stretch, failure backoff, low-quota stretch) is `computePollInterval()` in `src/platform.ts`
3. Format errors with `toMessage()` (`src/utils/errors.ts`); wrap HomeKit SET handlers in `withHapWrite()` (`src/utils/hap-write.ts`)
4. Add tests for error scenarios

## Homebridge-Specific Considerations

### Platform Plugin Structure

- **Platform**: [platform.ts](src/platform.ts) - Main entry point, manages accessories
- **Accessories**: [src/accessories/](src/accessories/) - HAP accessory implementations
- **Services**: [src/services/](src/services/) - HAP service wrappers

### HAP Service Types Used

- `HeaterCooler`: Main climate control
- `TemperatureSensor`: Room temperature
- `Switch`: Feature modes (powerful, econo, etc.)
- `Thermostat`: Altherma heating (optional)

### Configuration Schema

Configuration is managed via Homebridge UI:
- Uses Homebridge custom UI framework (`homebridge-ui/`) for plugin configuration management
- Config schema defined in [config.schema.json](config.schema.json)
- [ConfigManager](src/config/config-manager.ts) is the single source of config: read
  settings through it (defaults, legacy aliases, validation), not from the raw platform config

## API Integration Notes

### Authentication Methods

1. **Developer Portal** (OAuth 2.0):
   - Client ID/Secret from Daikin Developer Portal
   - 200 API calls/day limit
   - Callback server for OAuth flow

2. **Mobile App** (Gigya):
   - Email/password authentication
   - 3000 API calls/day limit
   - WebSocket support for real-time updates

### Rate Limiting

- Implemented in [daikin-api.ts](src/api/daikin-api.ts): rate-limit headers, blocking on 429,
  exponential backoff, per-device write queue that coalesces rapid writes
- Gateway errors (502, 503, 504) are retried for writes, not for polling GETs (the next poll
  is the retry; the platform backs off its poll interval)
- While the WebSocket is connected, polling stretches to >= 60 min and forced post-write
  refreshes are skipped

### WebSocket Support

- Only available in Mobile App mode
- Real-time device state updates: applied to the `DaikinCloudDevice`, which emits
  `'updated'` → accessory `refreshValues()` (`websocket_device_update` is informational)
- Implemented in [daikin-websocket.ts](src/api/daikin-websocket.ts)

## Debugging Tips

### Enable Debug Logging

Set Homebridge debug mode:
```bash
homebridge -D
```

### Common Issues

1. **Token expired**: Delete `~/.homebridge/.daikin-controller-cloud-tokenset`
2. **Device not found**: Check `excludedDevicesByDeviceId` in config
3. **WebSocket connection fails**: Verify Mobile App credentials
4. **Rate limit hit**: Increase `updateIntervalInMinutes`

### Useful Log Contexts

Log lines are prefixed with a context tag such as `[API Syncing]` or `[<device name>]`.
- Error formatting in [errors.ts](src/utils/errors.ts) and [hap-write.ts](src/utils/hap-write.ts)

## CI

[build.yml](.github/workflows/build.yml) runs lint, build and tests on Node 20/22/24/26, a
coverage run with thresholds on Node 24, and a runtime smoke test (load the built plugin with
production dependencies only) on the minimum `engines` versions 20.5.0 and 22.10.0, where the
dev toolchain itself cannot run. `schema:check` is deliberately not in CI (live credentials).

## Release Process

Publishing to npm is done by CI, not by hand: [publish.yml](.github/workflows/publish.yml)
runs on a **published GitHub Release**, runs lint, build and tests, and publishes with provenance. Do not run
`npm publish` locally for a normal release — it would publish the same version twice.

1. Update version in [package.json](package.json) — `npm version X.Y.Z --no-git-tag-version`
   also updates `package-lock.json`
2. Add the release section to [CHANGELOG.md](CHANGELOG.md), and update [README.md](README.md)
   if needed
3. Run tests: `npm test`
4. Build: `npm run build`
5. Commit: `chore: release vX.Y.Z`
6. Tag: `git tag vX.Y.Z`
7. Push branch and tag: `git push origin main && git push origin vX.Y.Z`
   (the tags are lightweight, so `--follow-tags` will not push them)
8. Create the GitHub Release, which triggers the npm publish:
   `gh release create vX.Y.Z --title vX.Y.Z --notes-file <changelog section>`
9. Check the run: `gh run list --workflow=publish.yml --limit 1`. The registry can lag a
   few minutes behind a successful publish.

`npm run release` / `npm run release:beta` publish directly from the working tree and exist
only for one-off beta or recovery publishes.

## Important Constraints

### Do NOT
- Use `console.log` - always use Homebridge logger
- Commit without running tests and linter
- Add dependencies without considering bundle size
- Break backward compatibility without major version bump
- Hardcode sensitive data (credentials, tokens)

### DO
- Follow the established directory structure
- Add tests for new features
- Update documentation
- Handle errors gracefully with user-friendly messages
- Consider API rate limits in all API calls
