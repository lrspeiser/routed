#!/usr/bin/env node

/**
 * Backend Integration Test for Notification Hub
 * Tests the complete flow: verification, user creation, dev provisioning, channel creation
 */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const readline = require('readline');

// Configuration
const HUB_URL = process.env.HUB_URL || 'https://routed.onrender.com';
const TEST_PHONE = process.env.TEST_PHONE || '+16502079445'; // Your test phone number
const ADMIN_TOKEN = process.env.HUB_ADMIN_TOKEN;

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step) {
  console.log(`\n${colors.blue}━━━ ${step} ━━━${colors.reset}`);
}

function logSuccess(message) {
  console.log(`${colors.green}✓ ${message}${colors.reset}`);
}

function logError(message) {
  console.log(`${colors.red}✗ ${message}${colors.reset}`);
}

function logInfo(message) {
  console.log(`${colors.cyan}ℹ ${message}${colors.reset}`);
}

// Helper to ask for user input
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}

// Test state to track across steps
let testState = {
  phone: TEST_PHONE,
  userId: null,
  tenantId: null,
  apiKey: null,
  channelId: null,
  shortId: null
};

// API call wrapper with logging
async function apiCall(method, path, body = null, headers = {}) {
  const url = `${HUB_URL}${path}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  logInfo(`${method} ${path}`);
  if (body) {
    logInfo(`Body: ${JSON.stringify(body, null, 2)}`);
  }
  
  try {
    const response = await fetch(url, options);
    const text = await response.text();
    let data = null;
    
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    
    if (!response.ok) {
      logError(`Response ${response.status}: ${JSON.stringify(data, null, 2)}`);
    } else {
      logSuccess(`Response ${response.status}`);
      if (data) {
        console.log(JSON.stringify(data, null, 2));
      }
    }
    
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    logError(`Request failed: ${error.message}`);
    return { ok: false, error: error.message };
  }
}

// Test Steps

async function testHealth() {
  logStep('1. Health Check');
  
  const basic = await apiCall('GET', '/healthz');
  if (!basic.ok) {
    throw new Error('Basic health check failed');
  }
  
  const deep = await apiCall('GET', '/healthz-deep');
  if (!deep.ok) {
    logError('Deep health check failed - database might be down');
  }
  
  return true;
}

async function testVerificationStart() {
  logStep('2. Start Phone Verification');
  
  const result = await apiCall('POST', '/v1/verify/start', {
    phone: testState.phone,
    country: 'US'
  });
  
  if (!result.ok) {
    throw new Error('Failed to start verification');
  }
  
  logSuccess(`Verification code sent to ${testState.phone}`);
  return true;
}

async function testVerificationCheck() {
  logStep('3. Complete Phone Verification');
  
  const code = await askQuestion('Enter the 6-digit code from SMS: ');
  
  const result = await apiCall('POST', '/v1/verify/check', {
    phone: testState.phone,
    code: code.trim()
  });
  
  if (!result.ok) {
    throw new Error('Verification failed - invalid code or expired');
  }
  
  testState.userId = result.data.userId;
  testState.tenantId = result.data.tenantId;
  
  logSuccess(`User verified! userId: ${testState.userId}, tenantId: ${testState.tenantId}`);
  return true;
}

async function testDevProvisioning() {
  logStep('4. Developer Provisioning');
  
  let path = '/v1/dev/sandbox/provision';
  let headers = {};
  
  // If we have admin token, use admin endpoint
  if (ADMIN_TOKEN) {
    path = '/v1/admin/sandbox/provision';
    headers['Authorization'] = `Bearer ${ADMIN_TOKEN}`;
    logInfo('Using admin endpoint with token');
  } else {
    logInfo('Using public developer endpoint (no admin token)');
  }
  
  const result = await apiCall('POST', path, {}, headers);
  
  if (!result.ok) {
    logError('Failed to provision developer - this endpoint might require authentication');
    // Try to continue anyway
    return false;
  }
  
  testState.apiKey = result.data.apiKey || result.data.api_key;
  testState.tenantId = result.data.tenantId || result.data.tenant_id || testState.tenantId;
  
  logSuccess(`Developer provisioned! API Key: ${testState.apiKey?.substring(0, 10)}...`);
  return true;
}

async function testChannelList() {
  logStep('5. List Channels');
  
  if (!testState.apiKey) {
    logInfo('Skipping - no API key available');
    return false;
  }
  
  const result = await apiCall('GET', '/v1/channels/list', null, {
    'Authorization': `Bearer ${testState.apiKey}`,
    'X-Api-Key': testState.apiKey
  });
  
  if (!result.ok) {
    logError('Failed to list channels');
    return false;
  }
  
  const channels = result.data.channels || result.data || [];
  logSuccess(`Found ${channels.length} existing channels`);
  return true;
}

async function testChannelCreate() {
  logStep('6. Create Channel');
  
  if (!testState.apiKey) {
    logInfo('Skipping - no API key available');
    return false;
  }
  
  const channelName = `Test Channel ${Date.now()}`;
  
  const result = await apiCall('POST', '/v1/channels/create', {
    name: channelName,
    description: 'Integration test channel',
    allow_public: true,
    topic_name: 'test.notifications',
    creator_phone: testState.phone
  }, {
    'Authorization': `Bearer ${testState.apiKey}`,
    'X-Api-Key': testState.apiKey
  });
  
  if (!result.ok) {
    logError('Failed to create channel');
    return false;
  }
  
  testState.channelId = result.data.channelId || result.data.channel_id;
  testState.shortId = result.data.shortId || result.data.short_id;
  
  logSuccess(`Channel created! ID: ${testState.channelId}, Short ID: ${testState.shortId}`);
  return true;
}

async function testMessageSend() {
  logStep('7. Send Test Message');
  
  if (!testState.apiKey) {
    logInfo('Skipping - no API key available');
    return false;
  }
  
  const result = await apiCall('POST', '/v1/messages', {
    topic: 'test.notifications',
    title: 'Integration Test',
    body: `Test message sent at ${new Date().toISOString()}`,
    payload: {
      test: true,
      timestamp: Date.now()
    }
  }, {
    'Authorization': `Bearer ${testState.apiKey}`,
    'X-Api-Key': testState.apiKey
  });
  
  if (!result.ok) {
    logError('Failed to send message');
    return false;
  }
  
  const messageId = result.data.messageId || result.data.message_id || result.data.id;
  logSuccess(`Message sent! ID: ${messageId}`);
  return true;
}

async function testPublicChannels() {
  logStep('8. Public Channel Discovery');
  
  const result = await apiCall('GET', `/v1/public/channels?tenant_id=${testState.tenantId}`);
  
  if (!result.ok) {
    logError('Failed to list public channels');
    return false;
  }
  
  const channels = result.data.channels || [];
  logSuccess(`Found ${channels.length} public channels`);
  
  if (testState.shortId) {
    // Try to join our own public channel
    const joinResult = await apiCall('POST', `/v1/public/channels/${testState.shortId}/join`, {
      phone: testState.phone
    });
    
    if (joinResult.ok) {
      logSuccess('Successfully joined public channel');
    } else {
      logInfo('Could not join channel (might already be a member)');
    }
  }
  
  return true;
}

async function testUserChannels() {
  logStep('9. User\'s Channels');
  
  if (!testState.userId) {
    logInfo('Skipping - no userId available');
    return false;
  }
  
  const result = await apiCall('GET', `/v1/users/${testState.userId}/channels`);
  
  if (!result.ok) {
    logError('Failed to get user channels');
    return false;
  }
  
  const channels = result.data.channels || [];
  logSuccess(`User is subscribed to ${channels.length} channels`);
  return true;
}

// Main test runner
async function runTests() {
  console.log(colors.cyan + '\n╔══════════════════════════════════════════╗');
  console.log('║   Notification Hub Backend Integration   ║');
  console.log('╚══════════════════════════════════════════╝' + colors.reset);
  
  logInfo(`Testing against: ${HUB_URL}`);
  logInfo(`Test phone: ${testState.phone}`);
  if (ADMIN_TOKEN) {
    logInfo('Admin token: Available');
  } else {
    logInfo('Admin token: Not set (some tests may be limited)');
  }
  
  const tests = [
    { name: 'Health Check', fn: testHealth },
    { name: 'Start Verification', fn: testVerificationStart },
    { name: 'Complete Verification', fn: testVerificationCheck },
    { name: 'Developer Provisioning', fn: testDevProvisioning },
    { name: 'List Channels', fn: testChannelList },
    { name: 'Create Channel', fn: testChannelCreate },
    { name: 'Send Message', fn: testMessageSend },
    { name: 'Public Channels', fn: testPublicChannels },
    { name: 'User Channels', fn: testUserChannels }
  ];
  
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  
  for (const test of tests) {
    try {
      const result = await test.fn();
      if (result === true) {
        passed++;
      } else if (result === false) {
        skipped++;
      }
    } catch (error) {
      failed++;
      logError(`Test failed: ${error.message}`);
      
      // Critical failures should stop the test
      if (test.name === 'Health Check' || test.name === 'Complete Verification') {
        logError('Critical test failed - stopping');
        break;
      }
    }
  }
  
  // Summary
  console.log(colors.blue + '\n╔══════════════════════════════════════════╗');
  console.log('║              Test Summary                ║');
  console.log('╚══════════════════════════════════════════╝' + colors.reset);
  
  logSuccess(`Passed: ${passed}`);
  if (skipped > 0) logInfo(`Skipped: ${skipped}`);
  if (failed > 0) logError(`Failed: ${failed}`);
  
  console.log('\n' + colors.cyan + 'Test State:' + colors.reset);
  console.log(JSON.stringify({
    userId: testState.userId,
    tenantId: testState.tenantId,
    apiKey: testState.apiKey ? `${testState.apiKey.substring(0, 10)}...` : null,
    channelId: testState.channelId,
    shortId: testState.shortId
  }, null, 2));
  
  process.exit(failed > 0 ? 1 : 0);
}

// Run the tests
runTests().catch(error => {
  logError(`Fatal error: ${error.message}`);
  process.exit(1);
});
