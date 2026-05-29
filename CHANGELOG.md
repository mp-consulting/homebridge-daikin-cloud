# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.25] - 2026-05-29

### Added

- **Oscillation switch** (`showOscillationSwitch`): exposes fan oscillation (swing) as its own HomeKit switch, in addition to the built-in `SwingMode` on the HeaterCooler. When the accessory is grouped into a single tile in the Home app, Apple hides the built-in swing toggle (and the fan speed slider) — a standalone switch keeps oscillation toggleable from the grouped view. ON sets both fan-direction axes to `swing`, OFF to `stop`, mirroring the existing `SwingMode` handlers so the two stay in sync. Honors both the per-feature toggle and the legacy `showExtraFeatures` flag.
- **Separate Fan tile** (`showSeparateFanControl`): exposes fan speed and oscillation as a standalone `Fanv2` service, so both controls stay visible even when the air conditioner is grouped into a single tile. Its `Active` mirrors the unit on/off and its `RotationSpeed`/`SwingMode` reuse the HeaterCooler handlers. Only added when the device exposes a fixed fan speed and/or swing; defaults off and is never enabled implicitly by `showExtraFeatures`.
- Both options are configurable from the plugin's custom UI (Features tab), not just the fallback schema form.

### Fixed

- **Auto fan mode switch not turning off when moving the fan speed slider**: `setData` wrote to the cloud but never updated the in-memory cache, so reads returned the stale value until the next poll (up to a minute on Developer Portal). Moving the slider flips `fanSpeed/currentMode` to `fixed`, but the Auto fan mode switch kept reading `auto` and stayed on. `setData` now optimistically applies each successful write to the local cache, and `handleRotationSpeedSet` refreshes the fan-mode switches immediately — so the Auto fan (and Indoor quiet) switch reflects the change at once instead of waiting for a poll. The next full poll reconciles any drift.

## [1.3.24] - 2026-05-29

### Added

- **Auto fan mode switch** (`showAutoFanMode`): exposes Daikin's automatic fan-speed mode as a HomeKit switch. HomeKit's HeaterCooler `RotationSpeed` is a single 0-100% slider with no native concept of an "Auto" fan mode, so Auto is surfaced as its own switch next to the manual speed slider and the existing Indoor quiet switch. Turning it ON sets `fanSpeed/currentMode` to `auto`; OFF returns it to `fixed` (manual). The switch only appears when the current operation mode advertises both `auto` and `fixed`, moving the speed slider flips it back off, and it stays mutually exclusive with the Indoor quiet switch via the existing `FeatureManager.refreshAll()` refresh path. Honors both the per-feature toggle and the legacy `showExtraFeatures` flag.

## [1.3.23] - 2026-05-28

### Fixed

- **Auto mode showing stale setpoint in the Daikin app**: HomeKit HeaterCooler exposes Auto as a temperature range (heating threshold + cooling threshold), while Daikin's auto operationMode uses a single setpoint. The threshold setters now also mirror the heating/cooling midpoint to `/operationModes/auto/setpoints/roomTemperature` whenever the device exposes one, so the Daikin app reflects the HomeKit choice instead of keeping a stale value (e.g. "auto 25°" after setting HomeKit to 19-21°). Best-effort: failures (Altherma's `weatherDependentHeatingFixedCooling` doesn't resolve a setpoint for auto, etc.) silently skip the sync — the primary heating/cooling write still succeeds.
- **CI lint**: a debug template literal in `handleRotationSpeedGet` exceeded the 160-char `max-len` rule. Local builds passed only because of a stale `.eslintcache`; CI caught it on the v1.3.22 release. The line is split now.

## [1.3.22] - 2026-05-28

### Fixed

- **RotationSpeed 400 errors**: Zod 4 silently stripped `minValue`/`maxValue`/`stepValue` from `fanSpeed.modes.*` because the schema only declared `value`. `setProps` then ran with `undefined` ranges, the iOS slider kept its 0-100 default, and Daikin rejected values like 36/93/100 with `INVALID_CHARACTERISTIC_VALUE`. Schema now wraps every nested characteristic object with a `chr()` helper (`z.object(...).loose()`) so unknown metadata Daikin returns (`settable`, `ref`, `unit`, `values`, …) survives parsing across the board.
- **WebSocket data destruction**: `applyWebSocketUpdate` now deep-merges partial sub-trees instead of replacing whole `value` objects. Daikin pushes characteristics like `fanControl` with only the changed `operationMode`/sub-path — the previous assignment-style update wiped every sibling out of memory until the next 5-min poll, causing `hasSwingModeFeature` to flap and HomeKit setters to silently skip writes with `value === undefined`.
- **RotationSpeed slider display**: Device fan speed (typically 1-5) is now mapped to HomeKit's 0-100 percentage in both directions, so max device speed shows as a full slider bar instead of "5%". `setProps` is also called before `updateValue` (and uses `minValue: 0`) so stale characteristic state from a prior session can't trip HAP's `validateUserInput` on plugin reload.
- **Feature switches not pushed from the Daikin app**: PowerfulMode, EconoMode, StreamerMode, OutdoorSilentMode, IndoorSilentMode and the dry/fan-only mode switches now push their state to HomeKit on every WebSocket update via a new `BaseFeature.refresh()` / `FeatureManager.refreshAll()`. Toggling these in the Onecta app now reflects in the Home app immediately instead of waiting for the next user-initiated GET.

