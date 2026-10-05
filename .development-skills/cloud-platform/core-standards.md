---
title: Core Infrastructure Standards
description: Consolidated Terraform, security, and development standards for all infrastructure projects
inclusion: always
---

# Core Infrastructure Standards

This document consolidates Terraform, security, and development standards for all infrastructure projects.

---

# Part 1: Terraform & Infrastructure as Code Standards

## Code Organization & Structure

### Module Hierarchy
- Create reusable modules for common patterns (VPC, ECS, RDS, etc.)
- Keep root modules environment-specific (dev, staging, prod)
- Limit module nesting to 2-3 levels maximum
- Use clear boundaries: networking, compute, data, security
- Organize modules by logical infrastructure domains, not by cloud provider services

### Folder Structure
- Standard pattern for all projects:
  ```
  terraform/
  ├── environments/
  │   ├── dev/
  │   ├── staging/
  │   └── prod/
  ├── modules/
  │   ├── networking/
  │   ├── compute/
  │   ├── database/
  │   └── security/
  ├── global/
  │   └── iam/
  └── shared/
      └── backend.tf
  ```
- Each environment folder contains: main.tf, variables.tf, outputs.tf, terraform.tfvars
- Keep backend configuration in shared/backend.tf and reference it

### Repository Strategy
- Use mono-repo for related infrastructure (same product/service)
- Split repos by major boundaries: platform, applications, data
- Never mix different cloud providers in same repo
- Use separate repos for different compliance zones (PCI, HIPAA, etc.)

### Module Versioning
- Version all reusable modules using Git tags (v1.0.0, v1.1.0)
- Pin module versions in production: `source = "git::https://...?ref=v1.2.0"`
- Use version constraints for non-prod: `version = "~> 1.2"`
- Document breaking changes in module CHANGELOG.md
- Test module updates in dev before promoting to prod

## Variable & Configuration Management

### Variable Organization
- Group variables by purpose in variables.tf with clear sections
- Use consistent naming: `<resource>_<property>` (e.g., `vpc_cidr_block`)
- Provide descriptions for ALL variables
- Define sensible defaults for non-sensitive, non-environment-specific values
- Use type constraints: `string`, `number`, `bool`, `list(string)`, `map(string)`, `object({})`

### Variable Precedence
- Understand the order: CLI flags > *.auto.tfvars > terraform.tfvars > environment variables > defaults
- Use terraform.tfvars for environment-specific values
- Use environment variables (TF_VAR_*) for CI/CD pipelines
- Never rely on defaults for critical configuration

### Sensitive Data Management
- Mark sensitive variables: `sensitive = true`
- Store secrets in AWS Secrets Manager, Azure Key Vault, or HashiCorp Vault
- Use data sources to fetch secrets at runtime
- Never commit .tfvars files with secrets (use .tfvars.example templates)
- Use encrypted S3 buckets for state files with KMS
- Enable state file encryption in backend configuration

### Environment Configuration
- Use workspaces OR separate directories (prefer directories for clarity)
- Create environment-specific .tfvars files: dev.tfvars, staging.tfvars, prod.tfvars
- Use locals for environment-specific logic:
  ```hcl
  locals {
    environment_config = {
      dev     = { instance_type = "t3.small", count = 1 }
      staging = { instance_type = "t3.medium", count = 2 }
      prod    = { instance_type = "t3.large", count = 3 }
    }
    config = local.environment_config[var.environment]
  }
  ```

### Type Constraints
- Use complex types for structured data:
  ```hcl
  variable "vpc_config" {
    type = object({
      cidr_block           = string
      enable_dns_hostnames = bool
      availability_zones   = list(string)
      private_subnets      = list(string)
      public_subnets       = list(string)
    })
  }
  ```
- Validate inputs with validation blocks:
  ```hcl
  variable "environment" {
    type = string
    validation {
      condition     = contains(["dev", "staging", "prod"], var.environment)
      error_message = "Environment must be dev, staging, or prod."
    }
  }
  ```

## DRY Principles & Hard-Coded Values

