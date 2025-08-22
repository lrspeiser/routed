#!/bin/bash

# Setup script for deploying scripts feature to production
# This script will:
# 1. Run the database migration to create scripts tables
# 2. Set the OPENAI_API_KEY environment variable on Render

echo "=== Scripts Feature Production Setup ==="
echo ""
echo "This script will help you set up the scripts feature in production."
echo ""

# Check if we have DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    echo "ERROR: DATABASE_URL environment variable is not set."
    echo "Please set it to your production database URL."
    echo "You can get it from Render dashboard > routed service > Environment tab"
    exit 1
fi

# Check if we have OPENAI_API_KEY
if [ -z "$OPENAI_API_KEY" ]; then
    echo "WARNING: OPENAI_API_KEY is not set."
    echo "The scripts feature requires an OpenAI API key to generate code."
    echo ""
    echo "Please add OPENAI_API_KEY to your Render environment variables:"
    echo "1. Go to https://dashboard.render.com"
    echo "2. Select your 'routed' service"
    echo "3. Go to the Environment tab"
    echo "4. Add OPENAI_API_KEY with your OpenAI API key"
    echo ""
    read -p "Have you added the OPENAI_API_KEY? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Please add the key and run this script again."
        exit 1
    fi
fi

echo ""
echo "Running database migration to create scripts tables..."
echo ""

# Run the migration
psql "$DATABASE_URL" < notification-hub/sql/add_channel_scripts.sql

if [ $? -eq 0 ]; then
    echo "✅ Database migration completed successfully!"
else
    echo "❌ Database migration failed. Please check the error above."
    exit 1
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Make sure OPENAI_API_KEY is set in Render environment variables"
echo "2. Redeploy your service on Render (it should auto-deploy from the latest commit)"
echo "3. Install the latest app version (1.9.8) and test the scripts feature"
echo ""
echo "The scripts feature should now work!"
