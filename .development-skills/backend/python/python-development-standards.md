---
title: Python Development Standards
inclusion: always
---

# Python Development Standards

## Code Style
- Follow PEP 8 style guide
- Use meaningful variable and function names
- Use snake_case for variables, functions, and files
- Use PascalCase for classes
- Use UPPER_SNAKE_CASE for constants
- Limit line length to 120 characters (configurable in Ruff)
- Use Ruff for linting and formatting (replaces Black, isort, flake8)
- Never create duplicate files with suffixes like `_fixed`, `_clean`, `_backup`, etc.
- Work iteratively on existing files (hooks handle commits automatically)

## Type Hints
- Use type hints for function parameters and return values
- Import types from `typing` module when needed
- Use `Optional` for nullable values
- Use `Union` for multiple possible types
- Use `TYPE_CHECKING` for type-only imports to avoid circular dependencies
- Use direct generic syntax `[T]` instead of `TypeVar` for Python 3.12+ (e.g., `def func[T](x: T) -> T:` instead of `T = TypeVar("T")`)

## Error Handling
- Organize exception handling in `src/utils/exceptions/` folder:
  - `error_codes.py` - Centralized error code constants (UPPER_SNAKE_CASE)
  - `exceptions.py` - Custom exception classes
  - `error_responses.py` - Pydantic models for standardized error responses
  - `__init__.py` - Export all exception-related items
- Create custom exception classes for domain-specific errors
- Use specific exception types, not generic Exception
- Handle exceptions at appropriate levels
- Use context managers (`with` statements) for resource management
- Log errors with appropriate detail and context (trace_id, path, error_code)
- Return standardized error responses with status codes and error codes
- Use try-except-finally blocks to ensure resource cleanup
- Mostly use f-strings for exception messages with contextual information
- Exception message pattern: `raise CustomException(f"Operation failed: {details}")`
- Include relevant identifiers in exception messages (session_id, user_id, etc.)
- Store error codes as constants in error_codes.py, not hardcoded strings

## Architecture Patterns
- Use layered architecture: Routes → Middleware → Services → Repository → Data Store
- Required folders under `src/`:
  - `src/routes/` - FastAPI route definitions with APIRouter (prefixed /v1)
  - `src/services/` - Business logic layer, orchestration, and dependency injection configuration
  - `src/repositories/` - Data access layer with SQLAlchemy ORM queries and CRUD operations
  - `src/repositories/schema/` - SQLAlchemy ORM model definitions mapped to database tables (extends Base)
  - `src/models/` - Pydantic request/response models, response builder, and standard response structures
  - `src/middleware/` - Request/response middleware (JWT auth middleware for protected routes)
  - `src/client/` - External API clients and SDK integrations (Cognito, S3, Secrets Manager, external APIs)
  - `src/utils/` - Shared utility functions (helpers, logger)
  - `src/utils/exceptions/` - Centralized error codes, custom exception classes, and error response models
  - `src/utils/logger.py` - Centralized logging configuration
- Required root-level folders:
  - `tests/` - Test files mirroring the src module structure
- Required files:
  - `src/__init__.py` - Root package init
  - `src/settings.py` - Application settings and constants
  - `main.py` - Application entry point
- Optional folders:
  - `src/prompt/` - AI agent prompt files
  - `src/resources/` - Static resources and templates
  - `src/migrations/` - Table creation and schema migration scripts
- Separate concerns: routes handle interface, middleware handles cross-cutting concerns, services contain business logic, repositories manage data
- Use dependency injection for testability and flexibility
- Place dependency injection configuration in `src/services/dependencies.py`
- Implement repository pattern for data access abstraction
- Each layer folder should have `__init__.py` to expose public APIs
- Follow communication rules: Presentation → Middleware → Service → Repository → Data Store (never skip layers)
- Centralize external API clients in `src/client/` for consistent integration patterns
- Keep domain-specific business rules separate from orchestration logic

## Code Organization
- Use virtual environments for dependencies (uv)
- Use pyproject.toml for modern Python project configuration
- Use uv for fast dependency management and builds
- Always include `[tool.hatch.build.targets.wheel]` with `packages = ["src"]` in pyproject.toml when using hatchling
- Organize code into modules and packages with clear separation of concerns
- Structure: `src/` is the root package containing all application code
- All imports must use the full src path: `from src.module.submodule import Class`
- Use `__init__.py` files to expose public APIs
- Keep files focused on single responsibilities
- Group related functionality into packages
- Keep configuration files at appropriate levels (project vs user)
- Organize code logically by feature or domain

