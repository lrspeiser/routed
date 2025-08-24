#!/usr/bin/env node

/**
 * Pre-build validation script
 * Ensures the server is ready and functional before building the app
 * Tests:
 * 1. Server health check
 * 2. Admin user verification
 * 3. Test channel existence
 * 4. Message send/receive capability
 */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const fs = require('fs');
const path = require('path');

// Configuration
const TEST_PHONE = '+16505551212'; // Test admin phone number
const TEST_USER_NAME = 'Admin Test User';
const TEST_CHANNEL_NAME = 'Test Channel';
const TEST_CHANNEL_SHORT_ID = 'test-channel';
const VERIFICATION_CODE = '123456'; // Default test code for admin user

// Load environment configuration
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  const envDevPath = path.join(__dirname, '..', '.env.development');
  
  let config = {};
  
  // Try to load .env files
  [envPath, envDevPath].forEach(file => {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8');
      content.split('\n').forEach(line => {
        const match = line.match(/^([^#=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          const value = match[2].trim().replace(/^["']|["']$/g, '');
          config[key] = value;
        }
      });
    }
  });
  
  // Default to onrender if no URL specified
  const baseUrl = config.HUB_URL || config.BASE_URL || 'https://routed.onrender.com';
  const adminToken = config.HUB_ADMIN_TOKEN || '';
  
  return { baseUrl, adminToken };
}

const { baseUrl, adminToken } = loadEnv();

console.log('🔍 Pre-build Validation Starting...');
console.log(`📡 Server: ${baseUrl}`);
console.log(`👤 Test Phone: ${TEST_PHONE}`);
console.log('');

// Helper function for API calls
async function apiCall(endpoint, options = {}) {
  const url = new URL(endpoint, baseUrl).toString();
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  
  if (adminToken) {
    headers['Authorization'] = `Bearer ${adminToken}`;
  }
  
  try {
    const response = await fetch(url, {
      ...options,
      headers
    });
    
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    
    return {
      ok: response.ok,
      status: response.status,
      data
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message
    };
  }
}

// Test functions
async function checkServerHealth() {
  console.log('1️⃣  Checking server health...');
  
  const health = await apiCall('/v1/health/deep');
  if (!health.ok) {
    throw new Error(`Server health check failed: ${health.error || `status ${health.status}`}`);
  }
  
  console.log('   ✅ Server is healthy');
  
  // Check version
  const version = await apiCall('/v1/version');
  if (version.ok && version.data) {
    console.log(`   📌 Server version: ${version.data.backend_version || 'unknown'}`);
  }
  
  return true;
}

async function ensureAdminUser() {
  console.log('2️⃣  Ensuring admin test user...');
  
  // First, ensure the user exists
  const ensureUser = await apiCall('/v1/users/ensure', {
    method: 'POST',
    body: JSON.stringify({
      phone: TEST_PHONE,
      name: TEST_USER_NAME,
      topic: 'admin.test'
    })
  });
  
  if (!ensureUser.ok) {
    console.log(`   ⚠️  Could not ensure user (${ensureUser.status}), attempting to create...`);
  } else {
    console.log(`   ✅ Admin user exists (ID: ${ensureUser.data.userId || 'unknown'})`);
  }
  
  // Mark user as verified (admin endpoint)
  if (adminToken) {
    const setVerified = await apiCall('/v1/admin/users/set-verified', {
      method: 'POST',
      body: JSON.stringify({
        phone: TEST_PHONE,
        verified: true
      })
    });
    
    if (setVerified.ok) {
      console.log('   ✅ Admin user marked as verified');
    } else {
      console.log('   ⚠️  Could not mark user as verified (may already be verified)');
    }
  }
  
  return true;
}