### Eliminate Hard-Coding
- Use variables for ALL environment-specific values
- Use data sources for dynamic lookups (AMIs, availability zones)
- Use locals for computed values and repeated expressions
- Parameterize resource names with naming conventions:
  ```hcl
  locals {
    # INTERNAL project naming: zeb-<project>-<resource>-<purpose>-<env>
    # EXTERNAL project naming: <user-provided-convention>
    name_prefix = "zeb-${var.project_name}"
    common_tags = {
      app           = var.project_name
      env           = var.environment
      Category      = var.environment
      business-unit = var.business_unit
      owner         = var.owner_email
      expire-date   = var.expire_date
      ManagedBy     = "Terraform"
    }
  }
  ```

### Repeated Configuration
- Use dynamic blocks for repeated nested blocks:
  ```hcl
  dynamic "ingress" {
    for_each = var.ingress_rules
    content {
      from_port   = ingress.value.from_port
      to_port     = ingress.value.to_port
      protocol    = ingress.value.protocol
      cidr_blocks = ingress.value.cidr_blocks
    }
  }
  ```
- Create modules for repeated resource patterns
- Use for_each or count for multiple similar resources
- **CRITICAL**: `count` and `for_each` MUST only depend on values known at plan time (variables, locals from variables, static values). NEVER use module outputs, resource attributes, or data source results — these cause "Invalid count argument" errors.

### Magic Numbers
- Define constants in locals with descriptive names:
  ```hcl
  locals {
    http_port       = 80
    https_port      = 443
    ssh_port        = 22
    any_protocol    = "-1"
    tcp_protocol    = "tcp"
    all_ips         = "0.0.0.0/0"
    health_check_interval = 30
    health_check_timeout  = 5
  }
  ```

### Locals Best Practices
- Use locals for computed values, not simple pass-throughs
- Group related locals together with comments
- Keep locals readable - break complex expressions into multiple locals
- Use locals for conditional logic to keep resources clean

## State Management

### Remote State Configuration
- ALWAYS use remote state (S3, Azure Storage, Terraform Cloud)
- Enable state locking (`use_lockfile = true` for S3, native for others)
- Encrypt state files at rest and in transit
- Use separate state files per environment
- Configure backend in separate backend.tf file:
  ```hcl
  terraform {
    backend "s3" {
      bucket       = "company-terraform-state"
      key          = "project/environment/terraform.tfstate"
      region       = "us-east-1"
      encrypt      = true
      use_lockfile = true
    }
  }
  ```
- NOTE: `dynamodb_table` is DEPRECATED. Use `use_lockfile = true` instead.

### State File Management
- Implement state file backups (S3 versioning)
- Use state locking to prevent concurrent modifications
- Split large state files by logical boundaries (networking, compute, data)
- Use `terraform state mv` for refactoring without recreation
- Regular state file cleanup: remove orphaned resources

### Workspace Strategy
- Use workspaces for similar environments with identical structure
- Prefer separate directories for environments with different configurations
- Never use default workspace in production
- Document workspace naming conventions

### Drift Detection
- Run `terraform plan` regularly to detect drift
- Use automated drift detection tools (Terraform Cloud, Spacelift)
- Investigate and document intentional out-of-band changes
- Use `terraform refresh` cautiously - prefer plan to see changes first

## Dependency & Ordering

### Explicit Dependencies
- Let Terraform infer dependencies through resource references
- Use `depends_on` only when implicit dependencies don't work
- Document why `depends_on` is needed with comments
- Avoid circular dependencies by restructuring modules

### Cross-Stack References
- Use remote state data sources for cross-stack dependencies:
  ```hcl
  data "terraform_remote_state" "networking" {
    backend = "s3"
    config = {
      bucket = "company-terraform-state"
      key    = "networking/prod/terraform.tfstate"
      region = "us-east-1"
    }
  }
  ```
- Minimize cross-stack dependencies to reduce coupling
- Use SSM Parameter Store or similar for loose coupling

### Resource Timing
- Account for eventual consistency (IAM, DNS)
- Use `time_sleep` resource for necessary delays
- Implement retry logic in custom resources
- Use `create_before_destroy` lifecycle for zero-downtime updates

## Provider & Version Management

### Version Pinning
- Use `>=` for `required_version` to allow flexibility across environments:
  ```hcl
  terraform {
    required_version = ">= 1.6.0"
    required_providers {
      aws = {
        source  = "hashicorp/aws"
        version = "~> 5.0"
      }
    }
  }
  ```
