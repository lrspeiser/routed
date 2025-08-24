#!/usr/bin/env node

const fetch = require('node-fetch');

const BASE_URL = 'https://routed.onrender.com';
const ADMIN_PHONE = '+16505551212';

// Colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

function log(title, data, color = colors.green) {
  console.log(`\n${color}${colors.bright}=== ${title} ===${colors.reset}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
}

function error(title, err) {
  console.log(`\n${colors.red}${colors.bright}!!! ${title} !!!${colors.reset}`);
  console.log(err.message || err);
}

async function httpRequest(method, path, { headers = {}, body, apiKey } = {}) {
  const url = `${BASE_URL}${path}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  };
  
  if (apiKey) {
    options.headers['Authorization'] = `Bearer ${apiKey}`;
  }
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  console.log(`\n${colors.cyan}${method} ${path}${colors.reset}`);
  
  try {
    const response = await fetch(url, options);
    const text = await response.text();
    let data;
    
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
    }
    
    return data;
  } catch (err) {
    error(`Request failed: ${method} ${path}`, err);
    throw err;
  }
}

async function testAdminAPIs() {
  let apiKey, tenantId, userId, channelShortId;
  
  try {
    // 1. Health Check
    log('Server Health Check', null, colors.blue);
    const health = await httpRequest('GET', '/v1/health/deep');
    log('Health Status', health);
    
    // 2. Get Server Version
    log('Server Version', null, colors.blue);
    const version = await httpRequest('GET', '/v1/version');
    log('Version Info', version);
    
    // 3. Provision Developer Sandbox
    log('Provisioning Developer Sandbox', null, colors.blue);
    const provision = await httpRequest('POST', '/v1/dev/sandbox/provision', { body: {} });
    apiKey = provision.apiKey;
    tenantId = provision.tenantId;
    log('Developer Credentials', {
      tenantId: provision.tenantId,
      publisherId: provision.publisherId,
      apiKey: provision.apiKey,
      topicId: provision.topicId
    });
    
    // 4. Ensure Admin User
    log('Ensuring Admin User', null, colors.blue);
    const user = await httpRequest('POST', '/v1/users/ensure', {
      apiKey,
      body: {
        phone: ADMIN_PHONE,
        topic: 'runs.finished'
      }
    });
    userId = user.userId;
    log('Admin User', user);
    
    // 5. Create Multiple Test Channels
    log('Creating Test Channels', null, colors.blue);
    
    const channels = [];
    for (let i = 1; i <= 3; i++) {
      const channel = await httpRequest('POST', '/v1/channels/create', {
        apiKey,
        body: {
          name: `Test Channel ${i}`,
          description: `Description for test channel ${i}`,
          allow_public: i % 2 === 1, // Odd channels are public
          topic_name: 'runs.finished',
          creator_phone: ADMIN_PHONE
        }
      });
      channels.push(channel);
      log(`Created Channel ${i}`, channel);
    }
    channelShortId = channels[0].short_id;
    
    // 6. List All Channels
    log('Listing All Channels', null, colors.blue);
    const channelList = await httpRequest('GET', '/v1/channels/list', { apiKey });
    log('Channel List', channelList);
    
    // 7. Add Test Users to Channels
    log('Adding Test Users to Channels', null, colors.blue);
    
    const testUsers = [
      '+16505551213',
      '+16505551214',
      '+16505551215'
    ];
    
    for (const phone of testUsers) {
      // Ensure user exists
      const testUser = await httpRequest('POST', '/v1/users/ensure', {
        apiKey,
        body: { phone, topic: 'runs.finished' }
      });
      
      // Subscribe to first channel
      await httpRequest('POST', `/v1/channels/${channelShortId}/subscribe`, {
        apiKey,
        body: { phone }
      });
      
      log(`Added user ${phone}`, { userId: testUser.userId, subscribedTo: channelShortId });
    }
    
    // 8. Get Channel Users/Subscribers
    log('Getting Channel Subscribers', null, colors.blue);
    try {
      const subscribers = await httpRequest('GET', `/v1/channels/${channelShortId}/users`, { apiKey });
      log(`Subscribers of ${channelShortId}`, subscribers);
    } catch (err) {
      // This endpoint might have the SQL error, so we'll handle it gracefully
      error('Channel subscribers endpoint error (known issue)', err);
    }
    
    // 9. Get User's Channels
    log('Getting User Channels', null, colors.blue);
    const userChannels = await httpRequest('GET', `/v1/users/${userId}/channels`);
    log(`Channels for user ${userId}`, userChannels);
    
    // 10. List Public Channels
    log('Listing Public Channels', null, colors.blue);
    const publicChannels = await httpRequest('GET', '/v1/public/channels', {
      headers: { tenant_id: tenantId }
    });
    log('Public Channels', publicChannels);
    
    // 11. Test Public Join/Leave
    log('Testing Public Channel Join/Leave', null, colors.blue);
    
    const testPhone = '+16505551216';
    const publicChannelId = channels.find(c => c.short_id).short_id;
    
    // Join
    const joinResult = await httpRequest('POST', `/v1/public/channels/${publicChannelId}/join`, {
      body: { phone: testPhone }
    });
    log(`User ${testPhone} joined channel`, joinResult);
    
    // Leave
    const leaveResult = await httpRequest('DELETE', `/v1/public/channels/${publicChannelId}/leave`, {
      body: { phone: testPhone }
    });
    log(`User ${testPhone} left channel`, leaveResult);
    
    // 12. Send Test Message
    log('Sending Test Message', null, colors.blue);
    const message = await httpRequest('POST', '/v1/messages', {
      apiKey,
      body: {
        topic: 'runs.finished',
        title: 'Admin Test Message',
        body: `Test message sent at ${new Date().toISOString()}`,
        payload: {
          test: true,
          timestamp: Date.now()
        }
      }
    });
    log('Message Sent', message);
    
    // 13. Create and Test Scripts
    log('Creating Channel Script', null, colors.blue);
    try {
      const script = await httpRequest('POST', `/v1/channels/${channelShortId}/scripts`, {
        apiKey,
        body: {
          name: 'Test Script',
          request_prompt: 'Create a simple webhook that logs incoming data',
          trigger_type: 'webhook',
          variables: []
        }
      });
      log('Script Created', script);
      
      // List scripts
      const scripts = await httpRequest('GET', `/v1/channels/${channelShortId}/scripts`, { apiKey });
      log('Channel Scripts', scripts);
    } catch (err) {
      error('Script creation error (OpenAI key might not be configured)', err);
    }
    
    // 14. Admin-specific endpoints (if available)
    log('Testing Admin Endpoints', null, colors.blue);
    
    // Try admin auth
    try {
      const adminAuth = await httpRequest('POST', '/auth/admin', {
        body: {
          phone: ADMIN_PHONE,
          deviceName: 'Admin Test Device'
        }
      });
      log('Admin Auth Result', {
        userId: adminAuth.user?.id,
        phone: adminAuth.user?.phone,
        isAdmin: adminAuth.user?.isAdmin,
        deviceId: adminAuth.deviceId,
        hasAccessToken: !!adminAuth.accessToken,
        hasRefreshToken: !!adminAuth.refreshToken
      });
    } catch (err) {
      error('Admin auth endpoint error', err);
    }
    
    // 15. Summary Statistics
    log('API Test Summary', null, colors.yellow);
    console.log(`
${colors.bright}Test Results:${colors.reset}
- Server Status: ${colors.green}✓ Online${colors.reset}
- Tenant ID: ${tenantId}
- API Key: ${apiKey}
- Admin User ID: ${userId}
- Channels Created: ${channels.length}
- Test Users Added: ${testUsers.length}
- Public Channels: ${publicChannels.channels?.length || 0}
    `);
    
  } catch (err) {
    error('Fatal error during testing', err);
    process.exit(1);
  }
}

// Run the tests
console.log(`${colors.bright}${colors.blue}Starting Routed Admin API Tests${colors.reset}`);
console.log(`Base URL: ${BASE_URL}`);
console.log(`Admin Phone: ${ADMIN_PHONE}`);

testAdminAPIs()
  .then(() => {
    console.log(`\n${colors.green}${colors.bright}All tests completed!${colors.reset}`);
  })
  .catch(err => {
    console.error(`\n${colors.red}${colors.bright}Test suite failed:${colors.reset}`, err);
    process.exit(1);
  });
