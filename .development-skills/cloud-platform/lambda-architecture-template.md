---
description: Comprehensive Terraform code generation guide for Lambda-based serverless architecture on AWS
inclusion: manual
---

# Lambda Architecture Template

## Overview
This steering document provides comprehensive guidance for generating Terraform code for a Lambda-based serverless architecture on AWS. The architecture includes frontend hosting, API Gateway, Lambda functions, RDS database, and all necessary networking and security components.

## Architecture Components

### Frontend Layer
- **CloudFront**: CDN distribution for global content delivery
- **S3 Bucket**: Static website hosting for frontend assets
- **Certificate Manager**: SSL/TLS certificates for HTTPS

### API Layer
- **API Gateway**: RESTful API endpoint management
- **Lambda Functions**: Serverless compute in private subnets
- **Lambda Execution Role**: IAM role with least privilege

### Data Layer
- **RDS Instance**: PostgreSQL/MySQL in private subnet
- **RDS Subnet Group**: Multi-AZ subnet configuration
- **Secrets Manager**: Database credentials storage
- **RDS Security Group**: Database access control

### Network Layer
- **VPC**: Isolated network environment
- **Public Subnets**: For NAT Gateway, Bastion, ALB (minimum 2 AZs)
- **Private Subnets**: For Lambda, RDS (minimum 2 AZs)
- **Internet Gateway**: Public internet access
- **NAT Gateway**: Outbound internet for private subnets (one per AZ for HA)
- **Route Tables**: Public and private routing

### Management & Monitoring
- **EC2 Bastion Host**: Secure access to private resources
- **CloudWatch Log Groups**: Lambda and API Gateway logs
- **CloudWatch Alarms**: Monitoring and alerting
- **S3 Backend Bucket**: Terraform state storage with versioning

### Security
- **Security Groups**: Granular network access control
- **KMS Keys**: Encryption for RDS, S3, Secrets Manager
- **IAM Roles & Policies**: Least privilege access

## Project Structure

```
terraform/
├── environments/
│   ├── dev/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   ├── backend.tf
│   │   └── terraform.auto.tfvars
│   ├── staging/
│   └── prod/
├── modules/
│   ├── networking/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   └── README.md
│   ├── frontend/
│   │   ├── main.tf (CloudFront, S3)
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   └── README.md
│   ├── api-gateway/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   └── README.md
│   ├── lambda/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   └── README.md
│   ├── database/
│   │   ├── main.tf (RDS, Secrets Manager)
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   └── README.md
│   ├── key-management/
│   │   ├── main.tf (TLS key, S3 bucket, KMS encryption)
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   └── README.md
│   ├── bastion/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   └── README.md
│   └── monitoring/
│       ├── main.tf (CloudWatch)
│       ├── variables.tf
│       ├── outputs.tf
│       └── README.md
└── global/
    └── backend/
        ├── main.tf (S3 for state, use_lockfile for locking)
        └── outputs.tf
```

## Module Implementation Guidelines

### 1. Networking Module

**Purpose**: Create VPC with public/private subnets, IGW, NAT Gateway, and route tables

**Key Resources**:
- `aws_vpc` - Enable DNS hostnames and support
- `aws_subnet` - Public subnets (2+ AZs) with map_public_ip_on_launch
- `aws_subnet` - Private subnets (2+ AZs) for Lambda and RDS
- `aws_internet_gateway` - Attached to VPC
- `aws_eip` - For NAT Gateway (one per AZ)
- `aws_nat_gateway` - In each public subnet for HA
- `aws_route_table` - Public route table (0.0.0.0/0 → IGW)
- `aws_route_table` - Private route tables (0.0.0.0/0 → NAT Gateway)
- `aws_route_table_association` - Associate subnets

