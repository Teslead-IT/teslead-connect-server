# start.ps1
# Production-safe startup script for NestJS application (Windows PowerShell)
# Handles database migrations before starting the server
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/start.ps1
#
# Environment variables:
#   DB_MIGRATE          - Set to "true" to run migrations before starting (default: "false")
#   NODE_ENV            - Environment (production, development)
#   PORT                - Server port (default: 3000)
#   DATABASE_URL        - PostgreSQL connection URL

# Exit on error
$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Yellow
Write-Host "NestJS Server Startup" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Check required environment variables
if ([string]::IsNullOrEmpty($env:DATABASE_URL)) {
    Write-Host "ERROR: DATABASE_URL environment variable is not set" -ForegroundColor Red
    exit 1
}

$NodeEnv = $env:NODE_ENV ?? "production"
$DbMigrate = $env:DB_MIGRATE ?? "false"
$Port = $env:PORT ?? "3000"

Write-Host "Environment: $NodeEnv" -ForegroundColor Green
Write-Host "Port: $Port" -ForegroundColor Green
Write-Host "Database Migrations: $DbMigrate" -ForegroundColor Green

# Run migrations if enabled
if ($DbMigrate -eq "true") {
    Write-Host "Running database migrations..." -ForegroundColor Yellow
    & npx prisma migrate deploy
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Migration failed" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "Migrations completed" -ForegroundColor Green
}
else {
    Write-Host "Skipping migrations (DB_MIGRATE=false)" -ForegroundColor Yellow
}

Write-Host "Starting application..." -ForegroundColor Yellow
& node dist/main.js

Write-Host "Application started successfully" -ForegroundColor Green
