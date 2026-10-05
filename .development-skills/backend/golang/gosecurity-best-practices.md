---
title: Go Security Best Practices
inclusion: always
---

# Security Best Practices

## Code Security
- Never hardcode secrets, API keys, or passwords — use environment variables
- Validate all user inputs before processing
- Use parameterized queries to prevent SQL injection
- Implement proper authentication and authorization
- Never log sensitive information (tokens, passwords, PII)

## Dependency Security
- Use dependency scanning tools (`govulncheck`, `nancy`)
- Review third-party packages before adding them
- Use `go.sum` for reproducible and verified builds

## Data Protection
- Encrypt sensitive data at rest and in transit
- Use HTTPS for all web communications
- Implement proper session management
- Use secure headers (HSTS, CSP, etc.)
- Follow OWASP guidelines

## Infrastructure Security
- Use least privilege principle for IAM roles and service accounts
- Enable logging and monitoring
- Use network segmentation
- Implement proper backup strategies
- Conduct regular security audits and penetration testing

## Development Practices
- Use static code analysis tools (`gosec`, `golangci-lint`)
- Implement security testing in CI/CD pipelines
- Include security checks in code reviews
- Maintain incident response procedures