**Variables**:
```hcl
variable "vpc_cidr" {
  type        = string
  description = "CIDR block for VPC"
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  type        = list(string)
  description = "List of availability zones"
}

variable "public_subnet_cidrs" {
  type        = list(string)
  description = "CIDR blocks for public subnets"
}

variable "private_subnet_cidrs" {
  type        = list(string)
  description = "CIDR blocks for private subnets"
}

variable "enable_nat_gateway" {
  type        = bool
  description = "Enable NAT Gateway for private subnets"
  default     = true
}

variable "single_nat_gateway" {
  type        = bool
  description = "Use single NAT Gateway (not recommended for prod)"
  default     = false
}
```

**Outputs**:
- vpc_id, vpc_cidr_block
- public_subnet_ids, private_subnet_ids
- nat_gateway_ids
- internet_gateway_id

**Security Considerations**:
- Enable VPC Flow Logs to CloudWatch
- Use separate subnets for different tiers
- Implement NACLs for additional security layer

### 2. Frontend Module (CloudFront + S3)

**Purpose**: Host static frontend with CloudFront CDN

**Key Resources**:
- `aws_s3_bucket` - Frontend assets storage
- `aws_s3_bucket_public_access_block` - Block public access
- `aws_s3_bucket_versioning` - Enable versioning
- `aws_s3_bucket_server_side_encryption_configuration` - Enable encryption
- `aws_cloudfront_origin_access_identity` - OAI for S3 access
- `aws_cloudfront_distribution` - CDN configuration
- `aws_s3_bucket_policy` - Allow CloudFront OAI access
- `aws_acm_certificate` - SSL certificate (us-east-1 region)

**Variables**:
```hcl
variable "domain_name" {
  type        = string
  description = "Domain name for CloudFront distribution"
}

variable "acm_certificate_arn" {
  type        = string
  description = "ACM certificate ARN (must be in us-east-1)"
}

variable "price_class" {
  type        = string
  description = "CloudFront price class"
  default     = "PriceClass_100"
}
```

**Security**:
- Enable CloudFront logging to S3
- Use HTTPS only (redirect HTTP to HTTPS)
- Enable WAF for CloudFront (optional)
- Set appropriate cache behaviors

### 3. Lambda Module

**Purpose**: Serverless compute functions in private subnets

**Key Resources**:
- `aws_lambda_function` - Function configuration
- `aws_lambda_permission` - API Gateway invoke permission
- `aws_iam_role` - Lambda execution role
- `aws_iam_role_policy_attachment` - Managed policies
- `aws_iam_policy` - Custom policies (Secrets Manager, RDS access)
- `aws_cloudwatch_log_group` - Function logs
- `aws_security_group` - Lambda security group

**Variables**:
```hcl
variable "function_name" {
  type        = string
  description = "Lambda function name"
}

variable "runtime" {
  type        = string
  description = "Lambda runtime"
  default     = "python3.11"
}

variable "handler" {
  type        = string
  description = "Lambda handler"
  default     = "index.handler"
}

variable "memory_size" {
  type        = number
  description = "Memory allocation in MB"
  default     = 256
}

variable "timeout" {
  type        = number
  description = "Function timeout in seconds"
  default     = 30
}

variable "environment_variables" {
  type        = map(string)
  description = "Environment variables"
  default     = {}
}

variable "vpc_config" {
  type = object({
    subnet_ids         = list(string)
    security_group_ids = list(string)
  })
  description = "VPC configuration for Lambda"
}
```

**IAM Permissions**:
- AWSLambdaVPCAccessExecutionRole (managed policy)
- Custom policy for Secrets Manager read access
- Custom policy for RDS connection (if using IAM auth)
- CloudWatch Logs write permissions

**Security**:
- Deploy in private subnets only
- Use environment variables for configuration (not secrets)
- Fetch secrets from Secrets Manager at runtime
- Enable X-Ray tracing for debugging
- Set reserved concurrent executions to prevent runaway costs

### 4. API Gateway Module

**Purpose**: RESTful API management and Lambda integration

