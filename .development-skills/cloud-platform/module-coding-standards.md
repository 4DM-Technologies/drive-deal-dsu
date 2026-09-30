---
title: Module Coding Standards (from existing repos)
description: Terraform module coding patterns derived from aws-common-module, aws-connect-module, aws-ecs-module, aws-lambda-module, and aws-eks-module repositories
inclusion: always
---

# Module Coding Standards

Derived from `aws-common-module`, `aws-connect-module`, `aws-ecs-module`, `aws-lambda-module`, and `aws-eks-module` repositories. All generated Terraform code MUST follow these patterns.

---

## 1. Resource Naming Conventions

### Resource Labels
- Use `this` for single-instance resources in reusable modules: `aws_iam_role.this`, `aws_s3_bucket.this`
- Use descriptive labels for multi-resource modules: `aws_vpc.main_vpc`, `aws_instance.ec2_instance`
- Use `main` for primary resources in project-level modules: `aws_vpc.main`, `aws_internet_gateway.main`

### Variable-Driven Names
- Resource names come from variables, never hard-coded:
  ```hcl
  resource "aws_ecs_cluster" "this" {
    name = var.cluster_name
  }
  ```

---

## 2. File Structure Per Module

### Reusable Modules (under `modules/`)
Every module has exactly three files (no `locals.tf`, no `data.tf`, no `versions.tf` at module level):
- `main.tf` — all resources, data sources, and locals (if needed)
- `variables.tf` — all input variables
- `output.tf` (singular, NOT `outputs.tf`) — all outputs

Exception: `aws-connect-module` uses `outputs.tf` (plural). For new code, use `output.tf` to match `aws-common-module`.

### Root Modules (under `environment/` or `env/`)
Root modules use four files:
- `main.tf` — all module invocations and standalone resources
- `variables.tf` — all input variables (list-of-object types for tfvars-driven config)
- `local.tf` — transforms variables into locals consumed by modules (see Section 16)
- `output.tf` — all outputs

---

## 3. Variable Patterns

### Section Headers
Group variables with comment block headers:
```hcl
# ========================================
# ECS CLUSTER VARIABLES
# ========================================
variable "cluster_name" { ... }

# ========================================
# ECS SERVICE VARIABLES
# ========================================
variable "name" { ... }
```

### Defaults
- Use empty string `""` as default for optional string variables (not `null`)
- Use empty list `[]` for optional list variables
- Use empty map `{}` for optional map variables
- Use `false` for optional bool variables
- Always provide a `description` for every variable

### Conditional Resource Creation
Use `count` with empty-string checks (not `var.create_xxx` booleans) in common modules:
```hcl
resource "aws_ecs_cluster" "this" {
  count = var.cluster_name != "" ? 1 : 0
  name  = var.cluster_name
}
```

For project-level modules, `for_each` with `toset()` is preferred:
```hcl
resource "aws_lambda_function" "functions" {
  for_each = toset(var.lambda_names)
  function_name = each.value
}
```

**CRITICAL: Invalid count argument prevention**
- `count` and `for_each` MUST only use values known at plan time: variables, locals computed from variables, static values
- NEVER use module outputs, resource attributes, or data source results in `count` or `for_each` — these are "known after apply" and cause `Invalid count argument` errors
- When conditionally creating resources based on another resource, use a variable flag (e.g., `var.enable_rds_proxy ? 1 : 0`) instead of checking a resource/module output
- When building `for_each` maps, derive them from variable lists, not from resource outputs

### Complex Variable Types
Use `object()` for structured config:
```hcl
variable "network_configuration" {
  type = object({
    subnets          = list(string)
    security_groups  = list(string)
    assign_public_ip = bool
  })
  default = {
    subnets          = []
    security_groups  = []
    assign_public_ip = false
  }
}
```

### Per-Function Overrides Pattern
For modules managing multiple similar resources, use a base default + per-resource override map:
```hcl
variable "lambda_timeout" {
  description = "Default timeout for all Lambda functions"
  type        = number
  default     = 30
}

variable "lambda_timeout_per_function" {
  description = "Override timeout per function"
  type        = map(number)
  default     = {}
}

# Usage in resource:
timeout = lookup(var.lambda_timeout_per_function, each.value, var.lambda_timeout)
```