- Use `>=` for Terraform required_version (not `~>` which is too restrictive)
- Use `~>` for provider version constraints to allow minor updates
- Test provider upgrades in dev before prod
- Document version upgrade procedures

### Multi-Provider Configuration
- Use provider aliases for multi-region deployments:
  ```hcl
  provider "aws" {
    alias  = "us-east-1"
    region = "us-east-1"
  }

  provider "aws" {
    alias  = "us-west-2"
    region = "us-west-2"
  }
  ```
- Pass providers explicitly to modules when using aliases
- Document provider configuration requirements in module README

## Testing & Validation

### Pre-Deployment Validation
- Run `terraform fmt` before committing
- Run `terraform validate` in CI/CD pipeline
- Use `terraform plan` to review changes before apply
- Implement policy-as-code (OPA, Sentinel, Checkov)
- Use tflint for additional linting

### Automated Testing
- Use Terratest for integration testing
- Test modules in isolation before integration
- Implement smoke tests for critical resources
- Use kitchen-terraform for infrastructure testing
- Test disaster recovery procedures

### Plan Review
- Use `terraform plan -out=plan.tfplan` to save plans
- Review plan output for unexpected changes
- Use `terraform show -json plan.tfplan` for programmatic analysis
- Implement plan approval workflows for production

### Blast Radius Management
- Split infrastructure into smaller state files
- Use targeted applies when appropriate: `terraform apply -target=resource`
- Implement progressive rollouts for large changes
- Maintain rollback plans for critical changes

## Naming Conventions

### Project Type: Internal vs External

Before generating any infrastructure, the agent MUST ask the user:

> **Is this an internal or external project?**

#### Internal Projects (zeb.co)
Internal projects follow a strict naming convention and mandatory tag set.

**Naming Convention**: `zeb-<project>-<resource>-<purpose>-<environment>`
- `<project>`: The project name (e.g., `myapp`, `rideshare`, `paymentgateway`)
- `<resource>`: The AWS resource type (e.g., `s3`, `rds`, `ecs`, `vpc`, `alb`, `ec2`)
- `<purpose>`: The purpose or role of the resource (e.g., `frontend`, `postgres`, `cluster`, `main`, `bastion`)
- `<environment>`: The environment (e.g., `dev`, `staging`, `prod`)
- Examples: `zeb-myapp-s3-frontend-dev`, `zeb-myapp-rds-postgres-prod`, `zeb-myapp-ecs-cluster-dev`, `zeb-myapp-vpc-main-prod`

**Mandatory Tags for Internal Projects**:
```hcl
locals {
  common_tags = {
    app           = var.project_name
    env           = var.environment
    Category      = var.environment
    business-unit = var.business_unit
    owner         = var.owner_email   # Must be @zeb.co email
    expire-date   = var.expire_date   # Format: dd/mm/yyyy
    ManagedBy     = "Terraform"
  }
}
```

The agent MUST collect the following from the user for internal projects:
- `project_name`
- `business_unit`
- `owner_email` (must be `@zeb.co`)
- `expire_date` (format: `dd/mm/yyyy`)
- `environment`

#### External Projects
For external projects, the agent MUST ask the user to provide:
- Their preferred naming convention pattern
- Their required tags (key-value pairs)

The agent should use whatever the user provides and apply it consistently across all resources.

### Resource Naming (General)
- Use consistent pattern based on project type (see above)
- Use lowercase with hyphens (kebab-case)
- Keep names under 64 characters
- Make names descriptive but concise

### Variable Naming
- Use snake_case for variables: `vpc_cidr_block`, `instance_type`
- Prefix boolean variables with `enable_` or `is_`: `enable_monitoring`, `is_public`
- Use plural for lists: `availability_zones`, `subnet_ids`
- Use descriptive names that indicate purpose

### Tag Standards
- Required tags for all resources:
  ```hcl
  tags = merge(
    local.common_tags,
    {
      Name        = "resource-specific-name"
      Description = "Resource purpose"
    }
  )
  ```
- For internal projects: use the mandatory internal tag set above
- For external projects: use the user-provided tag set
- Common tags (always): ManagedBy = "Terraform"