### Added

- **Schema-drift checker** (`npm run schema:check`): fetches live devices from Daikin Cloud, diffs the raw payload against the Zod-parsed result, and reports every silently-stripped key path. `--dump-fixtures` additionally writes per-device fixtures to `test/fixtures/live/` (gitignored). Catches the class of bug that hid the RotationSpeed 400 for months.

### Changed

- **Less log spam**: dropped per-axis `hasSwingModeFeature` debug logs that fired multiple times on every WebSocket-driven refresh, and silenced `[UpdateMapper] Unhandled characteristic: <name>` — the `refreshValues` path already covers every characteristic from in-memory state on each `'updated'` event, so missing a fast-path mapping is not an error.

## [1.3.21] - 2026-04-17

### Fixed

- **Zod 4 migration**: Pass explicit key schema to `z.record()` calls and rename `ZodError.errors` to `ZodError.issues` — tsc errors that blocked the v1.3.20 npm publish

## [1.3.20] - 2026-04-17

### Changed

- **Dependencies**: Updated all dependencies to latest versions, including major bumps for `zod` (3→4), `@homebridge/plugin-ui-utils` (1→2), `eslint` (9→10), `typescript` (5→6), and `@types/node` (24→25)

### Fixed

- **Error handling**: Attach original error as `cause` when re-throwing in SSL generation, OAuth callback URL parsing, token exchange, and Zod validation, complying with the new `preserve-caught-error` ESLint rule and preserving the original stack trace

## [1.3.19] - 2026-04-04

### Changed

- **Node.js**: Add Node.js 24.x support to CI matrix and standardize engines to `^20.18.0 || ^22.10.0 || ^24.0.0`

## [1.3.18] - 2026-03-30

### Changed

- **Dependencies**: Add `class-validator` as a direct dependency for `homebridge-config-ui-x` compatibility
- **Node.js**: Standardize `.tool-versions` to Node 20.22.2

## [1.3.17] - 2026-03-26

### Fixed

- **Mobile-app authentication fails with error 206001 "Account Pending Registration"**: Accounts created via social login or with incomplete registration fields were permanently locked out. The plugin now detects Gigya error `206001` and automatically completes the pending registration via `accounts.register` with `finalizeRegistration`, using existing profile data when available and deriving name from email as a fallback. Closes #3.

### Changed

- **Refactored Gigya request helpers**: Extracted shared POST headers, SDK params, and login token validation into reusable helpers (`gigyaPostHeaders`, `gigyaSdkParams`, `extractLoginToken`) to reduce duplication across Gigya endpoints.

## [1.3.16] - 2026-03-26

### Changed

- **Dependencies**: Updated all dependencies to latest compatible versions

## [1.3.15] - 2026-03-05

### Fixed

- **Config UI light mode**: Hardcoded `data-bs-theme="dark"` broke layout in light mode. Added early inline theme detection from `window.matchMedia` and confirmed via `homebridge.getUserSettings()` after ready.

## [1.3.14] - 2026-03-05

### Fixed

- **HomeKit scene shows "Failed" then recovers**: The global write queue serialized all PATCH requests across all devices, causing a scene with 4 devices × 6 writes each to take ~10+ seconds — exceeding HomeKit's timeout. Replaced the single global queue with per-device queues so each device's writes are serialized independently while different devices write in parallel. Scene execution time drops from ~10s to ~3s.

## [1.3.13] - 2026-03-05

### Fixed

- **Scene turning off active devices then re-activating them**: `handleTargetHeaterCoolerStateSet` was unconditionally enqueuing `onOffMode=ON` after setting the operation mode. In a "turn off all" scene, HomeKit fires both `TargetHeaterCoolerState` and `Active=INACTIVE` simultaneously; the `Active=INACTIVE` write was landing in the queue before the deferred `onOffMode=ON` write, causing some devices to end up ON. The operation mode handler now only sets `operationMode` — `onOffMode` is controlled exclusively by the `Active` characteristic, which iOS always sends alongside any mode change.
- **Idempotency guard never firing**: `value as boolean` cast did not convert HAP's numeric `0`/`1` to a JavaScript boolean, so the strict `===` comparison against a boolean always returned `false`. Fixed to `value === Characteristic.Active.ACTIVE`.

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
