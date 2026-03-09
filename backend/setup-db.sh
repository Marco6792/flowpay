#!/bin/bash

echo "FlowPay Database Setup Script"
echo "=============================="
echo ""
echo "This script will help you set up the PostgreSQL database for FlowPay."
echo "You'll need to run these commands with appropriate permissions."
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Option 1: Using Docker (Recommended)${NC}"
echo "Run these commands:"
echo ""
echo "  # Add your user to docker group (if not already done)"
echo "  sudo usermod -aG docker $USER"
echo "  # Log out and back in, then run:"
echo "  docker compose up -d postgres"
echo ""

echo -e "${YELLOW}Option 2: Using system PostgreSQL${NC}"
echo "Run these commands:"
echo ""
echo "  # Access PostgreSQL as superuser"
echo "  sudo -u postgres psql"
echo ""
echo "  # Then in PostgreSQL prompt, run:"
echo "  CREATE USER flowpay WITH PASSWORD 'flowpay_password';"
echo "  CREATE DATABASE flowpay OWNER flowpay;"
echo "  GRANT ALL PRIVILEGES ON DATABASE flowpay TO flowpay;"
echo "  \q"
echo ""

echo -e "${YELLOW}Option 3: Using system PostgreSQL with script${NC}"
echo "Run this command:"
echo ""
echo "  sudo -u postgres psql -c \"CREATE USER flowpay WITH PASSWORD 'flowpay_password';\""
echo "  sudo -u postgres psql -c \"CREATE DATABASE flowpay OWNER flowpay;\""
echo "  sudo -u postgres psql -c \"GRANT ALL PRIVILEGES ON DATABASE flowpay TO flowpay;\""
echo ""

echo -e "${GREEN}After setting up the database, run:${NC}"
echo "  bun run db:push    # Apply database schema"
echo "  bun run db:seed    # Add test data"
echo ""

echo -e "${YELLOW}To test the connection:${NC}"
echo "  psql -U flowpay -h localhost -d flowpay -c '\\dt'"
echo "  # Password: flowpay_password"