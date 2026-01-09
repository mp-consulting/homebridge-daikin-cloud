# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.2.2] - 2026-01-09

### Added
- Automatic token refresh with exponential backoff on 401 Unauthorized responses
- Retry constants for configurable backoff behavior (MAX_RETRY_ATTEMPTS, RETRY_BASE_DELAY_MS, RETRY_MAX_DELAY_MS)
- New API unit tests for DaikinApi and OAuth

### Changed
- OAuthProvider interface now includes `refreshToken()` method
- Auth status checks in UI are debounced to prevent excessive API calls

## [1.2.1] - 2026-01-09

### Fixed
- Dark mode auto-detection using Bootstrap 5 `data-bs-theme` attribute
- UI now properly responds to system dark/light mode preference changes

## [1.2.0] - 2026-01-09

### Changed
- **UI Redesign**: Migrated to Bootstrap 5 components for cleaner, more consistent design
  - Added Bootstrap 5 CDN for proper styling
  - Reduced custom CSS from ~1130 lines to ~200 lines
  - Form controls use native Bootstrap form styling
  - Toggle switches use Bootstrap form-switch with `role="switch"`
  - Devices displayed as list instead of card grid
  - Help tab redesigned with stacked cards for narrow screens
  - Simplified troubleshooting section
- Rate limit info text now dynamically updates based on authentication mode
- Rate limit API now checks based on selected authentication mode
- Refactored script.js with DOM helpers and centralized state management

## [1.1.3] - 2026-01-09

### Fixed
- Dark mode support for plugin settings UI
- All UI elements now properly adapt to system dark mode preference
- Rate limit log no longer shows "undefined/undefined" for minute limits in Mobile App mode

## [1.1.1] - 2026-01-09

### Changed
- Version bump for npm release

## [1.1.0] - 2026-01-09

### Added
- **Mobile App Authentication**: New authentication method using Daikin Onecta mobile app credentials
  - 5000 API calls/day (vs 200 for Developer Portal)
  - No developer portal account required
  - Uses same credentials as Daikin Onecta mobile app
- **WebSocket Real-time Updates**: Instant device state changes without polling (Mobile App mode)
  - Temperature updates pushed to HomeKit immediately
  - Operation mode changes reflected instantly
  - On/off state synchronization in real-time
- **Dynamic Settings UI**: Settings automatically adjust based on authentication mode
  - Recommended values shown for each mode
  - WebSocket toggle (Mobile App only)
  - Settings subtabs for better organization (Features, Polling, Network, Devices)
- **Constants Module**: Centralized configuration constants for better maintainability

### Changed
- Settings page now uses tabbed layout for better organization
- Update interval can now be as low as 1 minute (Mobile App mode)
- Force update delay can now be as low as 5 seconds
- Improved rate limit display in UI shows auth mode limits

### Fixed
- Temperature validation to prevent undefined value warnings
- Default temperature values when sensors are unavailable
- WebSocket updates now use correct HomeKit characteristics for HeaterCooler service

## [1.0.3] - 2026-01-09

### Added
- Auto-detection of server IP address for OAuth callback configuration
- Server info endpoint (`/server/info`) to retrieve Homebridge server IP

### Changed
- Improved OAuth callback response page with modern styling
- Callback server address field now auto-populates with detected IP

## [1.0.2] - 2026-01-09

### Added
- Automatic OAuth callback capture (no manual URL copying needed)
- Manual URL entry as fallback if automatic capture fails
- Custom Daikin API client implementation

### Changed
- Removed `daikin-controller-cloud` dependency for full control over API integration
- OAuth flow now starts a temporary HTTPS callback server
- Callback server automatically stops after successful authentication
- UI now imports from compiled API modules (code deduplication)

### Fixed
- Token refresh no longer requires callback server (direct API call)

## [1.0.1] - 2026-01-09

### Added
- Auto-save for all settings (no manual save button needed)
- Individual feature toggles (Powerful, Econo, Streamer, Silent modes, etc.)
- Device visibility toggles in settings UI
- Input validation for IP addresses, ports, and number fields

### Changed
- Settings UI now uses list format for feature toggles
- Force Update Delay now configured in seconds instead of milliseconds
- Improved form validation with visual feedback

### Fixed
- Settings now persist immediately on change

## [1.0.0] - 2025-01-09

### Added
- Initial release
- Daikin Cloud (Onecta) API integration
- Temperature control (current and target)
- Operation modes: cooling, heating, auto
- Fan speed control
- Swing mode support
- Extra feature switches (powerful, econo, streamer, outdoor silent, indoor quiet, dry, fan only)
- Custom Homebridge UI for OAuth authentication
- Device listing with power state and temperature display
- Rate limit tracking and display
- Token expiration countdown
- Device exclusion by ID
- Configurable polling interval
- Altherma heat pump support
