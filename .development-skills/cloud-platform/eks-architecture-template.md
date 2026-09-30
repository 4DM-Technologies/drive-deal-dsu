---
description: Comprehensive Terraform code generation guide for EKS-based Kubernetes architecture on AWS
inclusion: manual
---

# EKS Architecture Template

## Overview
This steering document provides comprehensive guidance for generating Terraform code for an EKS (Elastic Kubernetes Service) based architecture on AWS. The architecture includes frontend hosting, EKS cluster with managed node groups, Application Load Balancer, API Gateway with Lambda Authorizer, RDS with RDS Proxy, and all necessary networking and security components.

## Architecture Components

### Frontend Layer
- **CloudFront**: CDN distribution for global content delivery
- **S3 Bucket**: Static website hosting for frontend assets
- **Certificate Manager**: SSL/TLS certificates for HTTPS

### API Layer
- **API Gateway**: RESTful API endpoint management
- **Lambda Authorizer**: Custom authorization logic for API Gateway
- **Application Load Balancer**: Traffic distribution to EKS pods

### Compute Layer
- **EKS Cluster**: Kubernetes control plane
- **EKS Managed Node Group**: Worker nodes for running pods
- **Pods**: Application containers running on EKS
- **ECR Repository**: Private Docker image registry
- **EKS Add-ons**: CoreDNS, kube-proxy, vpc-cni, ebs-csi-driver

### Data Layer
- **RDS Instance**: PostgreSQL/MySQL in private subnet
- **RDS Proxy**: Connection pooling and management
- **RDS Subnet Group**: Multi-AZ subnet configuration
- **Secrets Manager**: Database credentials and application secrets

### Network Layer
- **VPC**: Isolated network environment
- **Public Subnets**: For ALB, NAT Gateway, Bastion (minimum 2 AZs)
- **Private Subnets**: For EKS nodes, RDS (minimum 2 AZs)
- **Internet Gateway**: Public internet access
- **NAT Gateway**: Outbound internet for private subnets (one per AZ for HA)
- **Route Tables**: Public and private routing

### Management & Monitoring
- **EC2 Bastion Host**: Secure access to private resources
- **CloudWatch Log Groups**: EKS control plane, pod, and ALB logs
- **CloudWatch Alarms**: Monitoring and alerting
- **S3 Backend Bucket**: Terraform state storage with versioning

### Security
- **Security Groups**: ALB, EKS cluster, EKS nodes, RDS, RDS Proxy, Bastion
- **KMS Keys**: Encryption for EKS secrets, RDS, S3, Secrets Manager
- **IAM Roles & Policies**: Cluster role, node role, pod roles (IRSA)
- **OIDC Provider**: For IAM Roles for Service Accounts (IRSA)


## Project Structure

```
terraform/
├── environments/
│   ├── dev/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   ├── backend.tf
│   │   └── terraform.tfvars
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
│   ├── ecr/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   └── README.md
│   ├── eks/
│   │   ├── main.tf (Cluster, Node Group, OIDC)
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   └── README.md
│   ├── alb/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   └── README.md
│   ├── api-gateway/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   └── README.md
│   ├── lambda-authorizer/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   └── README.md
│   ├── database/
│   │   ├── main.tf (RDS, RDS Proxy, Secrets Manager)
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

**Purpose**: Create VPC with public/private subnets optimized for EKS

**Key Resources**:
- `aws_vpc` - Enable DNS hostnames and support
- `aws_subnet` - Public subnets (2+ AZs) with proper tags for EKS
- `aws_subnet` - Private subnets (2+ AZs) for EKS nodes and RDS
- `aws_internet_gateway` - Attached to VPC
- `aws_eip` - For NAT Gateway (one per AZ)
- `aws_nat_gateway` - In each public subnet for HA
- `aws_route_table` - Public route table (0.0.0.0/0 → IGW)
- `aws_route_table` - Private route tables (0.0.0.0/0 → NAT Gateway)
- `aws_route_table_association` - Associate subnets

**EKS-Specific Subnet Tags**:
```hcl
# Public subnets
tags = {
  "kubernetes.io/role/elb"                    = "1"
  "kubernetes.io/cluster/${var.cluster_name}" = "shared"
}

