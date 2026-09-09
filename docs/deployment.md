# Deployment Guide

## Prerequisites

- Node.js 18+ runtime
- PostgreSQL 14+ database server
- (Optional) Redis server for background jobs
- (Optional) SMTP server for email notifications
- (Optional) AWS S3 bucket for file storage

## Environment Configuration

### Backend Production Environment

Create a `.env` file in the `backend/` directory with production values:

```bash
# Database (required)
DATABASE_URL="postgresql://user:password@db-host:5432/hrms_prod"

# JWT (required — use a strong random secret, minimum 16 characters)
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET="<generate-a-strong-random-secret>"
JWT_EXPIRES_IN="7d"

# Application
PORT=3001
NODE_ENV=production

# CORS — set to your frontend domain
CORS_ORIGIN="https://your-frontend-domain.com"

# Multi-tenant
DEFAULT_TENANT_ID="your-production-tenant-id"

# Logging
LOG_LEVEL="info"

# Storage
STORAGE_TYPE="s3"  # or "local"
AWS_S3_BUCKET="your-bucket"
AWS_S3_REGION="us-east-1"
AWS_ACCESS_KEY_ID="your-key"
AWS_SECRET_ACCESS_KEY="your-secret"

# Email (SMTP)
SMTP_HOST="smtp.your-provider.com"
SMTP_PORT=587
SMTP_USER="your-smtp-user"
SMTP_PASS="your-smtp-password"
SMTP_FROM="HRMS <noreply@your-domain.com>"

# Redis (recommended for production)
REDIS_ENABLED=true
REDIS_HOST="redis-host"
REDIS_PORT=6379
REDIS_PASSWORD="your-redis-password"
```

### Frontend Production Environment

```bash
NEXT_PUBLIC_API_URL=https://your-api-domain.com/api
NEXT_PUBLIC_APP_NAME=HRMS
NEXT_PUBLIC_APP_ENV=production
```

## Build & Deploy

### Backend

```bash
cd backend

# Install production dependencies
npm ci --production=false  # Need devDependencies for build

# Generate Prisma client
npm run prisma:generate

# Run database migrations
npm run prisma:migrate:prod  # Uses 'prisma migrate deploy' (no prompts)

# Build
npm run build

# Start production server
npm run start:prod  # Runs: node dist/src/main
```

### Frontend

```bash
cd frontend

# Install dependencies
npm ci

# Build
npm run build

# Start production server
npm run start  # Runs: next start
```

## Database Management

### Migrations
```bash
# Development (interactive, creates migration files)
npm run prisma:migrate

# Production (applies pending migrations, no prompts)
npm run prisma:migrate:prod
```

#### Databases that were built with `prisma db push`
Several features shipped without migration files and were applied to existing
databases with `db push`. On such a database, `migrate deploy` fails with
"relation already exists". Mark the migrations that match the current schema
as applied, then deploy normally:

```bash
npx prisma migrate resolve --applied 20251203105041_drona_hrms
npx prisma migrate resolve --applied 20260908091059_drona
npm run prisma:migrate:prod
```

Only resolve a migration as applied if its tables already exist in that database.

#### Before applying `20260908091059_drona` to a database that still has `employees.designation`
That migration drops the free-text `designation` column and replaces it with
`designationId`. It does not carry the data across. Run this first, in a
transaction, on any environment still on the old schema:

```sql
BEGIN;
INSERT INTO "designations" ("id", "tenantId", "name", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, e."tenantId", e."designation", true, now(), now()
FROM "employees" e
WHERE e."designation" IS NOT NULL AND e."designation" <> ''
GROUP BY e."tenantId", e."designation"
ON CONFLICT ("tenantId", "name") DO NOTHING;

ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "designationId" TEXT;

UPDATE "employees" e
SET "designationId" = d."id"
FROM "designations" d
WHERE d."tenantId" = e."tenantId" AND d."name" = e."designation";
COMMIT;
```

The migration's own `ADD COLUMN "designationId"` then becomes a no-op and the
`DROP COLUMN "designation"` is safe.