**Key Resources**:
- `aws_api_gateway_rest_api` - API definition
- `aws_api_gateway_resource` - API resources/paths
- `aws_api_gateway_method` - HTTP methods
- `aws_api_gateway_integration` - Lambda integration
- `aws_api_gateway_deployment` - API deployment
- `aws_api_gateway_stage` - Environment stage
- `aws_api_gateway_method_settings` - Logging and throttling
- `aws_cloudwatch_log_group` - API Gateway logs
- `aws_api_gateway_account` - CloudWatch role

**Variables**:
```hcl
variable "api_name" {
  type        = string
  description = "API Gateway name"
}

variable "stage_name" {
  type        = string
  description = "Deployment stage name"
  default     = "prod"
}

variable "throttle_settings" {
  type = object({
    burst_limit = number
    rate_limit  = number
  })
  description = "API throttling settings"
  default = {
    burst_limit = 5000
    rate_limit  = 10000
  }
}
```

**Security**:
- Enable CloudWatch logging (INFO or ERROR level)
- Implement throttling and quotas
- Use API keys for client identification (optional)
- Enable AWS WAF for API Gateway (optional)
- Use custom domain with ACM certificate

### 5. Database Module (RDS)

**Purpose**: Managed relational database in private subnet

**Key Resources**:
- `aws_db_subnet_group` - Multi-AZ subnet group
- `aws_db_instance` - RDS instance
- `aws_security_group` - Database security group
- `aws_secretsmanager_secret` - Database credentials
- `aws_secretsmanager_secret_version` - Secret value
- `aws_kms_key` - Encryption key for RDS
- `aws_kms_alias` - Key alias

**Variables**:
```hcl
variable "engine" {
  type        = string
  description = "Database engine"
  default     = "postgres"
}

variable "engine_version" {
  type        = string
  description = "Database engine version"
  default     = "15.12"
}

variable "instance_class" {
  type        = string
  description = "RDS instance class"
  default     = "db.t3.micro"
}

variable "allocated_storage" {
  type        = number
  description = "Allocated storage in GB"
  default     = 20
}

variable "database_name" {
  type        = string
  description = "Initial database name"
}

variable "master_username" {
  type        = string
  description = "Master username for RDS (must not be a reserved word)"
  default     = "dbadmin"
  validation {
    condition     = !contains(["admin", "user", "root", "postgres", "mysql", "rdsadmin", "master", "public"], lower(var.master_username))
    error_message = "master_username must not be a reserved word (admin, user, root, postgres, mysql, rdsadmin, master, public)."
  }
}

variable "multi_az" {
  type        = bool
  description = "Enable Multi-AZ deployment"
  default     = false
}

variable "backup_retention_period" {
  type        = number
  description = "Backup retention in days"
  default     = 7
}
```

**Security**:
- Deploy in private subnets only
- Enable encryption at rest using KMS
- Enable encryption in transit (SSL/TLS)
- Store credentials in Secrets Manager
- Enable automated backups
- Enable deletion protection for production
- Restrict security group to Lambda and Bastion only

**Secrets Manager Configuration**:
```hcl
# Generate random password
resource "random_password" "db_password" {
  length  = 32
  special = true
}

# Store in Secrets Manager
resource "aws_secretsmanager_secret" "db_credentials" {
  name = "${var.project_name}-${var.environment}-db-credentials"
  kms_key_id = aws_kms_key.rds.id
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id = aws_secretsmanager_secret.db_credentials.id
  secret_string = jsonencode({
    username = var.master_username
    password = random_password.db_password.result
    engine   = var.engine
    host     = aws_db_instance.main.endpoint
    port     = aws_db_instance.main.port
    dbname   = var.database_name
  })
}
```

### 6. Bastion Module

**Purpose**: Secure access to private resources

**Key Resources**:
- `aws_instance` - Bastion EC2 instance
- `aws_security_group` - Bastion security group
- `aws_eip` - Elastic IP for bastion
- `aws_key_pair` - SSH key pair
- `aws_iam_role` - Instance role for Systems Manager
- `aws_iam_instance_profile` - Instance profile

