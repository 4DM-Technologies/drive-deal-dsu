---
description: Enforces complete Terraform IaC project structure generation for Lambda, ECS, and EKS architectures
inclusion: auto
---

# Architecture Generation Instructions

## CRITICAL: When User Requests Architecture

When the user says ANY of these phrases:
- "I need [Lambda/ECS/EKS] architecture"
- "Generate [Lambda/ECS/EKS] architecture"
- "Create [Lambda/ECS/EKS] infrastructure"
- "Build [Lambda/ECS/EKS] setup"

You MUST first ask the user: **"Is this an internal or external project?"**

### If Internal Project
Collect the following from the user before generating code:
- `project_name` (project identifier)
- `business_unit` (e.g., `platform`, `data`, `devops`)
- `owner_email` (must be `@zeb.co`)
- `expire_date` (resource expiration date in `dd/mm/yyyy` format)
- `environment` (e.g., `dev`, `staging`, `prod`)

Apply these conventions:
- **Naming**: `zeb-<project>-<resource>-<purpose>-<environment>` (e.g., `zeb-myapp-s3-frontend-dev`, `zeb-myapp-rds-postgres-prod`, `zeb-myapp-ecs-cluster-dev`)
- **Tags** (mandatory on all resources):
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
- **Terraform required_version**: `">= 1.6.0"` (use `>=`, not `~>`)

### If External Project
Collect the following from the user before generating code:
- Their preferred **naming convention** pattern (e.g., `<company>-<project>-<env>`)
- Their required **tags** (key-value pairs they want on all resources)
- `environment`

Apply the user-provided naming and tags consistently across all resources.
- **Terraform required_version**: `">= 1.6.0"` (use `>=`, not `~>`)

### Then Generate
You MUST generate the COMPLETE Terraform IaC project structure.

## What to Generate (ALWAYS)

### 1. Project Root Files

#### .gitignore (ALWAYS)
```gitignore
# Terraform Files
**/.terraform/*
*.tfstate
*.tfstate.*
*.tfplan
*.tfplan.*
.terraform.lock.hcl

# Sensitive Data (NEVER COMMIT)
*.tfvars
*.tfvars.json
!*.tfvars.example
secrets/
*.pem
*.key

# Log Files
*.log
logs/

# IDE Files
.idea/
.vscode/
*.swp

# OS Files
.DS_Store
Thumbs.db

# Python
__pycache__/
*.py[cod]
venv/
.venv

# Environment Variables
.env
.env.local
```

#### README.md (ALWAYS)
Include:
- Project overview
- Prerequisites
- Setup instructions
- Deployment steps
- Module descriptions

### 2. Terraform Files (ALWAYS)

Generate ALL these files:

```
terraform/
├── environments/
│   └── {environment}/
│       ├── main.tf                    # Root module with all module calls
│       ├── variables.tf               # All input variables
│       ├── local.tf                   # Variable-to-locals transformation
│       ├── output.tf                  # All outputs
│       ├── backend.tf                 # S3 backend configuration
│       └── terraform.tfvars.example   # Template with placeholder values
└── modules/
    ├── networking/
    │   ├── main.tf
    │   ├── variables.tf
    │   └── output.tf
    ├── key-management/                # SSH key storage for bastion EC2
    │   ├── main.tf                    # TLS private key, S3 bucket, KMS encryption
    │   ├── variables.tf
    │   └── output.tf
    ├── frontend/
    │   ├── main.tf
    │   ├── variables.tf
    │   └── output.tf
    └── [other modules based on architecture]
```

### Key Management Module (ALWAYS include when bastion exists)

The `key-management` module creates:
- A TLS private key for SSH access to bastion EC2 instances
- A dedicated S3 bucket (encrypted with KMS) for storing the `.pem` file
- An S3 object containing the private key so users can download it securely
- Bucket policy restricting access to authorized IAM roles/users only
- The bastion module references this module's outputs for the key pair

### 3. Additional Files Based on Architecture

**For ECS:**
- `Dockerfile` (sample)
- `src/` directory structure
- `.dockerignore`

**For EKS:**
- `Dockerfile` (sample)
- `k8s/deployment.yaml`
- `k8s/service.yaml`
- `k8s/ingress.yaml`
- `k8s/hpa.yaml`
- `k8s/serviceaccount.yaml`
- `src/` directory structure
- `.dockerignore`

**For Lambda:**
- `src/` directory structure (Lambda handler code)

## CRITICAL RULES

1. **NEVER generate only modules** — Always generate the complete project structure
2. **ALWAYS include .gitignore** — First file to create
3. **ALWAYS include terraform.tfvars.example** — Template file with placeholder values
4. **ALWAYS include local.tf** — Root module must use the local.tf transformation pattern
5. **ALWAYS include README.md** — Basic documentation
6. **ALWAYS include all module files** — main.tf, variables.tf, output.tf per module
7. **DO NOT generate** GitHub Actions workflows, CODEOWNERS, CloudFormation OIDC templates, or draw.io diagrams

## Generation Order

1. Create `.gitignore`
2. Create `README.md`
3. Create `terraform/environments/{env}/` files (main.tf, variables.tf, local.tf, output.tf, backend.tf, terraform.tfvars.example)
4. Create `terraform/modules/` — start with `networking/`, then `key-management/`, then all other modules
5. Create architecture-specific files (Dockerfile, k8s/, src/)

## Example Response Format

When user says "I need ECS architecture for 'myapp' in dev":

```
I'll generate the complete ECS Terraform IaC for 'myapp' in the dev environment. This includes:

✅ Complete Terraform modules (networking, key-management, frontend, ECR, ALB, ECS, database, bastion, monitoring)
✅ Root module with local.tf transformation pattern
✅ terraform.tfvars.example with placeholder values
✅ .gitignore
✅ Sample Dockerfile and src/
✅ README.md

Let me create all the files now...
```

## What NOT to Do

❌ Don't generate only the modules
❌ Don't skip .gitignore
❌ Don't skip the `key-management` module when bastion is included
❌ Don't skip README.md
❌ Don't generate partial structure
❌ Don't generate GitHub Actions workflows
❌ Don't generate CloudFormation OIDC templates
❌ Don't generate draw.io architecture diagrams
❌ Don't generate CODEOWNERS files

## Summary

When user requests ANY architecture:
1. Generate COMPLETE Terraform IaC project structure
2. Include ALL Terraform files (environments + modules)
3. Include `local.tf` in root module
4. Include `key-management` module for bastion SSH key storage in S3
5. Include .gitignore and README.md
6. Include architecture-specific files (Dockerfile, k8s/, src/)
7. Do NOT include CI/CD workflows, OIDC CFT, or draw.io diagrams
