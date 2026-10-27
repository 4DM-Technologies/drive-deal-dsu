# DriveDeal AWS setup guide

How to stand up DriveDeal on AWS with the CloudFront + ECS Fargate + RDS architecture.
This replaces the single-EC2 Docker Compose deployment (SQLite and uploads on Docker volumes).

Architecture diagram: https://www.figma.com/design/BaAT27A8tOWtets7IlSgZj?node-id=1-2

---

## 1. Architecture at a glance

```
Browser
  │  DNS
  ▼
Route 53 ──► CloudFront + WAF  (one domain, HTTPS + wss, ACM certificate)
               │
               ├── /*        ──► S3 frontend bucket (React build, private, OAC, cached)
               │
               └── /api/*    ──► Application Load Balancer (public subnets, CloudFront-only)
                                   │
                                   ▼
                                ECS Fargate service: FastAPI tasks (private subnets, 2 AZs)
                                   │            │                 │
                                   │ SQL        │ uploads         │ OpenAI / car sites
                                   ▼            ▼                 ▼
                         RDS PostgreSQL   S3 uploads bucket    NAT Gateway (+ Elastic IP)
                         (private)        via S3 gateway          ──► public internet
                                          endpoint (free)

Startup / deploy: ECR (image) · Secrets Manager (secrets) · CloudWatch (logs) · GitHub Actions (CI/CD)
```

### Request flow

| Step | What happens |
|---|---|
| 1 | Browser asks Route 53 for the site address. |
| 2 | Browser connects to CloudFront over HTTPS or wss; WAF filters bad traffic. |
| 3 | Paths `/*` are served from the cached S3 React build. |
| 4 | Paths `/api/*` go to the load balancer with caching off. |
| 5 | The ALB picks a healthy FastAPI task. |
| 6 | The task reads and writes PostgreSQL on RDS. |
| 7 | Uploads go to S3 through the free gateway endpoint. |
| 8 | Sera reaches OpenAI and car sites through NAT. |

### Decisions behind this design