### Root Module Variable Pattern (list-of-objects)
Root module variables use `list(object(...))` types so values come from `.tfvars`:
```hcl
variable "ec2" {
  description = "List of EC2 instance configurations"
  type = list(object({
    ami                           = string
    instance_type                 = string
    associate_public_ip_on_launch = bool
    tags                          = map(string)
  }))
}
```

---

## 4. Tagging Pattern

### Always use `merge()` with a `var.tags` base:
```hcl
tags = merge(
  var.tags,
  { Name = var.cluster_name }
)
```

### Every module accepts a `tags` variable:
```hcl
variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}
```

### Root module merges `common_tags` in `local.tf`:
```hcl
locals {
  common_tags = var.common_tags

  ec2_instances = [
    {
      tags = merge(var.common_tags, var.ec2[0].tags)
      # ...
    }
  ]
}
```

---

## 5. Networking Patterns

### Pattern A: 3-Tier Subnets (ECS Architecture — `aws-ecs-module`)
Uses dedicated subnet resources per tier with `count`:
- `public` subnets — ALB, NAT Gateway, Bastion
- `app_private` subnets — ECS tasks, compute
- `data_private` subnets — RDS, ElastiCache, data stores

Each tier gets its own route table and route table associations.

```hcl
variable "public_subnet_cidrs" { type = list(string) }
variable "app_private_subnet_cidrs" { type = list(string) }
variable "data_private_subnet_cidrs" { type = list(string) }
```

### Pattern B: Data-Driven Networking (Lambda & EKS Architectures)
All subnets, route tables, NAT gateways, and security groups passed as lists of objects. Uses index-based cross-references:
```hcl
variable "subnets" {
  type = list(object({
    cidr_block              = string
    availability_zone       = string
    map_public_ip_on_launch = bool
    tags                    = map(string)
  }))
}

variable "route_table_associations" {
  type = list(object({
    subnet_index      = number
    route_table_index = number
  }))
}

variable "nat_gateways" {
  type = list(object({
    name         = string
    eip_index    = number
    subnet_index = number
  }))
}
```

Security group rules flattened via locals:
```hcl
locals {
  all_ingress_rules = flatten([
    for sg_idx, sg in var.security_groups : [
      for rule_idx, rule in sg.ingress_rules : merge(rule, { sg_index = sg_idx })
    ]
  ])
}
```

### When to Use Which
- **3-tier (Pattern A)**: ECS architectures — simpler, explicit subnet tiers
- **Data-driven (Pattern B)**: Lambda and EKS architectures — fully configurable via tfvars

---

## 6. EC2 / Bastion Pattern

The EC2 module bundles key pair generation with the instance:
- `tls_private_key` generates the SSH key
- `aws_key_pair` registers it
- Private key stored to S3 (ECS/Lambda pattern) or `local_file` (common module)
- `aws_instance` uses the key pair
- Root volume uses `gp3` by default
- `volume_tags` variable for SCP compliance
- Bastion EIP created separately and associated via `aws_eip_association`

---

## 7. ECR Pattern

- Supports both private and public repositories via separate `for_each` loops
- Private repos prefixed with `private-`, public with `public-`
- `image_tag_mutability` is a boolean variable in common module (not string)
- ECS module converts string to boolean: `var.ecr[0].image_tag_mutability == "MUTABLE" ? true : false`
- `scan_on_push` enabled by default
- Dynamic `encryption_configuration` block for KMS
- Lifecycle policy support via `create_lifecycle_policy` boolean + `lifecycle_policy_rules` list

---

## 8. Secrets Manager Pattern

The secrets module uses a flexible map-based approach:
```hcl
variable "secrets" {
  type = map(object({
    name                    = optional(string)
    description             = optional(string, "Managed by Terraform")
    kms_key_id              = optional(string)
    recovery_window_in_days = optional(number, 30)
    secret_string           = optional(string)
    generate_db_password    = optional(bool, false)
    db_username             = optional(string, "dbadmin")
    secret_policy           = optional(string)
    tags                    = optional(map(string), {})
  }))
}
```

Key features:
- Auto-generates DB passwords with `random_password` when `generate_db_password = true`
- Stores username + password as JSON
- Optional resource policy attachment
- Name prefix pattern: `${var.name_prefix}/${each.key}`
- ECS root module fetches credentials via `data "aws_secretsmanager_secret_version"` for RDS

---

## 9. IAM Pattern

Separate modules for roles and policies:

### IAM Role Module
- Single role with `assume_role_policy` using `var.assume_service`
- `policy_arns` list for managed policy attachments
  - `aws-common-module`: uses `count` for attachments
  - `aws-eks-module`: uses `for_each = toset(var.policy_arns)` for attachments
- Optional `aws_iam_instance_profile` creation (conditional on `var.name != ""`)

### IAM Policy Module
- Simple: takes `policy_name`, `description`, `policy_json`
- Outputs: `policy_arn`, `policy_id`, `policy_name`

### IAM Instance Profile Module (Lambda/ECS pattern)
- Separate module: takes `instance_profile_name` and `instance_profile_role`
- Created via `for_each` in root module

### ECS Task Execution Role (inline in root module)
- Created directly in root `main.tf` (not via module)
- `aws_iam_role` + `aws_iam_role_policy_attachment` with `for_each = toset(policy_arns)`

### Lambda-Specific IAM (aws-connect-module pattern)
- IAM role created per Lambda function using `for_each`
- Inline policy + managed policy attachments per function
- Per-function policy override: `lambda_policy_arns_per_function`

---

## 10. CloudFront Pattern

- Supports multiple origin types via `var.origin_type`: `"s3"`, `"elb"`, `"api_gateway"`
- Dynamic blocks for `custom_origin_config` (ELB/API GW) vs `s3_origin_config`
- Optional Origin Shield via dynamic block
- SSL certificate is optional — falls back to `cloudfront_default_certificate` when `ssl_certificate_arn == ""`
- OAI created conditionally for S3 origins only
- S3 bucket policy for CloudFront created separately in root module after both S3 and CloudFront modules

---

## 11. RDS Pattern

- Comprehensive variable set covering all RDS options
- `db_password` marked as `sensitive = true`
- ECS pattern: password fetched from Secrets Manager via `jsondecode(data.aws_secretsmanager_secret_version...)`
- Lambda pattern: password auto-generated by RDS module
- `authentication_method` with validation block: `"password"` or `"password_iam"`
- Performance Insights with standard/advanced mode toggle
- `ca_cert_identifier` defaults to `"rds-ca-rsa2048-g1"`
- `apply_immediately = true` in the resource
- CloudWatch logs exports default: `["postgresql", "upgrade", "iam-db-auth-error"]`
- DB Subnet Group as separate module (Lambda) or inline resource (ECS)

---

## 12. API Gateway Pattern

- Proxy resource with `{proxy+}` path
- `ANY` method with `AWS_PROXY` integration to Lambda
- Stage created from deployment
- Simple variables: `name`, `description`, `lambda_invoke_arn`, `stage_name`, `authorization`

---

## 13. Output Patterns

### Conditional outputs using `length()` check:
```hcl
output "cluster_arn" {
  value = length(aws_ecs_cluster.this) > 0 ? aws_ecs_cluster.this[0].arn : ""
}
```

### Map outputs for `for_each` resources:
```hcl
output "secret_arns" {
  value = { for k, s in aws_secretsmanager_secret.this : k => s.arn }
}
```

### Always include `description` on outputs.

---

## 14. Root Module (Environment) Patterns

### Common Across All Architectures
- All modules sourced with relative paths: `source = "../../modules/vpc"`
- Common tags passed to every module via `local.tf` merge
- `depends_on` used explicitly when module ordering matters
- Feature flags for optional components: `count = var.voicemail_enabled ? 1 : 0`

### for_each Over Locals Lists Pattern
Root modules invoke reusable modules via `for_each` over index-keyed locals:
```hcl
module "iam_policy" {
  source   = "../../modules/iam-policy"
  for_each = { for idx, policy in local.iam_policies : idx => policy }

  policy_name = each.value.policy_name
  description = each.value.description
  policy_json = each.value.policy_json
  tags        = each.value.tags
}
```

This pattern is used consistently across ECS, Lambda, and EKS root modules for: IAM policies, IAM roles, EC2, ECR, S3, secrets, Lambda functions, REST APIs, Bedrock profiles, budgets, etc.

### Cross-Module References
Locals resolve module outputs into subsequent module inputs:
```hcl
locals {
  iam_roles = [
    {
      role_name      = var.iam_role[0].role_name
      assume_service = var.iam_role[0].assume_service
      policy_arns    = [module.iam_policy["0"].policy_arn]
    }
  ]
}
```

