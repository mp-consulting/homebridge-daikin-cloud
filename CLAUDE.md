# Claude Code Settings

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

### Examples
- `feat(api): add device capability detection`
- `fix(service): resolve temperature validation warning`
- `chore: update dependencies`
- `refactor(features): extract feature modules from service`
