#!/bin/bash

# Routed Notification Hub - Local Development Starter
# This script helps you run the notification-hub locally

echo "🚀 Starting Routed Notification Hub..."
echo ""

# Check if we're in the right directory
if [ ! -d "notification-hub" ]; then
    echo "❌ Error: notification-hub directory not found."
    echo "   Please run this script from the routed project root."
    exit 1
fi

# Check for required environment variables
if [ -z "$DATABASE_URL" ]; then
    echo "⚠️  DATABASE_URL not set. Using local PostgreSQL default."
    export DATABASE_URL="postgres://localhost:5432/notification_hub"
fi

if [ -z "$REDIS_URL" ]; then
    echo "⚠️  REDIS_URL not set. Using local Redis default."
    export REDIS_URL="redis://127.0.0.1:6379"
fi

if [ -z "$VAPID_PUBLIC" ] || [ -z "$VAPID_PRIVATE" ] || [ -z "$VAPID_SUBJECT" ]; then
    echo "⚠️  VAPID keys not set. WebPush notifications will not work."
    echo "   Set VAPID_PUBLIC, VAPID_PRIVATE, and VAPID_SUBJECT for full functionality."
fi

if [ -z "$DEFAULT_TTL_SEC" ]; then
    echo "⚠️  DEFAULT_TTL_SEC not set. Using default: 86400 (24 hours)"
    export DEFAULT_TTL_SEC=86400
fi

echo ""
echo "📋 Configuration:"
echo "   DATABASE_URL: $DATABASE_URL"
echo "   REDIS_URL: $REDIS_URL"
echo "   DEFAULT_TTL_SEC: $DEFAULT_TTL_SEC"
echo ""

# Navigate to notification-hub directory
cd notification-hub

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm ci
fi

# Start the development server
echo "🎯 Starting development server on http://localhost:8080..."
echo ""
npm run dev
