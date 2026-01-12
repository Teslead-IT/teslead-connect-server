#!/bin/bash

# start.sh
# Production-safe startup script for NestJS application
# Handles database migrations before starting the server
#
# Usage:
#   bash scripts/start.sh
#
# Environment variables:
#   DB_MIGRATE=true|false  - Run migrations before starting (default: false)
#   NODE_ENV              - Environment (production, development)
#   PORT                  - Server port (default: 3000)
#   DATABASE_URL          - PostgreSQL connection URL

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}NestJS Server Startup${NC}"
echo -e "${YELLOW}========================================${NC}"

# Check required environment variables
if [ -z "$DATABASE_URL" ]; then
  echo -e "${RED}ERROR: DATABASE_URL environment variable is not set${NC}"
  exit 1
fi

NODE_ENV=${NODE_ENV:-production}
DB_MIGRATE=${DB_MIGRATE:-false}
PORT=${PORT:-3000}

echo -e "${GREEN}Environment: ${NODE_ENV}${NC}"
echo -e "${GREEN}Port: ${PORT}${NC}"
echo -e "${GREEN}Database Migrations: ${DB_MIGRATE}${NC}"

# Run migrations if enabled
if [ "$DB_MIGRATE" = "true" ]; then
  echo -e "${YELLOW}Running database migrations...${NC}"
  npx prisma migrate deploy || {
    echo -e "${RED}Migration failed${NC}"
    exit 1
  }
  echo -e "${GREEN}Migrations completed${NC}"
else
  echo -e "${YELLOW}Skipping migrations (DB_MIGRATE=false)${NC}"
fi

echo -e "${YELLOW}Starting application...${NC}"
node dist/main.js

echo -e "${GREEN}Application started successfully${NC}"
