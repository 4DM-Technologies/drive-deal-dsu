---
description: Critical Terraform rules and lessons learned from real deployments for IAM and resource configuration
inclusion: auto
---

# Terraform Rules and Lessons Learned

Critical rules from real deployments. MUST follow when generating Terraform code.

## Bootstrap Backend

Backend module uses local state. Always check if S3 bucket exists and terraform import it before terraform apply. Otherwise apply fails with BucketAlreadyExists or similar. DynamoDB table is no longer needed — use `use_lockfile = true` instead.

## State Locking

The `dynamodb_table` parameter in S3 backend is DEPRECATED. Use `use_lockfile = true` instead, which uses native S3 lock files (`.tflock` alongside state). This eliminates the need for a DynamoDB table entirely.

```hcl
# CORRECT — native S3 lock file
terraform {
  backend "s3" {
    bucket       = "project-terraform-state"
    key          = "env/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}

# DEPRECATED — do NOT use
terraform {
  backend "s3" {
    dynamodb_table = "terraform-locks"  # DEPRECATED
  }
}
```

## IAM Best Practices

When using default_tags, always include these IAM actions in roles that manage IAM resources:
- iam:TagRole, iam:UntagRole, iam:ListRoleTags
- iam:TagPolicy, iam:UntagPolicy, iam:ListPolicyTags
- iam:GetPolicyVersion, iam:ListPolicyVersions, iam:CreatePolicyVersion, iam:DeletePolicyVersion
- iam:TagInstanceProfile, iam:UntagInstanceProfile

For state backend bootstrap also add:
- S3: CreateBucket, PutBucketVersioning, PutBucketPublicAccessBlock, PutEncryptionConfiguration, Get* bucket properties, PutBucketTagging

## AWS Resource Constraints

- EC2: Amazon Linux 2023 AMIs need minimum 30GB root volume. Never set below 30.
- RDS: Never hardcode deprecated minor versions (e.g. 15.4). Use latest stable (15.12 for PG15 as of 2026).
- RDS: NEVER use reserved words as master usernames. Reserved words include: `admin`, `user`, `root`, `postgres`, `mysql`, `rdsadmin`, `master`, `public`, `select`, `insert`, `update`, `delete`, `grant`, `revoke`, `create`, `drop`, `table`, `database`. Use a safe default like `dbadmin` or `appadmin` instead. Always add a validation block:
  ```hcl
  variable "master_username" {
    type        = string
    description = "Master username for RDS (must not be a reserved word)"
    default     = "dbadmin"
    validation {
      condition     = !contains(["admin", "user", "root", "postgres", "mysql", "rdsadmin", "master", "public"], lower(var.master_username))
      error_message = "master_username must not be a reserved word (admin, user, root, postgres, mysql, rdsadmin, master, public)."
    }
  }
  ```
- API Gateway: access_log_settings block REQUIRES the format argument with JSON log format string.

## Invalid Count Argument Prevention

The `count` and `for_each` meta-arguments MUST only depend on values known at plan time. Using values that are only known after apply (like module outputs, resource attributes, or data source results) causes "Invalid count argument" or "Invalid for_each argument" errors.

**Rules:**
- `count` and `for_each` MUST use: variables, locals computed from variables, static values, or `terraform.workspace`
- `count` and `for_each` MUST NOT use: module outputs, resource attributes, data source results, or any value marked "known after apply"
- When conditionally creating resources based on another resource's existence, use a variable flag (e.g., `var.enable_rds_proxy`) instead of checking a resource attribute
- When iterating over resources, build the collection from variables/locals, not from other resource outputs

**Bad — causes Invalid count argument:**
```hcl
# DON'T: count depends on module output (unknown at plan time)
resource "aws_security_group_rule" "rds_from_ecs" {
  count                    = length(module.ecs.security_group_ids)
  source_security_group_id = module.ecs.security_group_ids[count.index]
}

# DON'T: for_each depends on resource attribute
resource "aws_route_table_association" "private" {
  for_each       = toset(aws_subnet.private[*].id)
  subnet_id      = each.value
  route_table_id = aws_route_table.private.id
}
```

**Good — values known at plan time:**
```hcl
# DO: count depends on variable (known at plan time)
resource "aws_security_group_rule" "rds_from_ecs" {
  count                    = var.enable_ecs ? 1 : 0
  source_security_group_id = module.ecs[0].security_group_id
}

# DO: for_each depends on variable list
resource "aws_route_table_association" "private" {
  for_each       = { for idx, cidr in var.private_subnet_cidrs : idx => cidr }
  subnet_id      = aws_subnet.private[each.key].id
  route_table_id = aws_route_table.private[each.key].id
}

# DO: conditional module creation with variable flag
module "rds_proxy" {
  count  = var.enable_rds_proxy ? 1 : 0
  source = "../../modules/rds-proxy"
}
```