**Variables**:
```hcl
variable "instance_type" {
  type        = string
  description = "Bastion instance type"
  default     = "t3.micro"
}

variable "allowed_cidr_blocks" {
  type        = list(string)
  description = "CIDR blocks allowed to SSH"
}

variable "enable_session_manager" {
  type        = bool
  description = "Enable AWS Systems Manager Session Manager"
  default     = true
}
```

**Security**:
- Deploy in public subnet with EIP
- Restrict SSH access to specific IPs only
- Use Systems Manager Session Manager instead of SSH (recommended)
- Enable CloudWatch logging
- Disable password authentication
- Keep instance patched and updated
- Consider using AWS Systems Manager Fleet Manager

### 7. Monitoring Module (CloudWatch)

**Purpose**: Centralized logging and monitoring

**Key Resources**:
- `aws_cloudwatch_log_group` - Log groups for each service
- `aws_cloudwatch_metric_alarm` - Alarms for critical metrics
- `aws_sns_topic` - Notification topic
- `aws_sns_topic_subscription` - Email/SMS subscriptions

**Key Metrics to Monitor**:
- Lambda: Invocations, Errors, Duration, Throttles
- API Gateway: 4XXError, 5XXError, Latency, Count
- RDS: CPUUtilization, DatabaseConnections, FreeStorageSpace
- NAT Gateway: BytesOutToDestination, PacketsDropCount

**Alarms**:
```hcl
# Lambda error rate alarm
resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  alarm_name          = "${var.function_name}-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "Lambda function error rate"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
```

### 8. Global Backend Module

**Purpose**: Terraform state storage and locking

**Key Resources**:
- `aws_s3_bucket` - State file storage
- `aws_s3_bucket_versioning` - Enable versioning
- `aws_s3_bucket_server_side_encryption_configuration` - KMS encryption
- `aws_s3_bucket_public_access_block` - Block public access
- `aws_kms_key` - Encryption key

Note: State locking uses native S3 lock files (`use_lockfile = true`). DynamoDB table is no longer needed.

**Configuration**:
```hcl
resource "aws_s3_bucket" "terraform_state" {
  bucket = "${var.project_name}-terraform-state"
  
  lifecycle {
    prevent_destroy = true
  }
}
```

## Environment Configuration

### Root Module (environments/dev/main.tf)