# Private subnets
tags = {
  "kubernetes.io/role/internal-elb"           = "1"
  "kubernetes.io/cluster/${var.cluster_name}" = "shared"
}
```

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

variable "cluster_name" {
  type        = string
  description = "EKS cluster name for subnet tagging"
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
- Use separate subnets for EKS nodes and RDS
- Implement NACLs for additional security layer
- Proper tagging for EKS subnet discovery


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

### 3. ECR Module

**Purpose**: Private Docker image registry for container images

**Key Resources**:
- `aws_ecr_repository` - Container image repository
- `aws_ecr_lifecycle_policy` - Image retention policy
- `aws_ecr_repository_policy` - Access control policy
- `aws_kms_key` - Encryption key for images
- `aws_kms_alias` - Key alias

**Variables**:
```hcl
variable "repository_name" {
  type        = string
  description = "ECR repository name"
}

variable "image_tag_mutability" {
  type        = string
  description = "Image tag mutability (MUTABLE or IMMUTABLE)"
  default     = "MUTABLE"
}

variable "scan_on_push" {
  type        = bool
  description = "Enable image scanning on push"
  default     = true
}
```

**Security**:
- Enable encryption at rest using KMS
- Enable image scanning for vulnerabilities
- Implement lifecycle policies to manage costs
- Use IAM policies for access control
- Enable immutable tags for production images

**Outputs**:
- repository_url
- repository_arn
- registry_id


### 4. EKS Module

**Purpose**: Kubernetes cluster with managed node groups

**Key Resources**:
- `aws_eks_cluster` - EKS control plane
- `aws_eks_node_group` - Managed worker nodes
- `aws_eks_addon` - CoreDNS, kube-proxy, vpc-cni, ebs-csi-driver
- `aws_iam_role` - EKS cluster role
- `aws_iam_role` - EKS node group role
- `aws_iam_role_policy_attachment` - Managed policies
- `aws_iam_openid_connect_provider` - OIDC provider for IRSA
- `aws_security_group` - EKS cluster security group
- `aws_security_group` - EKS node security group
- `aws_kms_key` - Encryption key for EKS secrets
- `aws_cloudwatch_log_group` - Control plane logs

**Variables**:
```hcl
variable "cluster_name" {
  type        = string
  description = "EKS cluster name"
}

variable "cluster_version" {
  type        = string
  description = "Kubernetes version"
  default     = "1.28"
}

variable "node_group_config" {
  type = object({
    desired_size   = number
    min_size       = number
    max_size       = number
    instance_types = list(string)
    capacity_type  = string
    disk_size      = number
  })
  description = "Node group configuration"
  default = {
    desired_size   = 2
    min_size       = 1
    max_size       = 4
    instance_types = ["t3.medium"]
    capacity_type  = "ON_DEMAND"
    disk_size      = 20
  }
}

variable "enabled_cluster_log_types" {
  type        = list(string)
  description = "List of control plane logging types"
  default     = ["api", "audit", "authenticator", "controllerManager", "scheduler"]
}

variable "cluster_endpoint_private_access" {
  type        = bool
  description = "Enable private API server endpoint"
  default     = true
}

variable "cluster_endpoint_public_access" {
  type        = bool
  description = "Enable public API server endpoint"
  default     = true
}

variable "cluster_endpoint_public_access_cidrs" {
  type        = list(string)
  description = "CIDR blocks that can access public endpoint"
  default     = ["0.0.0.0/0"]
}
```

**EKS Cluster IAM Role Policies**:
- AmazonEKSClusterPolicy (managed)
- AmazonEKSVPCResourceController (managed)

**EKS Node Group IAM Role Policies**:
- AmazonEKSWorkerNodePolicy (managed)
- AmazonEKS_CNI_Policy (managed)
- AmazonEC2ContainerRegistryReadOnly (managed)
- AmazonSSMManagedInstanceCore (managed, for Session Manager)

**EKS Add-ons**:
```hcl
resource "aws_eks_addon" "coredns" {
  cluster_name = aws_eks_cluster.main.name
  addon_name   = "coredns"
  addon_version = "v1.10.1-eksbuild.6"
}

resource "aws_eks_addon" "kube_proxy" {
  cluster_name = aws_eks_cluster.main.name
  addon_name   = "kube-proxy"
  addon_version = "v1.28.2-eksbuild.2"
}

resource "aws_eks_addon" "vpc_cni" {
  cluster_name = aws_eks_cluster.main.name
  addon_name   = "vpc-cni"
  addon_version = "v1.15.1-eksbuild.1"
}

resource "aws_eks_addon" "ebs_csi_driver" {
  cluster_name = aws_eks_cluster.main.name
  addon_name   = "aws-ebs-csi-driver"
  addon_version = "v1.25.0-eksbuild.1"
}
```

**OIDC Provider for IRSA**:
```hcl
data "tls_certificate" "cluster" {
  url = aws_eks_cluster.main.identity[0].oidc[0].issuer
}

