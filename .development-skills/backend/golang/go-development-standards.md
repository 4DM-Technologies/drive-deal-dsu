---
title: Go Development Standards
inclusion: always
---

# Go Development Standards

## Code Style
- Use `camelCase` for unexported identifiers, `PascalCase` for exported ones
- Use `PascalCase` for exported constants, `camelCase` for unexported
- Limit line length to 120 characters
- Use `gofmt` and `goimports` for formatting (enforced via golangci-lint)
- Use Go doc comments for all exported functions, types, and packages

## Type System and Interfaces
- Define interfaces in the same package that consumes them, not where they are implemented
- Keep interfaces small and focused (prefer single-method or minimal interfaces)
- Use `any` instead of `interface{}` for Go 1.18+
- Use struct embedding for composition
- Define handler, service, and repository interfaces explicitly for testability
- Return the interface type from constructor functions, not the concrete type

## Error Handling
- Centralize error codes in a dedicated package using typed constants
- Map error codes to human-readable string codes
- Use a domain-specific error type as the return type for repository methods — not Go's raw `error` interface
- Use a shared response type as the return type for service methods
- Use `fmt.Errorf("context: %w", err)` for wrapping standard Go errors
- Log errors before returning error responses — never swallow errors silently
- Include relevant identifiers in error messages (e.g., record ID, operation name)
- Never ignore errors with `_` unless intentional and commented

## Architecture Patterns
- Use layered architecture: Router → Handlers → Services → Repository → Data Store
- Separate concerns: handlers manage HTTP interface, services contain business logic, repositories manage data
- Use constructor functions with dependency injection for all layers
- Never skip layers in communication: Router → Handler → Service → Repository → Data Store
- Apply appropriate design patterns based on use case (Factory, Strategy, Repository, etc.)
- Choose design patterns that solve specific problems, not for the sake of patterns themselves

## Project Structure

Follow the **CMD / Internal / PKG** clean architecture pattern.

**Required files:** `cmd/server/main.go`, `go.mod`, `go.sum`, `README.md`

**Optional folders:** `tests/integration/`, `docs/`, `migrations/`

- Organize application code under `internal/` by layer:
  - `config/` — configuration loading and environment validation
  - `dtos/` — request/response DTOs and shared types
  - `errorcodes/` — centralized error code definitions
  - `handlers/` — HTTP handlers and route setup
  - `loggers/` — logger implementation
  - `middleware/` — HTTP middleware (auth, logging, rate limiting)
  - `models/` — domain models and ORM entity structs
  - `repository/` — data access layer
  - `responses/` — shared response helper functions and response writing utilities
  - `services/` — business logic and orchestration
  - `utils/` — general utility functions and helpers
  - `validation/` — input validation logic and reusable validators
- Place reusable infrastructure packages under `pkg/`:
  - `database/` — database connection setup and migrations runner
  - `server/` — HTTP server setup, CORS, and application bootstrap
- Keep the entry point (`cmd/server/main.go`) minimal — parse flags, initialize app, start server
- Place unit tests in `tests/unit/` mirroring the `internal/` and `pkg/` structure
- Place integration tests in `tests/integration/` (optional)

## File Management
- Maintain clean directory structures following the `cmd/`, `internal/`, `pkg/`, `tests/` layout
- Use consistent naming conventions: `snake_case` for files, `PascalCase` for exported types
- Avoid temporary or backup files in version control (no `_fixed`, `_clean`, `_backup` suffixes)
- Organize code logically by layer and domain
- Keep configuration files at appropriate levels (project root for `.env.*`, `internal/config/` for Go config)
- Use Go modules (`go.mod`) for dependency management
- Use `internal/` to restrict package visibility to the module
- Use `pkg/` for packages shared across the application
- All imports must use the full module path