```hcl
terraform {
  required_version = ">= 1.6.0"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }
  
  backend "s3" {
    bucket         = "project-terraform-state"
    key            = "lambda-architecture/dev/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    use_lockfile   = true
  }
}

provider "aws" {
  region = var.aws_region
  
  default_tags {
    tags = local.common_tags
  }
}

locals {
  # INTERNAL project naming: zeb-<project>-<resource>-<purpose>-<env>
  # EXTERNAL project naming: <user-provided-convention>
  name_prefix = "zeb-${var.project_name}"
  
  # INTERNAL project tags (mandatory):
  common_tags = {
    app           = var.project_name
    env           = var.environment
    Category      = var.environment
    business-unit = var.business_unit
    owner         = var.owner_email   # Must be @zeb.co for internal
    expire-date   = var.expire_date   # Format: dd/mm/yyyy
    ManagedBy     = "Terraform"
  }
  # EXTERNAL project tags: use user-provided key-value pairs instead
}

# Networking
module "networking" {
  source = "../../modules/networking"
  
  project_name         = var.project_name
  environment          = var.environment
  vpc_cidr             = var.vpc_cidr
  availability_zones   = var.availability_zones
  public_subnet_cidrs  = var.public_subnet_cidrs
  private_subnet_cidrs = var.private_subnet_cidrs
  single_nat_gateway   = var.environment == "dev" ? true : false
}

# Frontend
module "frontend" {
  source = "../../modules/frontend"
  
  project_name        = var.project_name
  environment         = var.environment
  domain_name         = var.domain_name
  acm_certificate_arn = var.acm_certificate_arn
}

# Database
module "database" {
  source = "../../modules/database"
  
  project_name            = var.project_name
  environment             = var.environment
  vpc_id                  = module.networking.vpc_id
  subnet_ids              = module.networking.private_subnet_ids
  engine                  = var.db_engine
  engine_version          = var.db_engine_version
  instance_class          = var.db_instance_class
  allocated_storage       = var.db_allocated_storage
  database_name           = var.db_name
  multi_az                = var.environment == "prod" ? true : false
  backup_retention_period = var.environment == "prod" ? 30 : 7
  allowed_security_groups = [module.lambda.security_group_id, module.bastion.security_group_id]
}

# Lambda
module "lambda" {
  source = "../../modules/lambda"
  
  project_name = var.project_name
  environment  = var.environment
  function_name = "${local.name_prefix}-lambda-api-${var.environment}"
  runtime      = "python3.11"
  handler      = "index.handler"
  memory_size  = var.lambda_memory_size
  timeout      = var.lambda_timeout
  
  vpc_config = {
    subnet_ids         = module.networking.private_subnet_ids
    security_group_ids = []
  }
  
  environment_variables = {
    ENVIRONMENT      = var.environment
    DB_SECRET_ARN    = module.database.secret_arn
    LOG_LEVEL        = var.environment == "prod" ? "INFO" : "DEBUG"
  }
  
  secrets_manager_arns = [module.database.secret_arn]
}

# API Gateway
module "api_gateway" {
  source = "../../modules/api-gateway"
  
  project_name      = var.project_name
  environment       = var.environment
  api_name          = "${local.name_prefix}-apigw-main-${var.environment}"
  stage_name        = var.environment
  lambda_invoke_arn = module.lambda.invoke_arn
  lambda_function_name = module.lambda.function_name
}

# Bastion
module "key_management" {
  source = "../../modules/key-management"

  project_name = var.project_name
  environment  = var.environment
  tags         = local.common_tags
}

module "bastion" {
  source = "../../modules/bastion"

  project_name        = var.project_name
  environment         = var.environment
  vpc_id              = module.networking.vpc_id
  subnet_id           = module.networking.public_subnet_ids[0]
  instance_type       = var.bastion_instance_type
  allowed_cidr_blocks = var.bastion_allowed_cidrs
  key_name            = module.key_management.key_pair_name
}

# Monitoring
module "monitoring" {
  source = "../../modules/monitoring"
  
  project_name         = var.project_name
  environment          = var.environment
  lambda_function_name = module.lambda.function_name
  api_gateway_name     = module.api_gateway.api_name
  db_instance_id       = module.database.instance_id
  alert_email          = var.alert_email
}
```

## Security Groups Configuration

### Lambda Security Group
```hcl
resource "aws_security_group" "lambda" {
  name_description = "${var.project_name}-${var.environment}-lambda-sg"
  vpc_id          = var.vpc_id
  
  # Outbound to RDS
  egress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.rds.id]
    description     = "PostgreSQL access"
  }
  
  # Outbound to internet via NAT (for Secrets Manager, etc.)
  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS outbound"
  }
}
```

### RDS Security Group
```hcl
resource "aws_security_group" "rds" {
  name_description = "${var.project_name}-${var.environment}-rds-sg"
  vpc_id          = var.vpc_id
  
  # Inbound from Lambda
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
    description     = "Lambda access"
  }
  
  # Inbound from Bastion
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.bastion.id]
    description     = "Bastion access"
  }
}
```

### Bastion Security Group
```hcl
resource "aws_security_group" "bastion" {
  name_description = "${var.project_name}-${var.environment}-bastion-sg"
  vpc_id          = var.vpc_id
  
  # Inbound SSH (restricted)
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
    description = "SSH access from allowed IPs"
  }
  
  # Outbound to RDS
  egress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.rds.id]
    description     = "PostgreSQL access"
  }
  
  # Outbound HTTPS for updates
  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS outbound"
  }
}
```