resource "aws_iam_openid_connect_provider" "cluster" {
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.cluster.certificates[0].sha1_fingerprint]
  url             = aws_eks_cluster.main.identity[0].oidc[0].issuer
}
```

**Security**:
- Enable secrets encryption using KMS
- Enable control plane logging
- Restrict public endpoint access (use VPN or specific IPs)
- Use private endpoint for production
- Enable security groups for pods
- Implement Pod Security Standards
- Use IRSA for pod IAM permissions

**Outputs**:
- cluster_id
- cluster_arn
- cluster_endpoint
- cluster_certificate_authority_data
- cluster_security_group_id
- node_security_group_id
- oidc_provider_arn
- oidc_provider_url


### 5. Application Load Balancer Module

**Purpose**: Distribute traffic to EKS pods via AWS Load Balancer Controller

**Key Resources**:
- `aws_lb` - Application Load Balancer
- `aws_lb_target_group` - Target group for pods
- `aws_lb_listener` - HTTPS listener (port 443)
- `aws_lb_listener` - HTTP listener (port 80, redirect to HTTPS)
- `aws_security_group` - ALB security group
- `aws_acm_certificate` - SSL certificate

**Note**: The AWS Load Balancer Controller (installed via Helm in EKS) will manage ALB creation based on Kubernetes Ingress resources. This module provides the base ALB if needed for non-Kubernetes workloads.

**Variables**:
```hcl
variable "alb_name" {
  type        = string
  description = "Application Load Balancer name"
}

variable "internal" {
  type        = bool
  description = "Whether ALB is internal"
  default     = false
}

variable "health_check" {
  type = object({
    enabled             = bool
    healthy_threshold   = number
    interval            = number
    matcher             = string
    path                = string
    port                = string
    protocol            = string
    timeout             = number
    unhealthy_threshold = number
  })
  description = "Health check configuration"
  default = {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 2
  }
}
```

**Security**:
- Use HTTPS only (redirect HTTP to HTTPS)
- Enable access logs to S3
- Enable deletion protection for production
- Use security groups to restrict access
- Enable WAF for additional protection (optional)

**Outputs**:
- alb_arn
- alb_dns_name
- alb_zone_id
- target_group_arn
- security_group_id

### 6. API Gateway Module

**Purpose**: RESTful API management with Lambda Authorizer

**Key Resources**:
- `aws_api_gateway_rest_api` - API definition
- `aws_api_gateway_resource` - API resources/paths
- `aws_api_gateway_method` - HTTP methods
- `aws_api_gateway_integration` - ALB integration (HTTP_PROXY)
- `aws_api_gateway_authorizer` - Lambda authorizer
- `aws_api_gateway_deployment` - API deployment
- `aws_api_gateway_stage` - Environment stage
- `aws_api_gateway_method_settings` - Logging and throttling
- `aws_cloudwatch_log_group` - API Gateway logs

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

variable "authorizer_lambda_arn" {
  type        = string
  description = "Lambda authorizer function ARN"
}

variable "alb_listener_arn" {
  type        = string
  description = "ALB listener ARN for integration"
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

**Integration with ALB**:
```hcl
resource "aws_api_gateway_integration" "alb" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.proxy.id
  http_method = aws_api_gateway_method.proxy.http_method

  type                    = "HTTP_PROXY"
  integration_http_method = "ANY"
  uri                     = "http://${var.alb_dns_name}/{proxy}"
  
  request_parameters = {
    "integration.request.path.proxy" = "method.request.path.proxy"
  }
}
```

**Security**:
- Enable CloudWatch logging (INFO or ERROR level)
- Implement throttling and quotas
- Use Lambda authorizer for authentication
- Enable AWS WAF for API Gateway (optional)
- Use custom domain with ACM certificate

**Outputs**:
- api_id
- api_endpoint
- api_execution_arn
- stage_arn


### 7. Lambda Authorizer Module

**Purpose**: Custom authorization logic for API Gateway

**Key Resources**:
- `aws_lambda_function` - Authorizer function
- `aws_lambda_permission` - API Gateway invoke permission
- `aws_iam_role` - Lambda execution role
- `aws_iam_role_policy_attachment` - Managed policies
- `aws_iam_policy` - Custom policies
- `aws_cloudwatch_log_group` - Function logs
- `aws_security_group` - Lambda security group (if VPC-enabled)

**Variables**:
```hcl
variable "function_name" {
  type        = string
  description = "Lambda authorizer function name"
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
  default     = 10
}

