---
title: Node Development Standards for Rac
inclusion: always
---

# Node.js / TypeScript Development Standards

## Code Style
- Follow the Airbnb TypeScript style guide
- Use `camelCase` for variables and functions, `PascalCase` for classes and interfaces, `UPPER_SNAKE_CASE` for constants
- Limit line length to 120 characters
- Use Prettier for formatting and ESLint with `@typescript-eslint` for linting
- Use JSDoc comments (`/** ... */`) for all exported functions, classes, and interfaces

## Type System
- Enable `strict` mode in `tsconfig.json`
- Prefer `interface` over `type` for object shapes; use `type` for unions and intersections
- Avoid `any` — use `unknown` and narrow with type guards
- Use generics to write reusable, type-safe utilities
- Define explicit return types on all exported functions
- Use `readonly` for properties that should not be mutated

## Error Handling
- Centralize error codes in a dedicated file using a TypeScript `enum`
- Map error codes to human-readable string codes and HTTP status codes
- Use a domain-specific error type for repository and service errors
- Use `try/catch` with typed errors in all async functions
- Log errors before returning error responses — never swallow errors silently
- Include relevant identifiers in error messages (e.g., record ID, operation name)
- Store error codes as constants — never hardcode error strings inline

## Architecture Patterns
- Use layered architecture: Router → Handlers → Services → Repository → Data Store
- Separate concerns: handlers manage HTTP interface, services contain business logic, repositories manage data
- Use dependency injection for all layers — pass dependencies via constructor or factory function parameters
- Never skip layers in communication: Router → Handler → Service → Repository → Data Store
- Apply appropriate design patterns based on use case (Factory, Strategy, Repository, etc.)
- Choose design patterns that solve specific problems, not for the sake of patterns themselves

## File Management
- Use consistent naming conventions: `kebab-case` for files, `PascalCase` for classes and interfaces, `camelCase` for variables and functions
- Avoid temporary or backup files in version control (no `_fixed`, `_clean`, `_backup` suffixes)
- Organize code logically by layer and domain
- Keep configuration files at appropriate levels (project root for `.env.*`, dedicated config module for app config)
- Use TypeScript path aliases in `tsconfig.json` to avoid deep relative imports
- Keep files focused on single responsibilities
- Group related functionality into packages with clear public APIs

## Configuration Management
- Use `dotenv` to load environment variables from `.env` files
- Define a `Config` interface with all application settings
- Use a `loadConfig()` factory function to build and validate the config at startup
- Use helper functions (`getEnv`, `getEnvNumber`, `getEnvBoolean`) for reading env vars with defaults
- Validate required environment variables at startup — throw a descriptive error if any are missing
- Never hardcode secrets or environment-specific values in source code

## DTOs and Response Structures
- Define all request/response interfaces in a dedicated `dtos/` folder
- Use a shared `ApiResponse<T>` type with consistent fields
- Provide typed response builder functions for all common response types (success, created, error, not found, conflict, paginated, etc.)
- Use optional `?` for nullable fields
- Define domain-specific request/response DTOs in separate files per domain
- Use a `RepositoryResult<T>` wrapper type as the return type for all repository methods
- Use `ApiResponse<T>` as the return type for all service methods

## Logging
- Use a structured logger (e.g., `pino`) with JSON output for production environments
- Initialize the logger as a singleton and retrieve it via a `getLogger()` function
- Support structured context via a `logger.with(context)` method that returns a child logger
- Include `requestId`, `layer`, and `method` in every log entry for traceability
- Implement file rotation with a configurable max file size
- Pass the logger via dependency injection to all handlers, services, and repositories
- Always log errors before returning them — never swallow errors silently
- Avoid logging sensitive information (tokens, passwords, PII, private keys)

## Validation
- Use JSON Schema-based validation (e.g., AJV) — compile schemas once at module load and reuse
- Validate path parameters (e.g., UUID format) before passing to the service layer
- Validate and sanitize query parameters with safe defaults
- Cap pagination page size at a maximum value in the service layer

## Middleware
- Register all global middleware before route setup
- Implement request ID middleware — assign from incoming header or generate a new UUID
- Implement logging middleware — log incoming request and response completion with duration
- Implement a catch-all not-found handler for unmatched routes
- Extend the Express `Request` type to include custom properties (e.g., `requestId`, `startTime`)

## Performance
- Use `async/await` for all I/O-bound operations
- Use connection pooling for database connections
- Use `Promise.all` for independent concurrent async operations
- Set request timeouts on external HTTP calls
- Profile with Node.js built-in tools before optimizing

## API Design
- Use versioned API route groups
- Return consistent `ApiResponse<T>` JSON for all endpoints
- Use appropriate HTTP status codes
- Document APIs with OpenAPI/Swagger and serve via Swagger UI
- Always implement a `GET /health` endpoint for liveness probes
- Centralize all route registration in a single `setupRoutes` function

## Dependency Management
- Use latest stable versions of all libraries and dependencies
- Pin versions in `package.json` for production stability
- Use `package-lock.json` for reproducible builds and consistent installations across environments
- Run `npm ci` in CI environments
- Separate `dependencies` from `devDependencies` strictly
- Leverage Context7 MCP server to verify compatibility before adding dependencies
- Justify each new dependency with clear business or technical value
- Prefer well-maintained libraries with active communities
- Remove unused dependencies regularly

## Documentation
- Maintain a single comprehensive `README.md` covering setup, running, testing, and deployment
- Reference official sources through MCP servers when available
- Update documentation when upgrading dependencies
- Include setup and deployment instructions in README

## Version Control
- Commit frequently with meaningful messages
- Use feature branches for development
- Keep main branch deployable at all times
- Tag releases appropriately
- Use `.gitignore` to exclude `node_modules/`, `dist/`, `.env.*`, `coverage/`
- Work iteratively on existing files — never create duplicate files with suffixes like `_fixed`, `_clean`, `_backup`

## Code Quality
- Follow language idioms and style guides
- Use meaningful variable and function names
- Keep functions small and focused on single responsibilities
- Implement proper error handling and logging at every layer
- Store constant values in variables with descriptive names (avoid magic numbers/strings)
- Perform code reviews for all changes

## Quality Assurance
- Write tests for new functionality
- Run the test suite before committing changes
- Use ESLint and Prettier for linting and formatting
- Monitor code coverage and maintain >80%

## CI/CD and Containerization
- Use a multi-stage `Dockerfile`: build stage compiles TypeScript, runtime stage uses a minimal `node:alpine` image
- Use `.dockerignore` to exclude source files, tests, and secrets from the Docker image
- Define CI/CD workflows covering lint, test with coverage, and build
- Inject secrets via CI/CD environment variables — never commit secrets

## NPM Script Automation
- Define standard scripts in `package.json`:
  - `build` — compile TypeScript
  - `start` — run compiled output
  - `dev` — run with `ts-node` for local development
  - `test` — run Jest test suite
  - `test:cov` — run Jest with coverage report
  - `lint` — run ESLint
  - `lint:fix` — auto-fix lint issues
  - `format` — run Prettier
- After generating code, always run: `npm install` → `npm run format` → `npm run lint` → `npm run build` → `npm run test` → `npm run test:cov`