## Root Module Variables (environments/dev/variables.tf)

```hcl
# Project Configuration
variable "project_name" {
  type        = string
  description = "Project name used for resource naming"
}

variable "project_type" {
  type        = string
  description = "Project type: internal or external"
  validation {
    condition     = contains(["internal", "external"], var.project_type)
    error_message = "Project type must be internal or external."
  }
}

variable "business_unit" {
  type        = string
  description = "Business unit (required for internal projects, used in tagging)"
  default     = ""
}

variable "expire_date" {
  type        = string
  description = "Resource expiration date in dd/mm/yyyy format (required for internal projects)"
  default     = ""
}

variable "environment" {
  type        = string
  description = "Environment name (dev, staging, prod)"
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "aws_region" {
  type        = string
  description = "AWS region for resources"
  default     = "us-east-1"
}

variable "owner_email" {
  type        = string
  description = "Owner email for resource tagging (must be @zeb.co for internal projects)"
}

# Networking
variable "vpc_cidr" {
  type        = string
  description = "CIDR block for VPC"
}

variable "availability_zones" {
  type        = list(string)
  description = "List of availability zones"
}

variable "public_subnet_cidrs" {
  type        = list(string)
  description = "CIDR blocks for public subnets"
}

variable "private_subnet_cidrs" {
  type        = list(string)
  description = "CIDR blocks for private subnets"
}

# Frontend
variable "domain_name" {
  type        = string
  description = "Domain name for CloudFront distribution"
}

variable "acm_certificate_arn" {
  type        = string
  description = "ACM certificate ARN (must be in us-east-1)"
}

# Database
variable "db_engine" {
  type        = string
  description = "Database engine (postgres or mysql)"
  default     = "postgres"
}

variable "db_engine_version" {
  type        = string
  description = "Database engine version"
}

variable "db_instance_class" {
  type        = string
  description = "RDS instance class"
}

variable "db_allocated_storage" {
  type        = number
  description = "Allocated storage in GB"
}

variable "db_name" {
  type        = string
  description = "Initial database name"
}

# Lambda
variable "lambda_memory_size" {
  type        = number
  description = "Lambda memory allocation in MB"
  default     = 256
}

variable "lambda_timeout" {
  type        = number
  description = "Lambda timeout in seconds"
  default     = 30
}

# Bastion
variable "bastion_instance_type" {
  type        = string
  description = "Bastion instance type"
  default     = "t3.micro"
}

variable "bastion_allowed_cidrs" {
  type        = list(string)
  description = "CIDR blocks allowed to SSH to bastion"
}

variable "bastion_key_name" {
  type        = string
  description = "EC2 key pair name for bastion"
}

# Monitoring
variable "alert_email" {
  type        = string
  description = "Email address for CloudWatch alerts"
}
```

## Variables Template (terraform.auto.tfvars)

```hcl
# Project Configuration
project_name  = "myapp"
project_type  = "internal"          # "internal" or "external"
business_unit = "platform"          # Internal: business unit for tagging
expire_date   = "31/12/2027"        # Internal: resource expiration date (dd/mm/yyyy)
environment   = "dev"
aws_region    = "us-east-1"
owner_email   = "team@zeb.co"       # Internal: must be @zeb.co

# Networking
vpc_cidr             = "10.20.0.0/24"
availability_zones   = ["us-east-1a", "us-east-1b"]
public_subnet_cidrs  = ["10.20.0.0/27", "10.20.0.32/27"]
private_subnet_cidrs = ["10.20.0.64/27", "10.20.0.96/27"]

# Frontend
domain_name         = "dev.example.com"
# acm_certificate_arn = "arn:aws:acm:us-east-1:ACCOUNT:certificate/CERT-ID"

# Database
db_engine           = "postgres"
db_engine_version   = "15.12"
db_instance_class   = "db.t3.micro"
db_allocated_storage = 20
db_name             = "appdb"

# Lambda
lambda_memory_size = 256
lambda_timeout     = 30

# Bastion
bastion_instance_type = "t3.micro"
bastion_allowed_cidrs = ["1.2.3.4/32"]  # Your office IP
```

