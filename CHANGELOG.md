# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