| Decision | Why |
|---|---|
| **No ElastiCache Redis** | Only needed for WebSocket fan-out across tasks. Run **1 task** for now. Before scaling to 2+, add Postgres `LISTEN/NOTIFY` fan-out (see [section 9](#9-scaling-beyond-one-task)). |
| **No LangSmith** | Not part of the production setup. Keep `LANGSMITH_TRACING=false`. |
| **NAT Gateway kept** | Sera needs outbound internet (OpenAI/Codex, car-site crawling). VPC endpoints only reach AWS services. One shared NAT, not one per AZ. |
| **Elastic IP** | Attached to the NAT Gateway automatically. Gives one fixed outbound IP if a partner ever needs to allowlist us. |
| **One domain for app + API** | CloudFront serves both, so the browser never makes cross-origin calls and the WebSocket uses the same host. |
| **No AWS access keys in the app** | The ECS task role grants S3 access. boto3 picks it up automatically when `AWS_ACCESS_KEY_ID` is unset. |

---

## 2. AWS services and what each one does

| Service | Purpose | Notes |
|---|---|---|
| Route 53 | DNS for the domain | Optional: without a domain, use the `*.cloudfront.net` address. |
| ACM | TLS certificate | Must be in **us-east-1** for CloudFront. |
| CloudFront | Single entry point, caching, TLS | Two behaviours: `/*` → S3, `/api/*` → ALB. |
| AWS WAF | Blocks common attacks, rate-limits | AWS managed rule groups + a rate rule. |
| S3 (frontend) | React build files | Private; only CloudFront can read it (Origin Access Control). |
| ALB | Routes API traffic to healthy tasks | Accepts traffic from CloudFront only. |
| ECS Fargate | Runs the FastAPI container | Private subnets, no public IP. |
| ECR | Stores the API Docker image | Scan on push enabled. |
| RDS PostgreSQL | Main database | Private subnets; Multi-AZ in prod. |
| S3 (uploads) | Licences, documents, Codex OAuth store | Reached via the S3 gateway endpoint. |
| NAT Gateway + EIP | Outbound internet for Sera | Single NAT shared by both AZs. |
| Secrets Manager | DB password, JWT key, OpenAI/Codex credentials | Injected into the task at startup. |
| CloudWatch | Logs, metrics, alarms | Container Insights on the ECS cluster. |
| GitHub Actions | Build, push, deploy | Uses OIDC to assume an AWS role, no stored AWS keys. |

---

## 3. Prerequisites

Install locally:

| Tool | Version |
|---|---|
| Terraform | 1.17.x (latest stable) |
| AWS CLI | v2 |
| Docker | 24+ |
| tflint, checkov | latest (optional, for linting/security scans) |

AWS account access:

- An IAM user or SSO role with admin rights for the first setup.
- Pick the **region** (written as `<REGION>` below, e.g. `ap-south-1`).
- Optional: a domain in Route 53 (written as `<DOMAIN>`, e.g. `app.drivedeal.com`).

```bash
aws configure sso          # or: aws configure
aws sts get-caller-identity
```

---

## 4. Infrastructure as code (Terraform)

All infrastructure lives in `infra/terraform/`. Nothing is clicked together in the console.

```
infra/terraform/
  bootstrap/        state bucket + GitHub OIDC role (run once per account)
  modules/
    network/        VPC, 2 AZs, public/private subnets, NAT, S3 gateway endpoint, security groups
    database/       RDS PostgreSQL
    storage/        S3 frontend (private, OAC) + S3 uploads
    app/            ECR, ECS cluster/service, ALB, IAM roles, Secrets Manager, CloudWatch logs
    edge/           CloudFront + WAF, ACM certificate, Route 53 records
  envs/
    dev/            backend.tf, main.tf, terraform.tfvars
    prod/
  tests/            *.tftest.hcl
```

Conventions (from HashiCorp's `terraform-style-guide`):

- Each module has `terraform.tf`, `main.tf`, `variables.tf`, `outputs.tf`, `locals.tf`.
- Pin Terraform `~> 1.17` and the AWS provider `~> 6.70` (never 6.57.0, it was pulled).
- Every variable has a `type` and `description`; secrets are `sensitive = true`.
- Commit all `.tf` files and `.terraform.lock.hcl`. Never commit `*.tfstate`, `.terraform/`, `*.tfplan` or secret `.tfvars`.
- Run `terraform fmt -recursive` and `terraform validate` before every commit.

### 4.1 Bootstrap (once per AWS account)

Creates the remote state bucket and the GitHub Actions OIDC role.

```bash
cd infra/terraform/bootstrap
terraform init
terraform apply -var="region=<REGION>" -var="github_repo=4DM-Technologies/drive-deal-dsu"
```

State uses S3 native locking (`use_lockfile = true`), so **no DynamoDB lock table** is needed.

### 4.2 Create an environment

```bash
cd infra/terraform/envs/dev
terraform init
terraform plan -out=dev.tfplan
terraform apply dev.tfplan
```

Key values in `terraform.tfvars`:

| Variable | Dev | Prod |
|---|---|---|
| `region` | `<REGION>` | `<REGION>` |
| `domain_name` | empty (use cloudfront.net) or `dev.<DOMAIN>` | `<DOMAIN>` |
| `db_instance_class` | `db.t4g.micro` | `db.t4g.small` or larger |
| `db_multi_az` | `false` | `true` |
| `ecs_desired_count` | `1` | `1` (until LISTEN/NOTIFY is added) |
| `task_cpu` / `task_memory` | `512` / `1024` | `1024` / `2048` |

Outputs you will need later: `cloudfront_domain`, `ecr_repository_url`, `frontend_bucket`, `uploads_bucket`, `ecs_cluster`, `ecs_service`, `github_deploy_role_arn`.

---

## 5. Settings that the Terraform must get right

These come from reviewing the current code. Getting any of them wrong breaks the app in production.

### 5.1 CloudFront

| Setting | Value | Why |
|---|---|---|
| `/api/*` cache policy | `CachingDisabled` | API responses must never be cached. |
| `/api/*` origin request policy | `AllViewerExceptHostHeader` | Forwards **query strings** (WebSocket sends `?token=`), cookies, auth and WebSocket upgrade headers. |
| `/api/*` allowed methods | All (GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE) | |
| Origin response timeout | `60` seconds | Default is 30 s; AI calls take up to 45 s. |
| Origin keep-alive | `60` seconds | |
| `/*` default root + SPA errors | `index.html`; map 403/404 → `/index.html` (200) | React Router deep links. |
| Origin custom header | `X-Origin-Verify: <random secret>` | ALB rejects requests without it. |

### 5.2 ALB

| Setting | Value |
|---|---|
| Idle timeout | `120` seconds (covers SSE streams and WebSockets) |
| Security group inbound | CloudFront managed prefix list `com.amazonaws.global.cloudfront.origin-facing`, port 80/443 |
| Listener rule | Forward only when `X-Origin-Verify` matches; default action 403 |
| Target group | IP targets, port `8000`, health check `/api/v1/health` |
| Deregistration delay | `30` seconds |

### 5.3 ECS service

| Setting | Value |
|---|---|
| Launch type | Fargate, private subnets, `assign_public_ip = false` |
| Desired count | `1` |
| Deployment circuit breaker | Enabled with rollback |
| Health check grace period | `60` seconds |
| Log driver | `awslogs` → `/ecs/drivedeal-<env>-api`, 30-day retention |
| Task role | S3 read/write on the uploads bucket only |
| Execution role | Pull from ECR, read the app's secrets, write logs |

### 5.4 Security groups

| Group | Inbound | Outbound |
|---|---|---|
| `alb` | CloudFront prefix list | `ecs` on 8000 |
| `ecs` | `alb` on 8000 | All (NAT, S3 endpoint, RDS) |
| `rds` | `ecs` on 5432 | None |

---

## 6. Secrets and application config

### 6.1 Secrets (Secrets Manager)

Terraform creates the secret **containers**. Put the values in once by hand, so they are never in Git or Terraform state.

| Secret | Content |
|---|---|
| `drivedeal/<env>/db` | Managed by RDS (`manage_master_user_password = true`). Do not edit. |
| `drivedeal/<env>/jwt` | `JWT_SECRET_KEY`, at least 32 characters. |
| `drivedeal/<env>/openai` | `OPENAI_API_KEY` **or** `CODEX_OAUTH_CLIENT_ID` + `CODEX_OAUTH_REFRESH_TOKEN`. |
| `drivedeal/<env>/origin-verify` | Random value for the `X-Origin-Verify` header. |

```bash
aws secretsmanager put-secret-value \
  --secret-id drivedeal/dev/jwt \
  --secret-string "$(openssl rand -base64 48)"
```

### 6.2 Backend environment (ECS task definition)

| Key | Value |
|---|---|
| `APP_ENV` | `production` |
| `DATABASE_URL` | `postgresql+asyncpg://<user>:<password>@<rds-endpoint>:5432/drivedeal` (built from the RDS secret) |
| `JWT_SECRET_KEY` | from `drivedeal/<env>/jwt` |
| `CORS_ORIGINS` | `["https://<DOMAIN>"]` (JSON array, no trailing slash) |
| `STORAGE_DRIVER` | `s3` (required when `APP_ENV=production`) |
| `AWS_REGION` | `<REGION>` |
| `S3_BUCKET` | uploads bucket name |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | **leave unset**, the task role is used |
| `OPENAI_API_KEY` or `CODEX_OAUTH_*` | from `drivedeal/<env>/openai` |
| `AI_REQUEST_TIMEOUT_SECONDS` | `45` (must stay below the 60 s CloudFront timeout) |
| `AI_ENABLE_WEB_SEARCH` | `true` |
| `LANGSMITH_TRACING` | `false` |
| `LOG_LEVEL` | `INFO` |

### 6.3 Frontend build variables (GitHub repository variables)

| Key | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://<DOMAIN>/api/v1` |
| `VITE_WS_BASE_URL` | `wss://<DOMAIN>/api/v1/ws` |

Both are baked into the Vite build, so changing them needs a frontend redeploy.

---

## 7. First deployment

Run these after `terraform apply` finishes. Values in `<>` come from the Terraform outputs.

### 7.1 Build and push the API image

```bash
aws ecr get-login-password --region <REGION> \
  | docker login --username AWS --password-stdin <ecr_repository_url>

docker build -t <ecr_repository_url>:<git-sha> backend
docker push <ecr_repository_url>:<git-sha>
```

### 7.2 Run database migrations (one-off ECS task)

```bash
aws ecs run-task \
  --cluster <ecs_cluster> \
  --launch-type FARGATE \
  --task-definition drivedeal-<env>-api \
  --network-configuration "awsvpcConfiguration={subnets=[<private_subnet_ids>],securityGroups=[<ecs_sg>],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"api","command":["alembic","upgrade","head"]}]}'
```

Watch it finish in CloudWatch Logs (`/ecs/drivedeal-<env>-api`) before starting the service.

### 7.3 Start the API service

```bash
aws ecs update-service --cluster <ecs_cluster> --service <ecs_service> --force-new-deployment
aws ecs wait services-stable --cluster <ecs_cluster> --services <ecs_service>
```

### 7.4 Build and upload the frontend

```bash
cd frontend
VITE_API_BASE_URL=https://<DOMAIN>/api/v1 \
VITE_WS_BASE_URL=wss://<DOMAIN>/api/v1/ws \
npm ci && npm run build

aws s3 sync dist/ s3://<frontend_bucket>/ --delete
aws cloudfront create-invalidation --distribution-id <cloudfront_id> --paths "/index.html"
```

### 7.5 Codex OAuth (only if not using `OPENAI_API_KEY`)

Tokens are stored in the uploads bucket under `CODEX_OAUTH_S3_PREFIX` (`private/codex-oauth`). Run the one-time login locally against the same bucket, or seed the refresh token in the `drivedeal/<env>/openai` secret.

### 7.6 Moving data from the EC2 setup

The old setup used SQLite and local upload volumes.

1. Export SQLite data and load it into RDS (e.g. with `pgloader`) **after** running migrations.
2. Copy uploads: `aws s3 sync ./uploads s3://<uploads_bucket>/`.
3. Check a few records and documents in the app before switching DNS.

---

## 8. CI/CD (GitHub Actions)

The current pipeline pushes to Docker Hub and deploys to EC2 over SSH. The new pipeline:

1. Runs the existing lint, test and security-scan stages (unchanged).
2. Logs in to AWS with **OIDC** (`aws-actions/configure-aws-credentials`, `role-to-assume: <github_deploy_role_arn>`). No AWS keys in GitHub secrets.
3. Builds and pushes the API image to **ECR**, tagged with the commit SHA.
4. Runs the migration task (section 7.2) and waits for it.
5. Registers a new task definition with the new image and updates the ECS service; waits for `services-stable`.
6. Builds the frontend, syncs it to the frontend bucket and invalidates `/index.html`.

GitHub settings to add:

| Type | Name | Value |
|---|---|---|
| Variable | `AWS_REGION` | `<REGION>` |
| Variable | `AWS_DEPLOY_ROLE_ARN` | `github_deploy_role_arn` output |
| Variable | `VITE_API_BASE_URL` / `VITE_WS_BASE_URL` | see section 6.3 |

Secrets no longer needed after the switch: `DEV_EC2_HOST`, `DEV_EC2_SSH_KEY`, `DEV_DOCKERHUB_USERNAME`, `DEV_DOCKERHUB_TOKEN`.

---

## 9. Scaling beyond one task

WebSocket connections are kept in memory in `backend/src/services/websocket_manager.py`. Marketplace events (`backend/src/services/marketplace_service.py`, `manager.send(...)`) are pushed to another user's socket, which may be on a different task. With more than one task, those events would be lost.

Before raising `ecs_desired_count` above 1:

1. Make `manager.send()` publish with Postgres `NOTIFY` on a channel.
2. Give each task one dedicated asyncpg connection that `LISTEN`s and delivers to its local sockets.
3. Keep payloads under 8 KB (send IDs, let the client refetch details).
4. Make sure only one task refreshes the Codex OAuth token at a time.

No new AWS service is needed for this.

---

## 10. Verify the deployment

| Check | How |
|---|---|
| Frontend loads | Open `https://<DOMAIN>`; refresh a deep link (e.g. `/marketplace`) and it still loads. |
| API health | `curl https://<DOMAIN>/api/v1/health` → 200 |
| ALB is locked down | `curl http://<alb-dns-name>/api/v1/health` → 403 |
| WebSocket | Browser dev tools → Network → WS shows `wss://<DOMAIN>/api/v1/ws?token=…` with status 101 |
| Uploads | Upload a document; it appears in the uploads bucket. |
| Sera | Ask Sera a question with web search; the answer streams without a 504. |
| Logs | CloudWatch log group `/ecs/drivedeal-<env>-api` shows requests. |

---

## 11. Monitoring and alarms

| Alarm | Threshold |
|---|---|
| ALB 5xx | > 5 in 5 minutes |
| ALB target response time (p95) | > 10 s |
| ECS running task count | < 1 |
| ECS CPU / memory | > 80% for 10 minutes |
| RDS CPU | > 80% for 10 minutes |
| RDS free storage | < 2 GB |
| WAF blocked requests | sudden spike |

Send alarms to an SNS topic with the team email.

---

## 12. Rough monthly cost (dev, 1 task)

| Item | Approx. USD / month |
|---|---|
| NAT Gateway + Elastic IP | 32–35 + 0.045 per GB |
| ALB | 18–22 |
| ECS Fargate (0.5 vCPU / 1 GB, 1 task) | 15–18 |
| RDS `db.t4g.micro`, 20 GB | 15–18 |
| CloudFront + WAF | 6–10 |
| S3, ECR, Secrets Manager, CloudWatch, Route 53 | 5–10 |
| **Total** | **~95–115** (plus OpenAI usage) |

Prod with Multi-AZ RDS and bigger tasks roughly doubles the RDS and Fargate lines. See the `DriveDeal-TCO-*.xlsx` sheets in this folder for user-based estimates.

---

## 13. Tear down

```bash
cd infra/terraform/envs/dev
terraform destroy
```

RDS has deletion protection and a final snapshot in prod; disable deletion protection in `terraform.tfvars` first if you really mean to remove it. Empty the S3 buckets before destroy, or set `force_destroy = true` for dev only.