---

## 15. Security Group Patterns

### Pattern A: Inside Networking Module (Lambda architecture)
Security groups created inside the networking module alongside VPC resources. Rules flattened via locals.

### Pattern B: Inline in Root Module (ECS architecture)
Security groups created as standalone resources in root `main.tf` with `for_each`, rules flattened via `merge()`:
```hcl
resource "aws_security_group" "security_groups" {
  for_each = { for idx, sg in local.networking.security_groups : tostring(idx) => sg }
  name        = each.value.name
  description = each.value.description
  vpc_id      = module.networking.vpc_id
  tags        = each.value.tags
}

resource "aws_security_group_rule" "ingress_rules" {
  for_each = merge([
    for sg_idx, sg in local.networking.security_groups : {
      for rule_idx, rule in sg.ingress_rules :
      "${sg_idx}-ingress-${rule_idx}" => {
        sg_key    = tostring(sg_idx)
        from_port = rule.from_port
        to_port   = rule.to_port
        protocol  = rule.protocol
        cidr_blocks = try(rule.cidr_blocks, null)
      }
    }
  ]...)
  type              = "ingress"
  security_group_id = aws_security_group.security_groups[each.value.sg_key].id
  # ...
}
```

### Pattern C: Inside Consumer Module (aws-connect-module)
Security groups created inside the module that needs them (e.g., Lambda module creates its own SG).

---

## 16. local.tf Pattern (Root Module Variable Transformation)

All ECS, Lambda, and EKS root modules use `local.tf` to transform `variables.tf` inputs into structured locals consumed by modules. This is the central orchestration pattern.

### Purpose
- Merge `common_tags` into per-resource tags
- Resolve cross-module references (module outputs → next module inputs)
- Transform flat variable lists into structured objects for modules
- Add index-based references (subnet_index, security_group_index)

### Structure
```hcl
locals {
  common_tags = var.common_tags

  # Networking — consolidate all VPC-related config
  networking = {
    vpc_cidr_block = var.vpc_configs[0].cidr_block
    vpc_tags       = merge(var.common_tags, var.vpc_configs[0].tags)
    subnets = [
      for idx, subnet in var.subnet : {
        cidr_block        = subnet.cidr_block
        availability_zone = subnet.availability_zone
        tags              = merge(var.common_tags, subnet.tags)
      }
    ]
    security_groups = [
      for idx, sg in var.security_group : {
        name          = sg.name
        description   = sg.description
        tags          = merge(var.common_tags, sg.tags)
        ingress_rules = sg.ingress_rules
        egress_rules  = sg.egress_rules
      }
    ]
    # ... route_tables, nat_gateways, eips, etc.
  }

  # Per-resource locals with cross-module references
  ec2_instances = [
    {
      ami                    = var.ec2[0].ami
      key_name               = module.key_pairs[0].key_name
      vpc_security_group_ids = [module.networking.security_group_ids[1]]
      subnet_id              = module.networking.subnet_ids[0]
      tags                   = merge(var.common_tags, var.ec2[0].tags)
    }
  ]
}
```

### Key Rules
- Group by resource type with `# ========` section headers
- Always merge `var.common_tags` into resource-specific tags
- Use module output references for IDs (security groups, subnets, etc.)
- Use index-based access: `var.ec2[0].ami`, `module.networking.subnet_ids[2]`

---

## 17. ECS-Specific Patterns

### Multi-Resource ECS Module
The ECS module handles cluster, task definition, AND service in a single module using `count` with empty-string checks:
```hcl
resource "aws_ecs_cluster" "this" {
  count = var.cluster_name != "" ? 1 : 0
  name  = var.cluster_name
  setting { name = "containerInsights"; value = "enabled" }
}

resource "aws_ecs_task_definition" "this" {
  count  = var.family != "" ? 1 : 0
  family = var.family
  # ...
}

resource "aws_ecs_service" "this" {
  count = var.name != "" ? 1 : 0
  name  = var.name
  # ...
}
```

Root module invokes the same module source three times with different variables:
```hcl
module "ecs_cluster"         { source = "../../modules/ecs"; cluster_name = ... }
module "ecs_task_definition" { source = "../../modules/ecs"; family = ... }
module "ecs_service"         { source = "../../modules/ecs"; name = ... }
```

