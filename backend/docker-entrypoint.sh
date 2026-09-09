#!/bin/sh
set -e

echo "Running database migrations..."
npx prisma migrate deploy

echo "Starting HRMS backend..."
exec node dist/src/main