## Terraform Best Practices

### Resource Lifecycle
- Use lifecycle blocks for special handling:
  ```hcl
  lifecycle {
    create_before_destroy = true
    prevent_destroy       = true
    ignore_changes        = [tags["LastModified"]]
  }
  ```
- Use `prevent_destroy` for critical resources (databases, state buckets)
- Use `create_before_destroy` for zero-downtime updates
- Use `ignore_changes` for externally managed attributes

### Output Management
- Export useful values for other modules/stacks
- Mark sensitive outputs: `sensitive = true`
- Provide descriptions for all outputs
- Group related outputs together
- Use outputs for cross-stack references

### Data Sources
- Use data sources for existing resources
- Cache data source results in locals when used multiple times
- Handle data source failures gracefully
- Use depends_on when data sources need resources to exist first

### Provisioners (Avoid When Possible)
- Prefer cloud-init, user data, or configuration management tools
- Use provisioners only as last resort
- Implement proper error handling
- Use null_resource for one-off tasks
- Document why provisioner is necessary

## Debugging & Troubleshooting

### Logging
- Use TF_LOG environment variable for debugging (TRACE, DEBUG, INFO, WARN, ERROR)
- Save logs for troubleshooting: `TF_LOG_PATH=terraform.log`
- Use `-json` flag for machine-readable output
- Implement structured logging in custom resources

### Common Issues
- State lock errors: Check S3 lock file (.tflock), manually delete if needed
- Timeout errors: Increase timeout in resource configuration
- Dependency errors: Add explicit depends_on or restructure
- API rate limiting: Reduce parallelism or add delays
- Drift errors: Run refresh and investigate out-of-band changes

## Cost Management

### Cost Awareness
- Use AWS Cost Calculator or Azure Pricing Calculator before deploying
- Tag resources with cost allocation tags
- Implement budget alerts
- Use spot instances and reserved instances where appropriate
- Right-size resources based on actual usage

### Resource Cleanup
- Implement automated cleanup for temporary resources
- Use lifecycle policies for S3, logs, and backups
- Destroy unused environments regularly
- Monitor orphaned resources (EBS volumes, snapshots, IPs)
- Implement resource expiration tags

---

# Part 2: Infrastructure as Code Security Standards

## Secrets Management

### Never Hard-Code Secrets
- Use AWS Secrets Manager, Azure Key Vault, HashiCorp Vault, or GCP Secret Manager
- Fetch secrets at runtime using data sources:
  ```hcl
  data "aws_secretsmanager_secret_version" "db_password" {
    secret_id = "prod/database/password"
  }
  ```
- Use environment variables for CI/CD: `TF_VAR_secret_name`
- Never commit .tfvars files containing secrets
- Use .tfvars.example as templates with placeholder values

### State File Security
- Encrypt state files at rest using KMS/CMK
- Enable versioning on state storage (S3 versioning)
- Restrict access to state files using IAM policies
- Use separate state buckets per environment
- Enable MFA delete on production state buckets
- Audit state file access regularly

### Sensitive Data Handling
- Mark sensitive variables and outputs:
  ```hcl
  variable "db_password" {
    type      = string
    sensitive = true
  }

  output "connection_string" {
    value     = "..."
    sensitive = true
  }
  ```
- Avoid logging sensitive data
- Implement secret rotation policies

## IAM & Access Control

### Least Privilege Principle
- Grant minimum permissions required for Terraform execution
- Use separate IAM roles per environment (dev, staging, prod)
- Implement role assumption for cross-account access
- Use session tags for fine-grained access control
- Regular audit of IAM permissions

### Terraform Execution Roles
- Create dedicated service accounts for Terraform
- Use temporary credentials (STS assume role)
- Implement MFA for production deployments
- Rotate credentials regularly
- Use OIDC for CI/CD authentication (GitHub Actions, GitLab CI)

### Resource-Level Permissions
- Use resource-based policies where appropriate
- Implement SCPs (Service Control Policies) for AWS Organizations
- Use Azure Policy or GCP Organization Policies
- Enforce encryption requirements via policies
- Implement network access controls

## Network Security