### Sensitive-field encryption
Aadhaar numbers are encrypted at rest with AES-256-GCM. `FIELD_ENCRYPTION_KEY`
(32 bytes, hex) is required to create or update an employee with an Aadhaar
number, and API responses only ever return a masked form. After enabling the
key on an existing database, encrypt legacy plaintext rows once:

```bash
npm run prisma:encrypt-aadhaar
```

Rotating the key requires decrypting with the old key and re-encrypting with
the new one; there is no automated rotation.

### Biometric device push
`/iclock/*` cannot authenticate the device, so restrict where pushes may come
from with `BIOMETRIC_ALLOWED_IPS` (comma-separated IPv4 addresses or CIDR
ranges). Leaving it empty accepts pushes from any address and logs a warning.
If the API runs behind a reverse proxy, enable `trust proxy` so the real client
address is seen.

### One-off import scripts
`prisma/import-employees*.ts` delete existing tenant data before importing. They
refuse to run unless both `IMPORT_TENANT_ID` and `CONFIRM_WIPE_TENANT` are set
to the same tenant id.

### Seeding
The seed script creates demo data. **Do NOT run in production** unless you need initial data:
```bash
npm run prisma:seed  # Development only
```

### Prisma Studio
Visual database browser (development only):
```bash
npm run prisma:studio  # Opens at http://localhost:5555
```

## Security Checklist

Before going to production, verify:

- [ ] `JWT_SECRET` is a strong random string (32+ bytes recommended)
- [ ] `NODE_ENV` is set to `production` (disables Swagger docs)
- [ ] `CORS_ORIGIN` is restricted to your frontend domain only
- [ ] Default demo passwords are changed or demo accounts are removed
- [ ] Seed data is not applied to production database
- [ ] Database credentials use a dedicated production user with minimal privileges
- [ ] HTTPS is configured (via reverse proxy or load balancer)
- [ ] Helmet security headers are active (enabled by default)
- [ ] Redis password is set if Redis is enabled
- [ ] S3 bucket policies restrict access appropriately
- [ ] SMTP credentials are valid and sender domain is verified

## Production Notes

### Swagger Documentation
Swagger UI at `/api/docs` is **automatically disabled** when `NODE_ENV=production`. No action needed.

### Logging
In production, Winston outputs structured JSON logs. Configure `LOG_LEVEL=info` to reduce noise. Log levels: `error`, `warn`, `info`, `http`, `verbose`, `debug`.

### Background Jobs
If `REDIS_ENABLED=true`, BullMQ processes background jobs for:
- Email sending
- Report generation
- Other async operations

Without Redis, these operations run synchronously or are skipped.

### File Storage
- **Local storage** (`STORAGE_TYPE=local`): Files stored in `STORAGE_LOCAL_PATH`. Ensure the directory is writable and persisted across deployments.
- **S3 storage** (`STORAGE_TYPE=s3`): Files stored in AWS S3. Configure bucket CORS if direct browser uploads are used.

### Process Management
For production, use a process manager:

```bash
# Using PM2
npm install -g pm2
pm2 start dist/src/main.js --name hrms-backend

# Or use systemd, Docker, etc.
```

## Docker

### Quick Start

```bash
# Copy the Docker env template and configure
cp .env.docker .env

# Edit .env — at minimum set JWT_SECRET to a strong random value
# Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Build and start all services
docker compose up --build -d

# Check logs
docker compose logs -f

# Stop
docker compose down
```

### Services
- **postgres** — PostgreSQL 16, port 5432
- **redis** — Redis 7, port 6379
- **backend** — NestJS API, port 3001 (auto-runs migrations on start)
- **frontend** — Next.js app, port 3000

### Data Persistence
Docker volumes are used for data persistence:
- `pgdata` — PostgreSQL database files
- `redisdata` — Redis data
- `uploads` — File uploads

To reset all data: `docker compose down -v`

### Seeding (first run)
After the first `docker compose up`, seed the database:
```bash
docker compose exec backend npx prisma db seed
```