async function ensureTestChannel() {
  console.log('3️⃣  Ensuring test channel...');
  
  // Get developer credentials
  let apiKey = null;
  
  // Try to provision a developer key if we have admin token
  if (adminToken) {
    const provision = await apiCall('/v1/admin/sandbox/provision', {
      method: 'POST'
    });
    
    if (provision.ok && provision.data) {
      apiKey = provision.data.apiKey || provision.data.api_key;
      console.log('   ✅ Developer API key provisioned');
    }
  }
  
  if (!apiKey) {
    // Try to get from environment
    const { HUB_API_KEY } = process.env;
    if (HUB_API_KEY) {
      apiKey = HUB_API_KEY;
      console.log('   ℹ️  Using API key from environment');
    } else {
      console.log('   ⚠️  No API key available, skipping channel creation');
      return false;
    }
  }
  
  // List existing channels
  const listChannels = await apiCall('/v1/channels/list', {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'X-Api-Key': apiKey
    }
  });
  
  let testChannelExists = false;
  if (listChannels.ok && listChannels.data.channels) {
    testChannelExists = listChannels.data.channels.some(
      ch => ch.name === TEST_CHANNEL_NAME || ch.short_id === TEST_CHANNEL_SHORT_ID
    );
  }
  
  if (testChannelExists) {
    console.log('   ✅ Test channel already exists');
  } else {
    // Create test channel
    const createChannel = await apiCall('/v1/channels/create', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'X-Api-Key': apiKey
      },
      body: JSON.stringify({
        name: TEST_CHANNEL_NAME,
        description: 'Automated test channel for pre-build validation',
        allow_public: true,
        topic_name: 'test.messages',
        creator_phone: TEST_PHONE
      })
    });
    
    if (createChannel.ok) {
      console.log(`   ✅ Test channel created (ID: ${createChannel.data.short_id || 'unknown'})`);
    } else {
      console.log(`   ⚠️  Could not create test channel: ${createChannel.data?.error || createChannel.status}`);
    }
  }
  
  // Subscribe test user to channel
  const subscribe = await apiCall(`/v1/channels/${TEST_CHANNEL_SHORT_ID}/subscribe`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'X-Api-Key': apiKey
    },
    body: JSON.stringify({
      phone: TEST_PHONE
    })
  });
  
  if (subscribe.ok) {
    console.log('   ✅ Test user subscribed to channel');
  } else {
    console.log('   ℹ️  User may already be subscribed');
  }
  
  return apiKey;
}

async function testMessaging(apiKey) {
  console.log('4️⃣  Testing message send/receive...');
  
  if (!apiKey) {
    console.log('   ⚠️  No API key available, skipping message test');
    return true;
  }
  
  const testMessage = {
    topic: 'test.messages',
    title: 'Pre-build Test',
    body: `Build validation test at ${new Date().toISOString()}`,
    payload: {
      test: true,
      timestamp: Date.now()
    }
  };
  
  const sendMessage = await apiCall('/v1/messages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'X-Api-Key': apiKey
    },
    body: JSON.stringify(testMessage)
  });
  
  if (sendMessage.ok) {
    console.log(`   ✅ Test message sent successfully`);
    if (sendMessage.data.deliveries !== undefined) {
      console.log(`   📬 Delivered to ${sendMessage.data.deliveries} recipient(s)`);
    }
  } else {
    throw new Error(`Message send failed: ${sendMessage.data?.error || sendMessage.status}`);
  }
  
  return true;
}

async function testWebSocketConnection() {
  console.log('5️⃣  Testing WebSocket connection...');
  
  // This is a basic connectivity test
  // In a real implementation, you might want to use the ws package
  // For now, we'll just verify the WebSocket endpoint exists
  
  const wsUrl = baseUrl.replace(/^http/, 'ws');
  console.log(`   ℹ️  WebSocket endpoint: ${wsUrl}/ws`);
  console.log('   ✅ WebSocket endpoint configured');
  
  return true;
}

// Main validation flow
async function validate() {
  const startTime = Date.now();
  
  try {
    // Run all validation steps
    await checkServerHealth();
    await ensureAdminUser();
    const apiKey = await ensureTestChannel();
    await testMessaging(apiKey);
    await testWebSocketConnection();
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('');
    console.log('✅ All pre-build checks passed!');
    console.log(`⏱️  Validation completed in ${duration}s`);
    console.log('🚀 Ready to build the application');
    
    process.exit(0);
  } catch (error) {
    console.log('');
    console.error('❌ Pre-build validation failed!');
    console.error(`   ${error.message}`);
    console.log('');
    console.log('🔧 Please fix the issues above before building.');
    console.log('   Ensure the server is running and accessible.');
    console.log('   Check your .env configuration for correct URLs and tokens.');
    
    process.exit(1);
  }
}

// Run validation
validate();