variable "environment_variables" {
  type        = map(string)
  description = "Environment variables"
  default     = {}
}
```

**Example Authorizer Code** (Python):
```python
import json
import jwt
from typing import Dict, Any

def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda authorizer for API Gateway
    Validates JWT tokens and returns IAM policy
    """
    token = event['authorizationToken'].replace('Bearer ', '')
    method_arn = event['methodArn']
    
    try:
        # Validate JWT token
        decoded = jwt.decode(token, 'your-secret-key', algorithms=['HS256'])
        principal_id = decoded['sub']
        
        # Generate IAM policy
        policy = generate_policy(principal_id, 'Allow', method_arn)
        
        # Add context data (available in backend)
        policy['context'] = {
            'userId': principal_id,
            'email': decoded.get('email', ''),
            'role': decoded.get('role', 'user')
        }
        
        return policy
        
    except jwt.ExpiredSignatureError:
        raise Exception('Unauthorized: Token expired')
    except jwt.InvalidTokenError:
        raise Exception('Unauthorized: Invalid token')

def generate_policy(principal_id: str, effect: str, resource: str) -> Dict[str, Any]:
    """Generate IAM policy document"""
    return {
        'principalId': principal_id,
        'policyDocument': {
            'Version': '2012-10-17',
            'Statement': [{
                'Action': 'execute-api:Invoke',
                'Effect': effect,
                'Resource': resource
            }]
        }
    }
```

**IAM Permissions**:
- AWSLambdaBasicExecutionRole (managed policy)
- CloudWatch Logs write permissions
- Secrets Manager read access (if needed)

**Security**:
- Store JWT secrets in Secrets Manager
- Enable CloudWatch logging
- Set appropriate timeout (keep it low, 5-10 seconds)
- Use environment variables for configuration
- Implement token caching in API Gateway

**Outputs**:
- function_arn
- function_name
- invoke_arn
- security_group_id


### 8. Database Module (RDS + RDS Proxy)

**Purpose**: Managed relational database with connection pooling

**Key Resources**:
- `aws_db_subnet_group` - Multi-AZ subnet group
- `aws_db_instance` - RDS instance
- `aws_db_proxy` - RDS Proxy for connection pooling
- `aws_db_proxy_default_target_group` - Proxy target group
- `aws_db_proxy_target` - RDS instance target
- `aws_security_group` - RDS security group
- `aws_security_group` - RDS Proxy security group
- `aws_secretsmanager_secret` - Database credentials
- `aws_secretsmanager_secret_version` - Secret value
- `aws_kms_key` - Encryption key for RDS
- `aws_kms_alias` - Key alias
- `aws_iam_role` - RDS Proxy IAM role
- `random_password` - Generate secure password

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
  default     = "15.4"
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

variable "max_allocated_storage" {
  type        = number
  description = "Maximum storage for autoscaling"
  default     = 100
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

variable "enable_rds_proxy" {
  type        = bool
  description = "Enable RDS Proxy"
  default     = true
}

variable "rds_proxy_config" {
  type = object({
    max_connections_percent        = number
    max_idle_connections_percent   = number
    connection_borrow_timeout      = number
    session_pinning_filters        = list(string)
  })
  description = "RDS Proxy configuration"
  default = {
    max_connections_percent       = 100
    max_idle_connections_percent  = 50
    connection_borrow_timeout     = 120
    session_pinning_filters       = []
  }
}
```

**RDS Proxy Configuration**:
```hcl
resource "aws_db_proxy" "main" {
  name                   = "${var.project_name}-${var.environment}-proxy"
  engine_family          = "POSTGRESQL"
  auth {
    auth_scheme = "SECRETS"
    iam_auth    = "REQUIRED"
    secret_arn  = aws_secretsmanager_secret.db_credentials.arn
  }
  
  role_arn               = aws_iam_role.rds_proxy.arn
  vpc_subnet_ids         = var.subnet_ids
  require_tls            = true
  
  tags = var.tags
}

resource "aws_db_proxy_default_target_group" "main" {
  db_proxy_name = aws_db_proxy.main.name
  
  connection_pool_config {
    max_connections_percent      = var.rds_proxy_config.max_connections_percent
    max_idle_connections_percent = var.rds_proxy_config.max_idle_connections_percent
    connection_borrow_timeout    = var.rds_proxy_config.connection_borrow_timeout
    session_pinning_filters      = var.rds_proxy_config.session_pinning_filters
  }
}

resource "aws_db_proxy_target" "main" {
  db_proxy_name         = aws_db_proxy.main.name
  target_group_name     = aws_db_proxy_default_target_group.main.name
  db_instance_identifier = aws_db_instance.main.id
}
```

**RDS Proxy IAM Role**:
```hcl
resource "aws_iam_role" "rds_proxy" {
  name = "${var.project_name}-${var.environment}-rds-proxy-role"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "rds.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy" "rds_proxy_secrets" {
  name = "secrets-access"
  role = aws_iam_role.rds_proxy.id
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "secretsmanager:GetSecretValue"
      ]
      Resource = aws_secretsmanager_secret.db_credentials.arn
    }]
  })
}
```

**Security**:
- Deploy in private subnets only
- Enable encryption at rest using KMS
- Enable encryption in transit (SSL/TLS)
- Store credentials in Secrets Manager
- Enable automated backups
- Enable deletion protection for production
- Restrict security groups to EKS nodes and RDS Proxy only
- Enable Performance Insights
- Enable Enhanced Monitoring
- Use RDS Proxy for connection pooling
- Enable IAM authentication for RDS Proxy

**Outputs**:
- instance_id
- instance_endpoint
- instance_arn
- proxy_endpoint
- proxy_arn
- secret_arn
- security_group_id
- proxy_security_group_id


### 9. Bastion Module

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

### 10. Monitoring Module (CloudWatch)

**Purpose**: Centralized logging and monitoring

**Key Resources**:
- `aws_cloudwatch_log_group` - Log groups for each service
- `aws_cloudwatch_metric_alarm` - Alarms for critical metrics
- `aws_sns_topic` - Notification topic
- `aws_sns_topic_subscription` - Email/SMS subscriptions
- `aws_cloudwatch_dashboard` - Monitoring dashboard

**Key Metrics to Monitor**:
- EKS Cluster: Node count, pod count, CPU/memory utilization
- EKS Nodes: CPUUtilization, MemoryUtilization, DiskUtilization
- ALB: RequestCount, TargetResponseTime, HTTPCode_Target_5XX_Count, HealthyHostCount
- RDS: CPUUtilization, DatabaseConnections, FreeStorageSpace, ReadLatency, WriteLatency
- RDS Proxy: DatabaseConnectionsCurrentlyBorrowed, DatabaseConnectionsCurrentlyInTransaction
- API Gateway: Count, Latency, 4XXError, 5XXError
- Lambda Authorizer: Invocations, Errors, Duration

**EKS-Specific Alarms**:
```hcl
# Node CPU utilization alarm
resource "aws_cloudwatch_metric_alarm" "node_cpu_high" {
  alarm_name          = "${var.cluster_name}-node-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "node_cpu_utilization"
  namespace           = "ContainerInsights"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "EKS node CPU utilization is high"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    ClusterName = var.cluster_name
  }
}

# Pod count alarm
resource "aws_cloudwatch_metric_alarm" "pod_count_low" {
  alarm_name          = "${var.cluster_name}-pod-count-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "pod_number_of_running_pods"
  namespace           = "ContainerInsights"
  period              = 60
  statistic           = "Average"
  threshold           = 1
  alarm_description   = "No pods running in cluster"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    ClusterName = var.cluster_name
  }
}
```

**Container Insights**:
Enable Container Insights for EKS cluster to get detailed metrics:
```bash
aws eks update-cluster-config \
  --name ${cluster_name} \
  --logging '{"clusterLogging":[{"types":["api","audit","authenticator","controllerManager","scheduler"],"enabled":true}]}'
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
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.23"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.11"
    }
    kubectl = {
      source  = "gavinbunney/kubectl"
      version = "~> 1.14"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }
  
  backend "s3" {
    bucket         = "project-terraform-state"
    key            = "eks-architecture/dev/terraform.tfstate"
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

provider "kubernetes" {
  host                   = module.eks.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)
  
  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args = ["eks", "get-token", "--cluster-name", module.eks.cluster_id]
  }
}

provider "helm" {
  kubernetes {
    host                   = module.eks.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)
    
    exec {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args = ["eks", "get-token", "--cluster-name", module.eks.cluster_id]
    }
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
  cluster_name         = "${local.name_prefix}-eks-cluster-${var.environment}"
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

# ECR
module "ecr" {
  source = "../../modules/ecr"
  
  project_name         = var.project_name
  environment          = var.environment
  repository_name      = "${local.name_prefix}-ecr-app-${var.environment}"
  image_tag_mutability = var.environment == "prod" ? "IMMUTABLE" : "MUTABLE"
  scan_on_push         = true
}

# Database with RDS Proxy
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
  enable_rds_proxy        = true
  allowed_security_groups = [module.eks.node_security_group_id, module.bastion.security_group_id]
}

# EKS Cluster
module "eks" {
  source = "../../modules/eks"
  
  project_name    = var.project_name
  environment     = var.environment
  vpc_id          = module.networking.vpc_id
  subnet_ids      = module.networking.private_subnet_ids
  cluster_name    = "${local.name_prefix}-eks-cluster-${var.environment}"
  cluster_version = var.eks_cluster_version
  
  node_group_config = {
    desired_size   = var.eks_node_desired_size
    min_size       = var.eks_node_min_size
    max_size       = var.eks_node_max_size
    instance_types = var.eks_node_instance_types
    capacity_type  = var.environment == "prod" ? "ON_DEMAND" : "SPOT"
    disk_size      = 20
  }
  
  cluster_endpoint_private_access = true
  cluster_endpoint_public_access  = var.environment == "prod" ? false : true
  cluster_endpoint_public_access_cidrs = var.eks_public_access_cidrs
}

# Application Load Balancer
module "alb" {
  source = "../../modules/alb"
  
  project_name        = var.project_name
  environment         = var.environment
  vpc_id              = module.networking.vpc_id
  subnet_ids          = module.networking.public_subnet_ids
  alb_name            = "${local.name_prefix}-alb-main-${var.environment}"
  internal            = false
  acm_certificate_arn = var.acm_certificate_arn
}

# Lambda Authorizer
module "lambda_authorizer" {
  source = "../../modules/lambda-authorizer"
  
  project_name    = var.project_name
  environment     = var.environment
  function_name   = "${local.name_prefix}-lambda-authorizer-${var.environment}"
  runtime         = "python3.11"
  handler         = "index.handler"
  memory_size     = 256
  timeout         = 10
  
  environment_variables = {
    ENVIRONMENT = var.environment
    LOG_LEVEL   = var.environment == "prod" ? "INFO" : "DEBUG"
  }
}

# API Gateway
module "api_gateway" {
  source = "../../modules/api-gateway"
  
  project_name          = var.project_name
  environment           = var.environment
  api_name              = "${local.name_prefix}-apigw-main-${var.environment}"
  stage_name            = var.environment
  authorizer_lambda_arn = module.lambda_authorizer.function_arn
  alb_listener_arn      = module.alb.listener_arn
  alb_dns_name          = module.alb.alb_dns_name
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
  
  project_name      = var.project_name
  environment       = var.environment
  eks_cluster_name  = module.eks.cluster_name
  alb_arn_suffix    = module.alb.alb_arn_suffix
  db_instance_id    = module.database.instance_id
  db_proxy_name     = module.database.proxy_name
  api_gateway_name  = module.api_gateway.api_name
  alert_email       = var.alert_email
}
```


## Security Groups Configuration

### EKS Cluster Security Group
```hcl
resource "aws_security_group" "eks_cluster" {
  name        = "${var.project_name}-${var.environment}-eks-cluster-sg"
  description = "Security group for EKS cluster control plane"
  vpc_id      = var.vpc_id

  # Inbound from worker nodes
  ingress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.eks_nodes.id]
    description     = "HTTPS from worker nodes"
  }

  # Outbound to worker nodes
  egress {
    from_port       = 1025
    to_port         = 65535
    protocol        = "tcp"
    security_groups = [aws_security_group.eks_nodes.id]
    description     = "To worker nodes"
  }

  # Outbound to worker nodes kubelet
  egress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.eks_nodes.id]
    description     = "HTTPS to worker nodes"
  }
}
```

### EKS Node Security Group
```hcl
resource "aws_security_group" "eks_nodes" {
  name        = "${var.project_name}-${var.environment}-eks-nodes-sg"
  description = "Security group for EKS worker nodes"
  vpc_id      = var.vpc_id

  # Inbound from cluster control plane
  ingress {
    from_port       = 1025
    to_port         = 65535
    protocol        = "tcp"
    security_groups = [aws_security_group.eks_cluster.id]
    description     = "From EKS control plane"
  }

  # Inbound from cluster control plane (HTTPS)
  ingress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.eks_cluster.id]
    description     = "HTTPS from EKS control plane"
  }

  # Inbound node-to-node communication
  ingress {
    from_port = 0
    to_port   = 0
    protocol  = "-1"
    self      = true
    description = "Node to node communication"
  }

  # Inbound from ALB
  ingress {
    from_port       = 30000
    to_port         = 32767
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
    description     = "NodePort range from ALB"
  }

  # Outbound all (for pulling images, DNS, etc.)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "All outbound traffic"
  }
}
```

### ALB Security Group
```hcl
resource "aws_security_group" "alb" {
  name        = "${var.project_name}-${var.environment}-alb-sg"
  description = "Security group for Application Load Balancer"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTP from internet"
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS from internet"
  }

  egress {
    from_port       = 30000
    to_port         = 32767
    protocol        = "tcp"
    security_groups = [aws_security_group.eks_nodes.id]
    description     = "To EKS nodes NodePort range"
  }
}
```

### RDS Security Group
```hcl
resource "aws_security_group" "rds" {
  name        = "${var.project_name}-${var.environment}-rds-sg"
  description = "Security group for RDS"
  vpc_id      = var.vpc_id

  # Inbound from RDS Proxy only
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.rds_proxy.id]
    description     = "RDS Proxy access"
  }

  # Inbound from Bastion (direct access for admin)
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.bastion.id]
    description     = "Bastion access"
  }
}
```

### RDS Proxy Security Group
```hcl
resource "aws_security_group" "rds_proxy" {
  name        = "${var.project_name}-${var.environment}-rds-proxy-sg"
  description = "Security group for RDS Proxy"
  vpc_id      = var.vpc_id

  # Inbound from EKS nodes
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.eks_nodes.id]
    description     = "EKS nodes access"
  }

  # Outbound to RDS
  egress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.rds.id]
    description     = "To RDS instance"
  }
}
```

### Bastion Security Group
```hcl
resource "aws_security_group" "bastion" {
  name        = "${var.project_name}-${var.environment}-bastion-sg"
  description = "Security group for Bastion host"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
    description = "SSH access from allowed IPs"
  }

  egress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.rds.id]
    description     = "PostgreSQL access"
  }

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

# EKS
variable "eks_cluster_version" {
  type        = string
  description = "EKS cluster Kubernetes version"
  default     = "1.28"
}

variable "eks_node_desired_size" {
  type        = number
  description = "Desired number of worker nodes"
  default     = 2
}

variable "eks_node_min_size" {
  type        = number
  description = "Minimum number of worker nodes"
  default     = 1
}

variable "eks_node_max_size" {
  type        = number
  description = "Maximum number of worker nodes"
  default     = 4
}

variable "eks_node_instance_types" {
  type        = list(string)
  description = "EC2 instance types for worker nodes"
  default     = ["t3.medium"]
}

variable "eks_public_access_cidrs" {
  type        = list(string)
  description = "CIDR blocks allowed to access EKS API"
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

## Variables Template (terraform.tfvars)

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
vpc_cidr             = "10.0.0.0/16"
availability_zones   = ["us-east-1a", "us-east-1b"]
public_subnet_cidrs  = ["10.0.1.0/24", "10.0.2.0/24"]
private_subnet_cidrs = ["10.0.11.0/24", "10.0.12.0/24"]

# Frontend
domain_name         = "dev.example.com"
acm_certificate_arn = "arn:aws:acm:us-east-1:ACCOUNT:certificate/CERT-ID"

# Database
db_engine            = "postgres"
db_engine_version    = "15.4"
db_instance_class    = "db.t3.micro"
db_allocated_storage = 20
db_name              = "appdb"

# EKS
eks_cluster_version      = "1.28"
eks_node_desired_size    = 2
eks_node_min_size        = 1
eks_node_max_size        = 4
eks_node_instance_types  = ["t3.medium"]
eks_public_access_cidrs  = ["1.2.3.4/32"]  # Your office IP

# Bastion
bastion_instance_type = "t3.micro"
bastion_allowed_cidrs = ["1.2.3.4/32"]  # Your office IP
bastion_key_name      = "my-key-pair"

# Monitoring
alert_email = "alerts@example.com"
```

## Deployment Steps

### 1. Build and Push Docker Image
```bash
# Authenticate to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin ACCOUNT.dkr.ecr.us-east-1.amazonaws.com

# Build image
docker build -t myapp:latest .

# Tag image
docker tag myapp:latest ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/myapp-dev-app:latest

# Push image
docker push ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/myapp-dev-app:latest
```

### 2. Initialize Backend (one-time)
```bash
cd global/backend
terraform init
terraform apply
```

### 3. Deploy Environment
```bash
cd environments/dev
terraform init
terraform plan -out=plan.tfplan
terraform apply plan.tfplan
```

### 4. Configure kubectl
```bash
aws eks update-kubeconfig --name myapp-dev-cluster --region us-east-1
kubectl get nodes
```

### 5. Install AWS Load Balancer Controller
```bash
# Create IAM policy
curl -o iam_policy.json https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v2.6.2/docs/install/iam_policy.json
aws iam create-policy --policy-name AWSLoadBalancerControllerIAMPolicy --policy-document file://iam_policy.json

# Create IAM role for service account
eksctl create iamserviceaccount \
  --cluster=myapp-dev-cluster \
  --namespace=kube-system \
  --name=aws-load-balancer-controller \
  --attach-policy-arn=arn:aws:iam::ACCOUNT:policy/AWSLoadBalancerControllerIAMPolicy \
  --approve

# Install controller via Helm
helm repo add eks https://aws.github.io/eks-charts
helm repo update
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=myapp-dev-cluster \
  --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller
```

### 6. Deploy Application to EKS
```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
  namespace: default
spec:
  replicas: 2
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
      - name: myapp
        image: ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/myapp-dev-app:latest
        ports:
        - containerPort: 8080
        env:
        - name: DB_HOST
          value: "myapp-dev-proxy.proxy-xxx.us-east-1.rds.amazonaws.com"
        - name: DB_NAME
          value: "appdb"
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
---
apiVersion: v1
kind: Service
metadata:
  name: myapp-service
  namespace: default
spec:
  type: NodePort
  selector:
    app: myapp
  ports:
  - port: 80
    targetPort: 8080
    protocol: TCP
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-ingress
  namespace: default
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/certificate-arn: arn:aws:acm:us-east-1:ACCOUNT:certificate/CERT-ID
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP": 80}, {"HTTPS": 443}]'
    alb.ingress.kubernetes.io/ssl-redirect: '443'
spec:
  rules:
  - host: dev.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: myapp-service
            port:
              number: 80
```

```bash
kubectl apply -f deployment.yaml
kubectl get pods
kubectl get ingress
```

### 7. Verify Deployment
- Check EKS cluster status
- Verify nodes are running
- Check pod status
- Test ALB endpoint
- Verify API Gateway integration
- Connect to RDS via Bastion
- Access frontend via CloudFront URL

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
- ✅ EKS secrets encryption enabled
- ✅ Container image scanning enabled
- ✅ RDS Proxy for connection pooling
- ✅ IRSA for pod IAM permissions
- ✅ API Gateway with Lambda Authorizer

## Cost Optimization

### Development Environment
- Single NAT Gateway
- Single-AZ RDS
- Spot instances for EKS nodes
- Smaller node sizes (t3.medium)
- Reduced backup retention

### Production Environment
- Multi-AZ NAT Gateways
- Multi-AZ RDS with read replicas
- On-Demand instances for EKS nodes
- Larger node sizes based on workload
- Extended backup retention
- Enhanced monitoring

## EKS-Specific Considerations

### Node Sizing
- Start with t3.medium for general workloads
- Use c5 instances for CPU-intensive workloads
- Use r5 instances for memory-intensive workloads
- Monitor resource utilization and adjust

### Cluster Auto Scaling
```yaml
# cluster-autoscaler.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: cluster-autoscaler
  namespace: kube-system
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::ACCOUNT:role/cluster-autoscaler-role
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cluster-autoscaler
  namespace: kube-system
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cluster-autoscaler
  template:
    metadata:
      labels:
        app: cluster-autoscaler
    spec:
      serviceAccountName: cluster-autoscaler
      containers:
      - image: k8s.gcr.io/autoscaling/cluster-autoscaler:v1.28.0
        name: cluster-autoscaler
        command:
        - ./cluster-autoscaler
        - --v=4
        - --stderrthreshold=info
        - --cloud-provider=aws
        - --skip-nodes-with-local-storage=false
        - --expander=least-waste
        - --node-group-auto-discovery=asg:tag=k8s.io/cluster-autoscaler/enabled,k8s.io/cluster-autoscaler/myapp-dev-cluster
```

### Pod Auto Scaling (HPA)
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: myapp-hpa
  namespace: default
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: myapp
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

### IRSA (IAM Roles for Service Accounts)
```hcl
# Create IAM role for pod
resource "aws_iam_role" "pod_role" {
  name = "${var.project_name}-${var.environment}-pod-role"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRoleWithWebIdentity"
      Effect = "Allow"
      Principal = {
        Federated = module.eks.oidc_provider_arn
      }
      Condition = {
        StringEquals = {
          "${module.eks.oidc_provider_url}:sub" = "system:serviceaccount:default:myapp-sa"
          "${module.eks.oidc_provider_url}:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })
}

# Attach policies to role
resource "aws_iam_role_policy_attachment" "pod_s3_access" {
  role       = aws_iam_role.pod_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess"
}
```

```yaml
# service-account.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: myapp-sa
  namespace: default
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::ACCOUNT:role/myapp-dev-pod-role
```
