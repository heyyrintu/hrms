# Contributing to HRMS

Thank you for your interest in contributing to HRMS! This guide will help you get started.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Follow the setup instructions in the [Developer Guide](docs/developer-guide.md)
4. Create a new branch for your changes

## Branch Naming

Use descriptive branch names with prefixes:

- `feature/` — New functionality (e.g., `feature/employee-import`)
- `fix/` — Bug fixes (e.g., `fix/login-tenant-validation`)
- `docs/` — Documentation changes (e.g., `docs/api-examples`)
- `refactor/` — Code refactoring (e.g., `refactor/attendance-service`)
- `test/` — Test additions or fixes (e.g., `test/payroll-edge-cases`)

## Commit Messages

Write clear, concise commit messages:

```
<type>: <short description>

<optional body with more details>
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

Examples:
```
feat: add bulk employee import endpoint
fix: correct leave balance calculation for partial days
docs: update API endpoint reference for payroll module
test: add edge case tests for OT calculation
```

## Pull Request Process

1. Ensure your branch is up to date with `main`
2. Run all tests and verify they pass:
   ```bash
   cd backend && npm test
   cd frontend && npm test
   ```
3. Run the linter:
   ```bash
   cd backend && npm run lint
   cd frontend && npm run lint
   ```
4. Create a pull request with:
   - Clear title describing the change
   - Description of what was changed and why
   - Reference to any related issues
5. Wait for code review before merging

## Code Style

- **Backend**: Follow existing NestJS patterns (module → controller → service → DTO)
- **Frontend**: Follow existing Next.js App Router patterns
- **TypeScript**: Use strict types, avoid `any`
- **Formatting**: Prettier handles formatting — run `npm run format` in the backend
- **Linting**: ESLint catches issues — run `npm run lint`

## Testing Requirements

All changes must maintain the existing test suite:

- **Backend**: 823 tests must pass (`cd backend && npm test`)
- **Frontend**: 255 tests must pass (`cd frontend && npm test`)
- New features should include tests
- Bug fixes should include regression tests

## Adding Swagger Documentation

When adding or modifying API endpoints:

1. Add `@ApiTags('module-name')` to the controller class
2. Add `@ApiOperation({ summary: '...' })` to each method
3. Add `@ApiResponse({ status: ..., description: '...' })` for each response code
4. Add `@ApiProperty()` / `@ApiPropertyOptional()` to DTO fields
5. Register the tag in `backend/src/main.ts` if it's a new module

## Questions?

If you have questions about contributing, please open an issue in the repository.