## Configuration Management
- Load environment variables from `.env` files using a library like `godotenv`
- Define a `Config` struct with all application settings
- Use a `LoadConfig` constructor that validates required fields at startup
- Use a `getEnv` helper for reading env vars with fallback defaults
- Validate required environment variables at startup — return an error if any are missing
- Never hardcode secrets or environment-specific values in source code

## DTOs and Response Structures
- Define all request/response structs in a dedicated `dtos/` package
- Use a shared `APIResponse` type with consistent fields across all endpoints
- Use `json:"field,omitempty"` for optional fields
- Use struct validation tags on request structs for input validation
- Define domain-specific DTOs in separate files per domain
- Centralize response helper functions in `internal/responses/`

## Logging
- Use a custom logger struct with dependency injection
- Implement methods for all log levels: Info, Error, Warn, Fatal
- Pass logger via dependency injection to all handlers, services, and repositories
- Log at entry and exit of key operations with descriptive messages
- Always log errors before returning them — never swallow errors silently
- Avoid logging sensitive information (tokens, passwords, PII, private keys)

## Performance
- Use goroutines for concurrent I/O-bound operations
- Always pass `context.Context` as the first parameter for all service and repository methods
- Use `context.WithTimeout` for external service calls
- Use connection pooling for database access
- Profile with `pprof` before optimizing

## API Design
- Use versioned API route groups (e.g., `/api/v1/...`)
- Return consistent `APIResponse` JSON for all endpoints
- Use appropriate HTTP status codes (200, 201, 400, 404, 422, 500)
- Implement pagination via a `Meta` struct with page, page size, and total fields
- Document APIs with OpenAPI/Swagger
- Implement request validation with struct tags
- Always implement `GET /health` for liveness probes

## Dependency Management
- Use latest stable versions of all libraries and dependencies
- Pin versions in `go.mod` for production stability
- Use `go.sum` for reproducible builds and consistent installations across environments
- Run `go mod tidy` to remove unused dependencies
- Specify minimum Go version in `go.mod`
- Leverage Context7 MCP server to verify compatibility before adding dependencies
- Justify each new dependency with clear business or technical value
- Prefer well-maintained libraries with active communities

## Documentation
- Maintain a single comprehensive `README.md` covering setup, running, testing, and deployment
- Reference official sources through MCP servers when available
- Update documentation when upgrading dependencies
- Document API endpoints in `docs/openapi.yaml` (optional) and serve via Swagger UI
- Include setup and deployment instructions in README

## Version Control
- Commit frequently with meaningful messages
- Use feature branches for development
- Keep main branch deployable at all times
- Tag releases appropriately
- Use `.gitignore` to exclude generated files, binaries, and secrets (`.env.*`, `bin/`, `*.exe`, `coverage.out`)
- Work iteratively on existing files — never create duplicate files with suffixes like `_fixed`, `_clean`, `_backup`

## Code Quality
- Follow Go language idioms and effective Go guidelines
- Use meaningful variable and function names
- Keep functions small and focused on single responsibilities
- Implement proper error handling and logging at every layer
- Store constant values in variables with descriptive names (avoid magic numbers/strings)
- Perform code reviews for all changes

## Quality Assurance
- Write tests for new functionality
- Run the test suite before committing changes
- Use `golangci-lint` for linting; run `gofmt` and `goimports` for formatting
- Monitor code coverage and maintain >80%
- Run tests with `-race` flag to detect race conditions

## CI/CD and Containerization
- Use a multi-stage `Dockerfile`: build stage compiles the binary, runtime stage uses a minimal base image
- Use `.dockerignore` to exclude tests, docs, and secrets from the Docker image
- Define CI/CD workflows covering lint, test (with `-race`), and build
- Inject secrets via CI/CD environment variables — never commit secrets

## Makefile Automation
- Define standard targets: `setup`, `run`, `build`, `test`, `test-cov`, `lint`, `fmt`, `check`, `clean`, `help`
- Use `.PHONY` declarations for all targets
- After generating code, always run: `make setup` → `make fmt` → `make lint` → `make test` → `make test-cov` → `make run`