## Configuration Management
- Use environment variables for configuration (never hardcode secrets)
- Use .env files for local development (with .env.sample as template)
- Use Jinja2 templates for dynamic configuration with environment variable substitution
- Load configuration from YAML files with environment variable interpolation
- Validate required environment variables at startup with helper functions
- Use Pydantic Settings for configuration validation
- Store constants in settings.py with descriptive names and documentation
- Define application constants as simple variables in settings.py using UPPER_SNAKE_CASE
- Place constants outside the Settings class for direct import and usage
- Group related constants with comments (e.g., "# MongoDB Collection Names", "# History Defaults")
- Import constants directly and never define constants locally in repository, service, or route files - centralize in settings.py
- Store AI system prompts in `src/prompt/` (optional folder for prompt files)
- Store static resources and templates in `src/resources/` (optional)
- Load prompts using utility functions from src/utils/ with proper error handling
- Use @lru_cache for settings singleton pattern

## Dependency Management
- Use latest stable versions of all libraries and dependencies
- Leverage Context7 MCP server to verify compatibility before adding dependencies
- Justify each new dependency with clear business or technical value
- Prefer well-maintained libraries with active communities
- Pin exact versions in pyproject.toml for production stability
- Use lock files (uv.lock) for reproducible builds
- Document version constraints and reasons for specific versions
- Use `requires-python` to specify minimum Python version
- Remove unused dependencies regularly

## Database Best Practices
- **ALWAYS use ORM instead of raw SQL queries** for data access
- Use SQLAlchemy ORM for type-safe database operations
- Define database models as SQLAlchemy declarative classes in `src/repositories/schema/`
- Use ORM query methods instead of raw SQL:
  - `session.query(Model).filter()` instead of `SELECT * FROM table WHERE ...`
  - `session.add(obj)` instead of `INSERT INTO ...`
  - `obj.field = value; session.commit()` instead of `UPDATE ...`
  - `session.delete(obj)` instead of `DELETE FROM ...`
- Configure connection pooling in SQLAlchemy engine creation
- Use database migrations with Alembic to manage schema changes
- Only use raw SQL queries (`text()` with proper parameterization) for:
  - Complex analytics queries that ORM cannot express efficiently
  - Database-specific features not supported by ORM

