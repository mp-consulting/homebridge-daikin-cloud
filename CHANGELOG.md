# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.12] - 2026-03-05

### Changed

- **HAP characteristic sync after every poll**: `updateRawData()` now emits the `updated` event (previously only WebSocket updates did), and all services push current device state to HAP via `updateValue()` after every poll or WebSocket update — HomeKit always sees an accurate state, which allows it to self-filter redundant scene commands before they reach `onSet`

## [1.3.11] - 2026-03-05

### Fixed

- **Scene turning on already-off devices**: Set handlers now skip the API call when the device is already in the desired state — prevents the Daikin API from cycling a device that is already off when a "turn off all" scene fires

## [1.3.10] - 2026-03-04

### Fixed

- **HomeKit scene partial execution**: Write requests are now serialized through a queue with a 400ms inter-request delay — prevents burst rate limiting when a scene targets multiple devices simultaneously, which previously caused ~50% of commands to be silently dropped

## [1.3.9] - 2026-03-04

### Changed

- **Config UI**: Device list now shows ON/OFF badge before the name, Online/Offline badge pushed to the far right, and grey meta labels (Room, Outdoor, Mode, Model) on a subtle second line
- **Config UI**: Added GitHub and npm footer links
- **Config UI**: Auth status token timer moved before the Connected badge in the header

## [1.3.8] - 2026-03-04

### Changed

- **Config UI**: Migrate to homebridge-ui-kit design system (Bootstrap 5.3 + Bootstrap Icons, shared kit.css/kit.js, `data-bs-theme="dark"` dark mode)
- **Config UI**: Replace emoji icons with Bootstrap Icons throughout

## [1.3.7] - 2026-03-04

### Fixed

- **Proper HAP error handling for offline devices**: Set handlers now throw `HapStatusError(SERVICE_COMMUNICATION_FAILURE)` instead of raw errors, so HomeKit shows "No Response" and Homebridge no longer logs "This plugin threw an error from the characteristic" warnings
- **Device offline guard**: `setData()` now checks `isCloudConnectionUp` before making API calls, avoiding wasted requests and rate limit consumption when a device's cloud connection is down
- **Reduced log noise**: Replaced verbose error logging (full device JSON dump on every failed write) with concise warning messages

### Changed

- Refactored set handlers in `ClimateControlService` and `HotWaterTankService` to use a shared `setDeviceData()` helper that centralizes error handling and `forceUpdateDevices()` calls

## [1.3.6] - 2026-02-21

### Fixed

- **`holidayMode` schema mismatch**: Corrected Zod schema and TypeScript type for `holidayMode` — the Daikin API returns `value` as an object (`{ enabled: boolean, startDate?, endDate? }`) not a string, preventing all devices from loading on startup
- **Error mutation crash**: Fixed `TypeError: Cannot set property message of [object Object] which has only a getter` in `discoverDevices` by avoiding mutation of the `Error.message` property

### Changed

- Updated Mobile App daily API rate limit from 5000 to 3000 across all documentation, UI labels, and code comments to reflect the current Daikin Cloud limit

## [1.3.5] - 2026-01-10

### Fixed

- **Device Visibility initialization**: Fixed "Token expired or invalid" error in Device Visibility section while Discovered Devices worked correctly. Settings.load() now waits for AuthMode initialization to complete before loading device toggles, ensuring the correct authentication token is used.

## [1.3.4] - 2026-01-10

### Fixed

- **UI error message display**: Device Visibility section now displays specific error messages from the backend instead of generic text. Users can now see helpful messages distinguishing between authentication failures and empty device lists, making troubleshooting easier.

## [1.3.3] - 2026-01-10

### Fixed

- **UI initialization race condition**: Fixed "Token expired or invalid" error on initial UI load. The device list now waits for `AuthMode` initialization to complete before fetching devices. Backend now gracefully falls back to active token if the requested mode's token is unavailable, ensuring device list loads even during initialization.

## [1.3.2] - 2026-01-10

### Fixed

- **UI JavaScript error**: Fixed "Can't find variable: AuthModeManager" error by correcting variable reference to `AuthMode`. This error prevented the device list from loading in the plugin UI.

## [1.3.1] - 2026-01-10

### Fixed

- **UI device list authentication**: Fixed `/devices/list` endpoint to use the token matching the configured `authMode` instead of always prioritizing mobile token. Previously, if both mobile_app and developer_portal tokens existed, the endpoint would always use the mobile token regardless of the configured authMode setting, causing authentication mismatches.

## [1.3.0] - 2026-01-10

### Added

- **Strict TypeScript checking**: Enabled `strict`, `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, and `strictPropertyInitialization` for improved type safety
- **Runtime validation with Zod**: Added comprehensive validation schemas for API responses, WebSocket messages, and configuration
  - Token set validation
  - Device data validation
  - Configuration validation with helpful error messages
- **Utility modules** for improved reliability:
  - `retry.ts`: Exponential backoff retry logic with configurable options
  - `daikin-device-tracker.ts`: Device state tracking with change detection and error history
- **Comprehensive documentation** in `docs/` folder:
  - `ARCHITECTURE.md`: System architecture, component design, and extension guides
  - `IMPLEMENTATION_GUIDE.md`: Step-by-step guide for future improvements
  - `IMPROVEMENTS_SUMMARY.md`: Executive summary of completed work
  - `NEXT_STEPS.md`: Quick-start guide for continuing development
- **Enhanced CLAUDE.md**: Project-specific development guidelines and workflows

### Changed

- Consolidated WebSocket update logic using UpdateMapper (removed 180+ lines of duplication)
- Updated GitHub Actions workflows from v2/v3 to v4 (removed deprecation warnings)
- Improved test coverage with strict TypeScript compatibility

### Fixed

- 2 implicit `any` type errors in daikin-cloud.repository.ts
- Test compatibility issues with strict TypeScript mode
- UpdateMapper type compatibility issue

### Security

- Verified token file permissions (already secure at mode 0o600)
- Updated CI/CD dependencies to latest versions

### Documentation

- Moved all architectural and implementation documentation to `docs/` folder
- Enhanced project documentation for maintainers and contributors
- Added code examples and usage patterns for utilities

## [1.2.5] - 2026-01-10

### Fixed

- Fix API request format for temperature control to match mobile app format
- Path parameter now sent in request body instead of URL, resolving 504 Gateway Timeout errors when setting temperature

## [1.2.4] - 2026-01-09

### Fixed

- Handle API gateway timeout errors (502, 503, 504) with automatic retry and exponential backoff
- Requests now retry up to 3 times before failing, resolving most transient Daikin API issues

## [1.2.3] - 2026-01-09

### Fixed

- Check getData value property instead of result object in service
- Enable skipped tests and fix test isolation

### Added

- Automatic token refresh with exponential backoff for 401 errors