## Deployment Steps

1. **Initialize Backend** (one-time):
   ```bash
   cd global/backend
   terraform init
   terraform apply
   ```

2. **Deploy Environment**:
   ```bash
   cd environments/dev
   terraform init
   terraform plan -out=plan.tfplan
   terraform apply plan.tfplan
   ```

3. **Verify Deployment**:
   - Check CloudFront distribution status
   - Test API Gateway endpoint
   - Verify Lambda function execution
   - Connect to RDS via Bastion
   - Review CloudWatch logs

## Best Practices Applied

- ✅ Remote state with S3 and native lock file
- ✅ Encryption at rest for all data stores
- ✅ Secrets stored in Secrets Manager
- ✅ Least privilege IAM roles
- ✅ Private subnets for compute and data
- ✅ Multi-AZ for high availability (prod)
- ✅ Comprehensive tagging strategy
- ✅ CloudWatch logging and monitoring
- ✅ Security groups with minimal access
- ✅ VPC Flow Logs enabled
- ✅ Automated backups configured
- ✅ Version pinning for providers
- ✅ Modular and reusable code structure

## Cost Optimization

### Development Environment
- Single NAT Gateway
- Single-AZ RDS
- Smaller instance sizes
- Reduced backup retention

### Production Environment
- Multi-AZ NAT Gateways
- Multi-AZ RDS with read replicas
- Reserved instances for predictable workloads
- Extended backup retention
- Enhanced monitoring

## Troubleshooting

### Lambda Cannot Connect to RDS
- Verify Lambda is in private subnet
- Check security group rules
- Verify NAT Gateway is working
- Check RDS endpoint in Secrets Manager

### API Gateway 502 Errors
- Check Lambda function logs in CloudWatch
- Verify Lambda timeout is sufficient
- Check Lambda execution role permissions

### Bastion Cannot Connect to RDS
- Verify security group allows bastion → RDS
- Check RDS endpoint and port
- Verify bastion is in public subnet with EIP

## Additional Considerations

### Lambda Cold Starts
- Use provisioned concurrency for critical functions
- Optimize function package size
- Consider Lambda SnapStart for Java

### API Gateway Caching
- Enable caching for GET requests
- Set appropriate TTL values
- Invalidate cache on updates

### RDS Performance
- Enable Performance Insights
- Use appropriate instance class
- Configure connection pooling in Lambda
- Consider RDS Proxy for connection management

### Disaster Recovery
- Enable automated backups
- Test restore procedures
- Document RTO/RPO requirements
- Consider cross-region replication for critical data

## Security Checklist

- [ ] All data encrypted at rest
- [ ] All data encrypted in transit
- [ ] No hard-coded secrets
- [ ] Least privilege IAM policies
- [ ] Security groups follow principle of least access
- [ ] VPC Flow Logs enabled
- [ ] CloudTrail enabled
- [ ] MFA enabled for production access
- [ ] Regular security scanning (Checkov, tfsec)
- [ ] Secrets rotation configured
- [ ] Backup encryption enabled
- [ ] State file encrypted

## Maintenance

### Regular Tasks
- Review and rotate secrets quarterly
- Update Lambda runtimes when deprecated
- Patch bastion host monthly
- Review CloudWatch logs for errors
- Optimize costs based on usage patterns
- Update Terraform and provider versions
- Review and update security group rules
- Test disaster recovery procedures

### Monitoring Dashboards
Create CloudWatch dashboards for:
- API Gateway metrics (requests, latency, errors)
- Lambda metrics (invocations, duration, errors)
- RDS metrics (connections, CPU, storage)
- Cost and usage metrics