## Performance
- Use list comprehensions over loops when appropriate
- Use generators for large datasets to save memory
- Profile code before optimizing (don't guess)
- Use appropriate data structures (sets for membership, dicts for lookups)
- Use connection pooling for databases and external services
- Implement caching strategies (Redis, in-memory) where appropriate
- Use async/await for I/O-bound operations

## Pydantic Models
- Use Pydantic v2 for data validation and serialization
- Use `ConfigDict` for model configuration (replaces Config class)
- Use `Field()` only when necessary (validation, default_factory, or special configurations)
- Use docstrings under each attribute instead of `description` parameter in Field
- For simple defaults, use direct assignment (e.g., `status: str = "active"`)
- Use `Field(default_factory=...)` for mutable defaults (dict, list) or callable defaults (uuid4, datetime.utcnow)
- Implement factory methods for creating models from context (e.g., from_ctx)
- Use model_dump() and model_dump_json() for serialization
- Define clear model hierarchies (request, response, domain models)
- Use enums for status values and states

## Logging Best Practices
- Use centralized logging configuration from `src/utils/logger.py`
- Import logger: `from src.utils.logger import logger`
- Use JSON formatted structured logging for production environments
- Include contextual information in logs (trace_id, etc.) using extra fields
- Use appropriate log levels (debug, info, warning, error, critical)
- Log important state transitions and operations at INFO level
- Use logger.exception() for exceptions to include stack traces automatically
- Avoid logging sensitive information (tokens, passwords, PII)
- Configure third-party library loggers to reduce noise (httpx, motor, etc.)
- Centralized logger setup includes:
  - JSON formatter with timestamp, level, logger name, filename, line number, message
  - Automatic exception capture with type, message, and stacktrace
  - Support for custom fields (trace_id, etc.)

## Design Patterns
- Use Factory pattern for object creation
- Use Strategy pattern for interchangeable algorithms
- Use Repository pattern for data access abstraction
- Use Dependency Injection for loose coupling
- Use Builder pattern for complex object construction
- Use Registry pattern for plugin-like architectures
- Choose patterns that solve specific problems, not for the sake of patterns

## Resource Management
- Always close connections in finally blocks or use context managers
- Implement cleanup in lifespan context managers
- Use connection pooling for databases (MongoDB, Redis)
- Configure timeouts for external service calls
- Implement retry logic with exponential backoff
- Handle graceful shutdown with proper cleanup

## API Design
- Use versioned API endpoints (v1, v2)
- Return consistent response structures
- Use appropriate HTTP status codes
- Implement pagination for list endpoints
- Use query parameters for filtering and sorting
- Document APIs with OpenAPI/Swagger
- Implement request validation with Pydantic
- Use streaming responses (SSE) for long-running operations
- Create `src/routes/default.py` for standard endpoints:
  - `/` - Root endpoint returning app name and version
  - `/health` - Health check endpoint (liveness probe)
  - `/ready` - Readiness check endpoint (checks dependencies like database, cache)
- Keep main.py clean by registering all routes from route modules

## Async Programming
- Use async/await for I/O-bound operations
- Use asyncio for concurrent operations
- Configure asyncio_mode in pytest for async tests
- Use async context managers for resource management
- Avoid blocking operations in async functions
- Use asyncio.gather() for parallel async operations
- Make sure the library you're using supports async process. If not ask the user to know what to do next

## Testing and Validation
- ALWAYS generate test files after creating or modifying code
- Place all tests in `tests/` folder at root directory level (same level as `src/`)
  - Example: `src/services/agent_service.py` → `tests/services/test_agent_service.py`
  - Example: `src/utils/logger.py` → `tests/utils/test_logger.py`
  - Create `__init__.py` in test subdirectories matching source structure
- Test both success (pass) and failure (fail) scenarios for EVERY function
  - Success scenarios: Test expected behavior with valid inputs
  - Failure scenarios: Test error handling, edge cases, invalid inputs, exceptions
  - Boundary conditions: Test min/max values, empty inputs, None values
  - State transitions: Test all possible state changes
- Comprehensive test coverage requirements:
  - Each public function must have at least 2 test cases (pass + fail)
  - Each exception path must be tested
  - Each conditional branch must be covered
  - Mock all external dependencies (databases, APIs, file systems)
- Test file naming convention: `test_<module_name>.py`
- Test function naming: `test_<function_name>_<scenario>` (e.g., `test_create_session_success`, `test_create_session_invalid_data`)
- Use pytest fixtures for common setup and teardown
- Mock external dependencies (Redis, databases, APIs) using pytest fixtures and unittest.mock
- Verify error handling for custom exceptions with pytest.raises()
- Test state transitions and data persistence
- Use pytest-asyncio for async service and repository tests
- Use parametrize for testing multiple input scenarios
- Aim for >80% code coverage (verify with `make test-cov`)
- Run tests before committing changes
- Perform code reviews for all changes

## Documentation
- Maintain single comprehensive README covering all aspects including deployment
- Reference official sources through MCP servers when available
- Include relevant documentation links in code comments for complex logic
- Update documentation when upgrading dependencies
- Keep documentation close to relevant code
- Use inline comments for complex business logic only (avoid obvious comments)
- Document API endpoints and data structures
- Include setup and deployment instructions

## Version Control
- Commit frequently with meaningful messages
- Use feature branches for development
- Keep main branch deployable at all times
- Tag releases appropriately
- Use .gitignore to exclude generated files and secrets
- Avoid temporary or backup files in version control

## Makefile Automation
- Generate a Makefile for common development tasks with these targets:
  - `make setup` - Install development dependencies with uv
  - `make run` - Start the application (uv run main)
  - `make test` - Run pytest test suite (uv run pytest tests/)
  - `make test-cov` - Run tests with coverage report (coverage run -m pytest tests/, coverage xml, diff-cover)
  - `make lint` - Run Ruff linter (uv run ruff check src)
  - `make lint-fix` - Auto-fix linting issues (uv run ruff check --fix src)
  - `make format` - Format code with Ruff (uv run ruff format src)
  - `make check` - Run lint and format checks together
  - `make clean` - Remove cache files (__pycache__, .pytest_cache, .ruff_cache, .mypy_cache, htmlcov, coverage files)
  - `make help` - List all available commands with descriptions
- Use .PHONY declarations for all targets
- Keep commands simple with @echo statements for user feedback
- Use uv run prefix for all Python commands
- Clear screen before test-cov with @clear || cls for cross-platform support
- ALWAYS run these commands after generating code to verify everything works:
  1. `make setup` - Install dependencies
  2. `make lint` - Check code quality
  3. `make check` - Verify formatting
  4. `make test` - Run all tests
  5. `make test-cov` - Verify test coverage
  6. `make run` - Start the application to confirm it runs
- Show output from each command to confirm expected behavior and catch issues early