### Network Segmentation
- Use private subnets for sensitive resources
- Implement proper security group rules (least privilege)
- Use NACLs for additional network layer security
- Implement VPC peering or Transit Gateway securely
- Use VPN or Direct Connect for hybrid connectivity

### Security Group Best Practices
- Never use 0.0.0.0/0 for ingress except for public-facing load balancers
- Use security group references instead of CIDR blocks when possible
- Implement separate security groups per tier (web, app, data)
- Document security group rules with descriptions
- Regular review and cleanup of unused rules

### Encryption in Transit
- Enforce HTTPS/TLS for all public endpoints
- Use VPN or PrivateLink for private connectivity
- Enable encryption for data transfer between services
- Use TLS 1.2 or higher
- Implement certificate management and rotation

## Data Protection

### Encryption at Rest
- Enable encryption for all storage resources (S3, EBS, RDS, etc.)
- Use customer-managed KMS keys for sensitive data
- Implement key rotation policies
- Use separate KMS keys per environment
- Audit key usage regularly

### Backup & Recovery
- Implement automated backup strategies
- Encrypt backups using KMS
- Test backup restoration regularly
- Implement cross-region backup replication for critical data
- Define and document RPO/RTO requirements

## Compliance & Governance

### Policy as Code
- Implement Terraform Sentinel, OPA, or Checkov
- Enforce compliance policies before deployment
- Example policies:
  - All S3 buckets must be encrypted
  - All EC2 instances must be in private subnets
  - All resources must have required tags
  - No public RDS instances allowed
- Fail deployments that violate policies

### Tagging for Governance
- Required tags for all resources (internal projects):
  ```hcl
  locals {
    required_tags = {
      app           = var.project_name
      env           = var.environment
      Category      = var.environment
      business-unit = var.business_unit
      owner         = var.owner_email
      expire-date   = var.expire_date
      ManagedBy     = "Terraform"
    }
  }
  ```
- For external projects: use user-provided tag set
- Enforce tagging via policies
- Use tags for cost allocation and access control

## Vulnerability Management

### Dependency Scanning
- Scan Terraform modules for vulnerabilities (Checkov, tfsec, Terrascan)
- Keep Terraform and providers updated
- Subscribe to security advisories for providers
- Implement automated vulnerability scanning in CI/CD
- Regular security audits of infrastructure code

### Image Security
- Use approved base images only
- Scan container images for vulnerabilities
- Implement image signing and verification
- Use private registries for custom images
- Regular image updates and patching

## Monitoring & Logging

### Audit Logging
- Enable CloudTrail, Azure Activity Log, or GCP Cloud Audit Logs
- Log all Terraform operations
- Centralize logs in SIEM or log aggregation platform
- Implement log retention policies
- Protect logs from tampering (write-once storage)

### Security Monitoring
- Implement GuardDuty, Security Center, or Security Command Center
- Monitor for suspicious activities
- Set up alerts for security events
- Implement automated response to security incidents
- Regular security posture reviews

## Secure Development Practices

### Secret Scanning
- Implement pre-commit hooks to prevent secret commits (git-secrets, truffleHog)
- Scan repositories for exposed secrets regularly
- Rotate secrets immediately if exposed
- Use .gitignore to prevent sensitive files from being committed
- Implement secret detection in CI/CD pipeline

### Secure CI/CD
- Use dedicated service accounts for CI/CD
- Implement least privilege for CI/CD pipelines
- Use temporary credentials (OIDC)
- Secure CI/CD secrets (GitHub Secrets, GitLab CI Variables)
- Audit CI/CD pipeline access and changes

## Security Testing

### Automated Security Testing
- Implement security scanning in CI/CD:
  - tfsec for Terraform security scanning
  - Checkov for policy as code
  - Terrascan for compliance scanning
  - Snyk for vulnerability scanning
- Fail builds on critical security issues
- Regular security testing of deployed infrastructure

---

# Part 3: Infrastructure Development Standards

## Version Control

### Repository Structure
- Use Git for all infrastructure code
- Implement branch protection for main/master
- Use feature branches for development
- Require pull requests for all changes
- Implement meaningful commit messages

### Commit Standards
- Use conventional commits format:
  - `feat: add new VPC module`
  - `fix: correct security group rule`
  - `docs: update module README`
  - `refactor: restructure networking module`
  - `test: add terratest for RDS module`
