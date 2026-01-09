# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
