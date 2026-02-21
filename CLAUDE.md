# Claude Code Settings

## Project Overview

This is a Homebridge plugin for Daikin Cloud (Onecta) integration that allows controlling Daikin air conditioning units through Apple HomeKit. The plugin supports both Developer Portal and Mobile App authentication methods.

**Key Technologies:**
- TypeScript (target: ESNext)
- Homebridge Plugin API
- HAP-nodejs (HomeKit Accessory Protocol)
- Jest for testing
- ESLint for code quality

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
- `test(utils): add comprehensive StructuredLogger tests`

## Code Style Guidelines

### TypeScript & Code Quality

1. **Indentation**: Use 4 spaces (enforced by ESLint)
2. **Quotes**: Use single quotes for strings
3. **Semicolons**: Optional but should be consistent
4. **Trailing commas**: Required in multiline objects/arrays
5. **Type safety**:
   - `strict: true` in tsconfig
   - `noImplicitAny: false` (be mindful of types)
   - Prefer explicit types for public APIs

### ESLint Rules
The project uses `@typescript-eslint` with custom rules:
- No `console.log` - use Homebridge logger instead
- Prefer arrow callbacks
- Always use curly braces
- Enforce comma spacing
- No trailing spaces

### File Organization

```
src/
├── accessories/          # HAP accessories (air-conditioning, altherma)
├── api/                  # Daikin API clients (OAuth, WebSocket, repository)
├── config/               # Configuration management
├── constants/            # Shared constants (API, auth, device, time)
├── device/               # Device profiles and capability detection
├── di/                   # Dependency injection (service container)
├── features/             # Feature modules (modes as switches)
├── services/             # HAP services (climate control, hot water)
├── types/                # TypeScript type definitions
├── utils/                # Utility functions (logging, error handling)
├── index.ts             # Plugin entry point
├── platform.ts          # Main platform class
└── settings.ts          # Plugin settings
```

### Test Organization

```
test/
├── fixtures/            # Test data (device responses)
├── mocks/               # Mock objects for testing
├── helpers/             # Test utilities
├── unit/                # Unit tests
│   ├── api/
│   ├── device/
│   ├── services/
│   └── utils/
└── integration/         # Integration tests
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

# Run tests
npm test

# Update test snapshots
npm run test:updateSnapshots

# Development with auto-rebuild
npm run watch
```

### Testing Guidelines

1. **Write tests for new features**: All new functionality should include unit tests
2. **Update snapshots carefully**: Review snapshot changes before committing
3. **Use fixtures**: Add device response fixtures in `test/fixtures/` for new device types
4. **Mock external dependencies**: Use mocks from `test/mocks/` for API calls
5. **Test coverage**: Aim for good coverage, especially for API and service layers

### Common Development Tasks

#### Adding a New Feature Mode

1. Create feature class in `src/features/modes/`
2. Extend `BaseFeature` class
3. Register in feature registry
4. Add configuration option in settings
5. Add tests in `test/unit/features/`
6. Update documentation

#### Adding Device Support

1. Add device response fixture in `test/fixtures/`
2. Update capability detector if needed
3. Create/update device profile in `src/device/profiles/`
4. Add integration test
5. Document in [README.md](README.md)

#### Fixing API Issues

1. Check error handling in `src/utils/error-handler.ts`
2. Review rate limiting in `src/api/daikin-cloud.repository.ts`
3. Update retry logic if needed
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
- `homebridge-ui/` directory contains custom UI
- Config schema defined in `package.json`
- Validation in [src/config/config-manager.ts](src/config/config-manager.ts)

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

- Implemented in [daikin-cloud.repository.ts](src/api/daikin-cloud.repository.ts)
- Exponential backoff for retries
- Gateway timeout handling (502, 503, 504)

### WebSocket Support

- Only available in Mobile App mode
- Real-time device state updates
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

The codebase uses structured logging:
- Check [log-context.ts](src/utils/log-context.ts) for log formatting
- Error handling in [error-handler.ts](src/utils/error-handler.ts)

## Release Process

1. Update version in [package.json](package.json)
2. Update [README.md](README.md) if needed
3. Run tests: `npm test`
4. Build: `npm run build`
5. Commit with version bump: `chore: bump version to X.Y.Z`
6. Tag release: `git tag vX.Y.Z`
7. Push: `git push && git push --tags`
8. Publish: `npm run release` (or `npm run release:beta`)

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
- Use dependency injection via service container
- Handle errors gracefully with user-friendly messages
- Consider API rate limits in all API calls