### ALB Pattern (ECS)
- Target group created as standalone resource in root module
- ALB module handles the load balancer + listeners
- ECS service references target group ARN via `load_balancer` block
- Health check config passed as object variable

### ECS Task Execution Role
- Created inline in root module (not via IAM role module)
- Policy attachments via `for_each = toset(policy_arns)`

---

## 18. EKS-Specific Patterns

### create_cluster Boolean Flag
First entry creates cluster + node group; subsequent entries create only node groups:
```hcl
variable "create_cluster" {
  type    = bool
  default = false
}

resource "aws_eks_cluster" "this" {
  count = var.create_cluster ? 1 : 0
  name  = var.cluster_name
  # ...
}
```

### Multiple Node Groups
Supports general-purpose and GPU node groups with separate configs:
```hcl
variable "node_group_name" { type = string; default = "" }
variable "scaling_config" {
  type = object({
    desired_size = number
    max_size     = number
    min_size     = number
  })
}
```

### EKS Access Entry & Policy Modules
Separate modules for `aws_eks_access_entry` and `aws_eks_access_policy_association`.

### VPC Endpoint Module
Supports both Gateway and Interface types with conditional attributes:
```hcl
resource "aws_vpc_endpoint" "this" {
  vpc_id            = var.vpc_id
  service_name      = var.service_name
  vpc_endpoint_type = var.vpc_endpoint_type
  # Interface-only attributes
  subnet_ids         = var.vpc_endpoint_type == "Interface" ? var.subnet_ids : null
  security_group_ids = var.vpc_endpoint_type == "Interface" ? var.security_group_ids : null
  # Gateway-only attributes
  route_table_ids    = var.vpc_endpoint_type == "Gateway" ? var.route_table_ids : null
}
```

### Additional EKS Modules (not in common module)
- DynamoDB, SQS, SQS DLQ, SNS, ElastiCache, OpenSearch Serverless
- S3 Vector store, EIP Association, DB Subnet Group
- API Gateway (ALB-backed, not Lambda-backed)

---

## 19. Lambda-Specific Patterns

### Lambda Module
- Container image-based (`image_uri`) — not zip-based
- VPC-attached with `subnet_ids` and `security_group_ids`
- Environment variables passed as `map(string)`

### Additional Lambda Modules (not in common module)
- **ACM**: Certificate + optional DNS validation
- **CloudWatch**: Log group with optional KMS encryption (`kms_key_id != "" ? var.kms_key_id : null`)
- **DB Subnet Group**: Simple wrapper — `name`, `description`, `subnet_ids`, `tags`
- **IAM Instance Profile**: Separate module — `instance_profile_name`, `instance_profile_role`
- **Key Pair**: Generates TLS key, stores private key to S3 (not local file)

### Lambda Root Module Extras
- S3 bucket policy for CloudFront created as standalone resource after both modules
- Budget alerts module for cost management
- Bedrock inference profiles

---

## 20. DB Subnet Group Pattern

Separate module or inline resource depending on architecture:
- **Lambda**: Separate `db-subnet-group` module invoked via `for_each`
- **ECS**: Inline `aws_db_subnet_group` resource in root module referencing `module.networking.data_private_subnet_ids`
- **EKS**: Separate `DB_Subnet_Group` module

Always uses data-tier subnets for RDS placement.

---

## Summary: MUST Follow

1. File naming: `main.tf`, `variables.tf`, `output.tf` (modules); add `local.tf` for root modules
2. Resource labels: `this` for single, descriptive for multi
3. Tags: always `merge(var.tags, { Name = ... })` — merge `common_tags` in `local.tf`
4. Conditional creation: `count` with empty-string check or `for_each` with `toset()`
5. Variable defaults: empty string/list/map, not null
6. Section headers in variables.tf with `# ====` blocks
7. Per-function override pattern with `lookup()`
8. 3-tier subnets for ECS, data-driven networking for Lambda/EKS
9. Secrets: map-based with auto-password generation
10. Outputs: conditional with `length()` check, maps for `for_each`
11. Root modules: `local.tf` transforms variables → locals → module inputs
12. Root module `for_each`: `{ for idx, item in local.list : idx => item }`
13. Cross-module references resolved in `local.tf` (module outputs → next module inputs)
14. ECS: multi-resource module (cluster/task/service), same source invoked multiple times
15. EKS: `create_cluster` boolean flag, separate access entry/policy modules
