# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/) and this project adheres to [Semantic Versioning](https://semver.org/).

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
