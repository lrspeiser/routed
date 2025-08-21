#!/usr/bin/env node

/**
 * Admin Backend Test - Tests core functionality without phone verification
 */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Configuration
const HUB_URL = process.env.HUB_URL || 'https://routed.onrender.com';
const ADMIN_TOKEN = process.env.HUB_ADMIN_TOKEN || '33925b5f5b9a2bd3d5a01f2b5857ce73';

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

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

// Test state
let testState = {
  tenantId: null,
  userId: null,
  apiKey: null,
  channelId: null,
  shortId: null,
  messageId: null
};

// API call wrapper
async function apiCall(method, path, body = null, useAdminAuth = true) {
  const url = `${HUB_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json'
  };
  
  if (useAdminAuth && ADMIN_TOKEN) {
    headers['Authorization'] = `Bearer ${ADMIN_TOKEN}`;
  } else if (testState.apiKey) {
    headers['Authorization'] = `Bearer ${testState.apiKey}`;
    headers['X-Api-Key'] = testState.apiKey;
  }
  
  const options = {
    method,
    headers
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  logInfo(`${method} ${path}`);
  
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
      return { ok: false, status: response.status, data };
    }
    
    logSuccess(`Response ${response.status}`);
    return { ok: true, status: response.status, data };
  } catch (error) {
    logError(`Request failed: ${error.message}`);
    return { ok: false, error: error.message };
  }
}

// Test functions
async function testHealth() {
  logStep('1. Health Check');
  
  const basic = await apiCall('GET', '/healthz', null, false);
  if (!basic.ok) return false;
  logSuccess('Basic health check passed');
  
  const deep = await apiCall('GET', '/healthz-deep', null, false);
  if (!deep.ok) return false;
  logSuccess('Deep health check passed');
  
  return true;
}

async function testProvisionDeveloper() {
  logStep('2. Provision Developer (Admin)');
  
  const result = await apiCall('POST', '/v1/admin/sandbox/provision', {});
  if (!result.ok) return false;
  
  testState.tenantId = result.data.tenantId || result.data.tenant_id;
  testState.userId = result.data.userId || result.data.user_id;
  testState.apiKey = result.data.apiKey || result.data.api_key;
  
  logSuccess(`Tenant: ${testState.tenantId}`);
  logSuccess(`User: ${testState.userId}`);
  logSuccess(`API Key: ${testState.apiKey?.substring(0, 20)}...`);
  
  return true;
}

async function testEnsureUser() {
  logStep('3. Ensure User with Phone');
  
  const testPhone = '+15551234567';
  const result = await apiCall('POST', '/v1/admin/users/ensure', {
    tenant_id: testState.tenantId,
    phone: testPhone,
    topic: 'test.topic'
  });
  
  if (!result.ok) return false;
  
  logSuccess(`User ensured: ${result.data.userId || result.data.user_id}`);
  logSuccess(`Phone: ${testPhone}`);
  
  return true;
}

async function testListChannels() {
  logStep('4. List Channels');
  
  const result = await apiCall('GET', '/v1/channels/list', null, false);
  if (!result.ok) return false;
  
  const channels = result.data.channels || result.data || [];
  logSuccess(`Found ${channels.length} channels`);
  
  return true;
}

async function testCreateChannel() {
  logStep('5. Create Channel');
  
  const channelName = `Admin Test ${Date.now()}`;
  const result = await apiCall('POST', '/v1/channels/create', {
    name: channelName,
    description: 'Created by admin test',
    allow_public: true,
    topic_name: 'admin.test'
  }, false);
  
  if (!result.ok) return false;
  
  testState.channelId = result.data.channelId || result.data.channel_id;
  testState.shortId = result.data.shortId || result.data.short_id;
  
  logSuccess(`Channel created: ${channelName}`);
  logSuccess(`Channel ID: ${testState.channelId}`);
  logSuccess(`Short ID: ${testState.shortId}`);
  
  return true;
}

async function testSendMessage() {
  logStep('6. Send Message');
  
  const result = await apiCall('POST', '/v1/messages', {
    topic: 'admin.test',
    title: 'Admin Test Message',
    body: `Sent at ${new Date().toISOString()}`,
    payload: {
      test: true,
      timestamp: Date.now()
    }
  }, false);
  
  if (!result.ok) return false;
  
  testState.messageId = result.data.messageId || result.data.message_id || result.data.id;
  logSuccess(`Message sent: ${testState.messageId}`);
  
  return true;
}

async function testPublicChannels() {
  logStep('7. Public Channels');
  
  const result = await apiCall('GET', `/v1/public/channels?tenant_id=${testState.tenantId}`, null, false);
  if (!result.ok) return false;
  
  const channels = result.data.channels || [];
  logSuccess(`Found ${channels.length} public channels in tenant`);
  
  // Check if our channel is in the list
  const ourChannel = channels.find(c => c.short_id === testState.shortId);
  if (ourChannel) {
    logSuccess(`Our channel "${ourChannel.name}" is publicly discoverable`);
  }
  
  return true;
}

async function testWebSocket() {
  logStep('8. WebSocket Connection Test');
  
  logInfo(`Would connect to: wss://routed.onrender.com/v1/socket?user_id=${testState.userId}`);
  logInfo('WebSocket test requires a full client - skipping in this script');
  
  return true;
}

async function testDatabaseSchema() {
  logStep('9. Database Schema Check');
  
  const result = await apiCall('GET', '/v1/health/schema', null, false);
  if (!result.ok) {
    logError('Schema health check failed - might need migrations');
    return false;
  }
  
  logSuccess('Database schema is healthy');
  return true;
}

// Main runner
async function runTests() {
  console.log(colors.cyan + '\n╔══════════════════════════════════════════╗');
  console.log('║     Admin Backend Test (No Phone Verify) ║');
  console.log('╚══════════════════════════════════════════╝' + colors.reset);
  
  logInfo(`Hub URL: ${HUB_URL}`);
  logInfo(`Admin Token: ${ADMIN_TOKEN.substring(0, 10)}...`);
  
  const tests = [
    testHealth,
    testProvisionDeveloper,
    testEnsureUser,
    testListChannels,
    testCreateChannel,
    testSendMessage,
    testPublicChannels,
    testWebSocket,
    testDatabaseSchema
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      const result = await test();
      if (result) {
        passed++;
      } else {
        failed++;
      }
    } catch (error) {
      failed++;
      logError(`Unexpected error: ${error.message}`);
    }
  }
  
  // Summary
  console.log(colors.blue + '\n╔══════════════════════════════════════════╗');
  console.log('║              Test Summary                ║');
  console.log('╚══════════════════════════════════════════╝' + colors.reset);
  
  logSuccess(`Passed: ${passed}/${tests.length}`);
  if (failed > 0) logError(`Failed: ${failed}/${tests.length}`);
  
  console.log('\n' + colors.cyan + 'Final State:' + colors.reset);
  console.log(JSON.stringify({
    tenantId: testState.tenantId,
    userId: testState.userId,
    apiKey: testState.apiKey ? `${testState.apiKey.substring(0, 20)}...` : null,
    channelId: testState.channelId,
    shortId: testState.shortId,
    messageId: testState.messageId
  }, null, 2));
  
  const exitCode = failed > 0 ? 1 : 0;
  console.log(`\n${exitCode === 0 ? colors.green : colors.red}Exit code: ${exitCode}${colors.reset}`);
  process.exit(exitCode);
}

// Run
runTests().catch(error => {
  logError(`Fatal error: ${error.message}`);
  process.exit(1);
});