- Reference tickets/issues in commits
- Keep commits atomic and focused

### Branching Strategy
- Use GitFlow or trunk-based development
- Branch naming: `feature/`, `bugfix/`, `hotfix/`
- Keep branches short-lived
- Regular rebasing to keep up with main
- Delete merged branches

## Code Quality

### Formatting & Linting
- Run `terraform fmt -recursive` before committing
- Use pre-commit hooks for automatic formatting
- Implement tflint for additional linting
- Use consistent indentation (2 spaces)
- Keep line length reasonable (< 120 characters)

### Code Organization
- One resource type per file when possible
- Group related resources logically
- Use consistent file naming:
  - `main.tf` - primary resources
  - `variables.tf` - input variables
  - `outputs.tf` - output values
  - `locals.tf` - local values
  - `data.tf` - data sources
  - `versions.tf` - provider and version constraints
  - `backend.tf` - backend configuration
- Keep files focused and manageable (< 500 lines)

## Documentation

### Module Documentation
- Every module must have README.md with:
  - Purpose and description
  - Usage examples
  - Input variables table
  - Output values table
  - Requirements (Terraform version, providers)
  - Dependencies
  - Known issues or limitations
- Use terraform-docs to auto-generate documentation
- Keep documentation up to date with code changes

### Inline Documentation
- Comment complex logic and decisions
- Explain non-obvious resource configurations
- Document why, not what (code shows what)
- Use TODO comments for future improvements
- Reference documentation links for complex configurations

## CI/CD Integration

### Pipeline Stages
- Validate: `terraform fmt -check`, `terraform validate`
- Lint: tflint, Checkov, tfsec
- Plan: `terraform plan -out=plan.tfplan`
- Security Scan: Checkov, Snyk
- Manual Approval (for production)
- Apply: `terraform apply plan.tfplan`
- Test: Run smoke tests

### Automation Best Practices
- Use dedicated service accounts for CI/CD
- Implement least privilege for pipeline permissions
- Use temporary credentials (OIDC)
- Store sensitive values in CI/CD secrets
- Implement plan approval workflows for production
- Save plan artifacts for audit trail

### Environment Promotion
- Test in dev → staging → prod progression
- Implement automated promotion for non-prod
- Require manual approval for production
- Use identical configurations across environments (only variables differ)
- Document promotion procedures

## Change Management

### Change Approval Process
- Require peer review for all changes
- Implement approval workflows for production
- Document change rationale in PRs
- Review plan output before approval
- Maintain change log

### Rollback Procedures
- Document rollback procedures
- Test rollback in non-prod
- Maintain previous state versions
- Use version control for code rollback
- Implement automated rollback for critical failures

## Team Collaboration

### Code Review Guidelines
- Review for security issues
- Verify compliance with standards
- Check for hard-coded values
- Verify proper variable usage
- Review plan output
- Provide constructive feedback

### Knowledge Sharing
- Regular team knowledge sharing sessions
- Document common patterns and solutions
- Maintain internal wiki or documentation
- Pair programming for complex changes
- Mentoring for new team members

## Tool Recommendations

### Essential Tools
- Terraform (latest stable version)
- tflint - Linting
- Checkov - Security scanning
- terraform-docs - Documentation generation
- pre-commit - Git hooks
- Terratest - Testing framework

### Optional Tools
- Terragrunt - DRY configurations
- Atlantis - Pull request automation
- Terraform Cloud/Enterprise - Collaboration platform
- Infracost - Cost estimation
- Terrascan - Policy as code
- tfsec - Security scanning

## Best Practices Summary

### Always Do
- Use version control for all infrastructure code
- Implement remote state with locking
- Use modules for reusable components
- Pin versions in production
- Encrypt sensitive data
- Implement comprehensive testing
- Document everything
- Review all changes
- Use consistent naming conventions
- Tag all resources

### Never Do
- Hard-code secrets or sensitive data
- Commit .tfvars files with secrets
- Use default workspace in production
- Skip code review
- Apply changes without plan review
- Use overly permissive IAM policies
- Ignore security warnings
- Deploy directly to production
- Use deprecated provider features
- Leave orphaned resources
