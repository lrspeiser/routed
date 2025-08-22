#!/bin/bash

echo "=== Routed Development Environment Reset ==="
echo "This will:"
echo "  1. Stop all running services"
echo "  2. Clear local app data"
echo "  3. Reset the database"
echo "  4. Restart services"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 1
fi

echo ""
echo "Step 1: Stopping services..."
# Kill notification hub if running
pkill -f "node.*notification-hub" || true
pkill -f "npm.*notification-hub" || true
# Kill Electron app if running  
pkill -f "Electron.*Routed" || true
pkill -f "electron.*receiver-app" || true

echo "Step 2: Clearing local app data..."
# Clear Electron app data
rm -rf ~/Library/Application\ Support/Routed-Receiver
rm -rf ~/Library/Application\ Support/routed-receiver
echo "  ✓ Cleared Electron app data"

# Clear dev.json and logs
cd receiver-app
rm -f dev.json
rm -f routed.log
echo "  ✓ Cleared dev.json and logs"

echo "Step 3: Resetting database..."
cd ../notification-hub

# Check if database is local or remote
if [ -f ".env" ]; then
    DB_URL=$(grep "^DATABASE_URL=" .env | cut -d '=' -f2-)
    if [[ $DB_URL == *"localhost"* ]] || [[ $DB_URL == *"127.0.0.1"* ]]; then
        echo "  Local database detected - dropping and recreating..."
        
        # Extract database name from URL
        DB_NAME=$(echo $DB_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')
        
        # Drop and recreate database
        psql postgres -c "DROP DATABASE IF EXISTS $DB_NAME;" 2>/dev/null || true
        psql postgres -c "CREATE DATABASE $DB_NAME;" 2>/dev/null || true
        
        echo "  ✓ Database recreated"
        
        # Apply migrations
        echo "  Applying migrations..."
        psql $DB_URL < schema.sql 2>/dev/null || echo "  ⚠ Could not apply schema.sql"
        
        # Apply any additional migrations
        for migration in migrations/*.sql; do
            if [ -f "$migration" ]; then
                echo "  Applying $(basename $migration)..."
                psql $DB_URL < "$migration" 2>/dev/null || echo "  ⚠ Could not apply $(basename $migration)"
            fi
        done
        echo "  ✓ Migrations applied"
    else
        echo "  Remote database detected - clearing data only..."
        # For remote database, just clear the data
        psql $DB_URL <<EOF 2>/dev/null || true
TRUNCATE TABLE subscriptions CASCADE;
TRUNCATE TABLE channels CASCADE;
TRUNCATE TABLE topics CASCADE;
TRUNCATE TABLE users CASCADE;
TRUNCATE TABLE publishers CASCADE;
TRUNCATE TABLE tenants CASCADE;
EOF
        echo "  ✓ Remote database data cleared"
    fi
else
    echo "  ⚠ No .env file found - skipping database reset"
fi

echo "Step 4: Starting backend services..."
cd ../notification-hub
npm start > ../notification-hub.log 2>&1 &
echo "  ✓ Started notification hub (check notification-hub.log for details)"

sleep 3

echo ""
echo "=== Reset Complete ==="
echo ""
echo "Next steps:"
echo "1. Build and run the Electron app:"
echo "   cd receiver-app"
echo "   npm run package && open out/Routed-Receiver-darwin-arm64/Routed-Receiver.app"
echo ""
echo "2. Go through phone verification again to get fresh credentials"
echo "3. Create a new channel and verify:"
echo "   - User shows as online (green dot)"
echo "   - Messages are received in real-time"
echo ""
echo "Backend logs: tail -f notification-hub.log"
echo "App logs: tail -f receiver-app/routed.log"
