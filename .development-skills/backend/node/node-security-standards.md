---
title: Node Security Best Practices
inclusion: always
---

# Security Best Practices

## Code Security
- Never hardcode secrets, API keys, or passwords — use environment variables
- Validate all user inputs before processing
- Use parameterized queries via ORM to prevent SQL injection — never concatenate raw SQL strings
- Implement proper authentication middleware that validates tokens before reaching handlers
- Never log sensitive information (tokens, passwords, PII, private keys)
- Use security headers middleware (HSTS, X-Frame-Options, CSP, etc.)
- Sanitize error messages returned to clients — never expose stack traces or internal details

## Input Validation
- Validate all request bodies, path parameters, and query parameters before processing
- Reject requests with unexpected fields to prevent mass assignment
- Return structured validation errors with field-level detail
- Apply safe defaults and cap unbounded inputs 

## Authentication and Authorization
- Use short-lived access tokens and rotate refresh tokens on each use
- Store secrets in environment variables — never in source code
- Implement role-based access control at the middleware or service layer

## Password Security
- Never store plaintext passwords — always hash with a strong algorithm (bcrypt, argon2)
- Enforce minimum password length and complexity via validation
- Never return password hashes in API responses

## Dependency Security
- Run dependency vulnerability scans regularly (e.g., `npm audit`)
- Pin exact versions for production stability
- Review third-party packages before adding them
- Use lock files for reproducible and verified builds
- Remove unused dependencies regularly

## Data Protection
- Encrypt sensitive data at rest and in transit
- Use HTTPS for all external communications — enforce TLS in production
- Implement proper session management — invalidate sessions on logout
- Follow OWASP Top 10 guidelines
- Mask or redact PII in logs

## Infrastructure Security
- Use least privilege principle for database users and service accounts
- Configure CORS explicitly — avoid wildcard origins in production
- Implement rate limiting to prevent brute-force and DoS attacks
- Set request body size limits to prevent payload attacks
- Inject secrets via CI/CD environment variables — never commit secret files

## Development Practices
- Use static analysis and linting tools to catch security anti-patterns
- Include security checks in CI/CD pipelines
- Perform security-focused code reviews for authentication and data access changes
- Maintain incident response procedures for credential leaks and data breaches