## Lambda Module

From terraform/modules/lambda/ to repo root src/ is 3 levels up:
- path.module/../../../src = CORRECT
- path.module/../../../../src = WRONG (above repo root)

## CloudFront

Make acm_certificate_arn optional (default ""). Use dynamic blocks to switch between custom cert and cloudfront_default_certificate.

## VPC CIDR

Avoid 10.0.0.0/16 (common conflict). For dev use small CIDRs like /24 with /27 subnets. Always check for conflicts with existing VPCs.

## Terraform Variable Rules

- Name tfvars files *.auto.tfvars (NOT .example). Terraform only auto-loads terraform.tfvars or *.auto.tfvars.
- Whitelist !*.auto.tfvars in .gitignore if *.tfvars is excluded.
- Every variable without a default MUST have a value in auto.tfvars. Cross-check before generating.

## Internal vs External Project Conventions

Before generating any Terraform code, ALWAYS ask: **Is this an internal or external project?**

**Internal projects** use:
- Naming: `zeb-<project>-<resource>-<purpose>-<env>` (e.g., `zeb-myapp-s3-frontend-dev`)
- Tags: app, env, Category, business-unit, owner (@zeb.co), expire-date (dd/mm/yyyy), ManagedBy
- Collect from user: project_name, business_unit, owner_email (@zeb.co), expire_date (dd/mm/yyyy), environment

**External projects** use:
- User-provided naming convention
- User-provided tags

## Terraform Version Constraint

ALWAYS use `required_version = ">= 1.6.0"` (not `~> 1.6.0`). The `>=` operator allows teams to use any Terraform version at or above the minimum, which is more flexible for CI/CD pipelines and team environments. The `~>` operator is too restrictive for required_version.

## Backend Configuration Must Be Separate File

Backend configuration MUST be in a separate `backend.tf` file per environment, NOT inline in `main.tf`. The `main.tf` should only contain `required_version`, `required_providers`, provider config, and module calls.

## Monitoring Module Boolean Flag Pattern

When a monitoring/alerting module conditionally creates alarms based on whether a resource exists, NEVER use the resource identifier string in `count`. Module outputs like `module.database.instance_id` propagate as "known after apply" through module variables, causing `Invalid count argument`.

**Bad:**
```hcl
# DON'T: var.db_instance_id comes from module.database.instance_id (unknown at plan time)
resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  count = var.db_instance_id != "" ? 1 : 0
}
```

**Good:**
```hcl
# DO: use a boolean flag (known at plan time)
variable "enable_rds_alarms" {
  type    = bool
  default = false
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  count = var.enable_rds_alarms ? 1 : 0
}

# Root module passes static boolean:
module "monitoring" {
  enable_rds_alarms = true
  db_instance_id    = module.database.instance_id  # only used in dimensions, not count
}
```

This applies to ALL conditional resources that depend on whether another module's resource exists: Lambda alarms, API Gateway alarms, RDS alarms, SNS subscriptions, etc.

## Checklist

- tfvars named *.auto.tfvars
- .gitignore whitelists !*.auto.tfvars
- Every variable without default has value in auto.tfvars
- Bootstrap imports existing S3 bucket before applying
- Backend uses `use_lockfile = true` (NOT `dynamodb_table`)
- Backend config is in separate `backend.tf` file (NOT inline in main.tf)
- EC2 root volume >= 30GB for AL2023
- RDS engine version is current
- RDS master_username is NOT a reserved word (no admin, user, root, postgres, mysql, rdsadmin, master, public)
- RDS master_username variable has a validation block to reject reserved words
- API Gateway access_log_settings has format
- Lambda archive_file paths count levels correctly
- ACM certificate optional with default fallback
- VPC CIDR checked for conflicts
- Terraform required_version uses ">=" (NOT "~>")
- All count/for_each arguments use values known at plan time (variables, locals from variables, static values)
- No count/for_each depends on module outputs, resource attributes, or data source results
- Monitoring alarms use boolean enable flags (not runtime string comparisons) for count
- Internal projects use naming: zeb-<project>-<resource>-<purpose>-<env>
- Internal projects have mandatory tags: app, env, Category, business-unit, owner, expire-date (dd/mm/yyyy), ManagedBy
- External projects use user-provided naming and tags
