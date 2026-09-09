# Deployment Guide

## Prerequisites

- Node.js 20+ runtime (the Dockerfiles and CI both pin 20)
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
`designationId`. It does not carry the data across.

The backfill cannot run before the migration: the migration is what creates the
`designations` table and the `designationId` column, so any statement touching
them beforehand fails on the old schema. Stash the values first, migrate, then
restore.

**1. Before `migrate deploy`**, copy the free-text values out:

```sql
CREATE TABLE designation_backfill AS
SELECT id AS employee_id, "tenantId", "designation"
FROM "employees"
WHERE "designation" IS NOT NULL AND "designation" <> '';
```

**2. Run the migration** (`npm run prisma:migrate:prod`). The column is dropped,
but the stashed copy survives.

**3. After it completes**, rebuild the rows and relink:

```sql
BEGIN;
INSERT INTO "designations" ("id", "tenantId", "name", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, b."tenantId", b."designation", true, now(), now()
FROM designation_backfill b
GROUP BY b."tenantId", b."designation"
ON CONFLICT ("tenantId", "name") DO NOTHING;

UPDATE "employees" e
SET "designationId" = d."id"
FROM designation_backfill b
JOIN "designations" d
  ON d."tenantId" = b."tenantId" AND d."name" = b."designation"
WHERE e.id = b.employee_id;
COMMIT;

DROP TABLE designation_backfill;
```

`gen_random_uuid()` needs PostgreSQL 13 or newer, or the `pgcrypto` extension.

**If you skip this, the designations are lost permanently.** That is already the
case for any database where this migration has already run: the column is gone
and the values cannot be recovered from the database itself. Restore from a
backup taken before the migration if you need them.

### Indian statutory payroll
Provident fund, state insurance, professional tax, labour welfare fund and TDS
are configured per tenant and are off until you opt in. Apply the migration,
then seed the rates and slabs for your state:

```bash
IMPORT_TENANT_ID=<tenant id> PT_STATE=Karnataka npm run prisma:seed-statutory
```

See [india-statutory-payroll.md](india-statutory-payroll.md) for what each levy
does, what employees and salary structures need filled in, and what is
deliberately not implemented. Verify every seeded rate against the current
notification before running a real payroll.

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
ZKTeco/ESSL devices cannot send credentials, so `/iclock/*` is unauthenticated
by protocol. Restrict where pushes may come from with `BIOMETRIC_ALLOWED_IPS`
(comma-separated IPv4 addresses or CIDR ranges):

```bash
BIOMETRIC_ALLOWED_IPS="10.0.5.20,192.168.1.0/24"
```

**This fails closed.** With the variable unset or empty, every device push is
rejected with a 403 and an error is logged. A forged punch feeds overtime and
payroll, so an unset allowlist must not mean "accept everything". If a
deployment genuinely cannot pin source addresses, opt out deliberately:

```bash
BIOMETRIC_ALLOWED_IPS="*"
```

which accepts any source and logs a warning at startup. `*` is honoured only
when it is the sole entry; mixed with real entries it is ignored.

If the API runs behind a reverse proxy, enable `trust proxy` so the real client
address is seen rather than the proxy's.

Source-IP filtering is the only control the push protocol allows, so treat it
as one layer, not the whole defence. The device firmware supports no shared
secret or signature on this endpoint. For anything beyond a trusted LAN, put
the devices on a private network or VPN, or terminate them at a reverse proxy
that adds mutual TLS, rather than exposing `/iclock` to the internet.

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
Winston writes human-readable, colourised lines in every environment; it is not currently configured to emit JSON. If your log pipeline needs structured output, change the format in `backend/src/config/logger.config.ts`. Configure `LOG_LEVEL=info` to reduce noise. Log levels: `error`, `warn`, `info`, `http`, `verbose`, `debug`.

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
cp .env.docker.example .env

# Edit .env and set the three required values: POSTGRES_PASSWORD, JWT_SECRET
# and FIELD_ENCRYPTION_KEY. Compose refuses to start without them.
# Generate a secret or key with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Set BIOMETRIC_ALLOWED_IPS too if you use biometric devices; empty rejects
# every device push.

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
