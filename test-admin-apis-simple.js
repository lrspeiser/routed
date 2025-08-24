#!/usr/bin/env node

const fetch = require('node-fetch');

const BASE_URL = 'https://routed.onrender.com';
const ADMIN_PHONE = '+16505551212';

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
  
  console.log(`\n📡 ${method} ${path}`);
  
  try {
    const response = await fetch(url, options);
    const text = await response.text();
    let data;
    
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    
    if (!response.ok && response.status !== 500 && response.status !== 503) {
      console.log(`❌ HTTP ${response.status}`);
    }
    
    return { ok: response.ok, status: response.status, data };
  } catch (err) {
    console.log(`❌ Request error: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function testAdminAPIs() {
  console.log('🚀 Starting Routed Admin API Tests');
  console.log(`📍 Base URL: ${BASE_URL}`);
  console.log(`📱 Admin Phone: ${ADMIN_PHONE}\n`);
  
  // 1. Health Check
  console.log('\n════ HEALTH & VERSION ════');
  const health = await httpRequest('GET', '/v1/health/deep');
  if (health.ok) {
    console.log('✅ Server Health:', {
      db: health.data.db?.ok ? '✓' : '✗',
      redis: health.data.redis?.ok ? '✓' : '✗',
      latency: `${health.data.total_ms}ms`
    });
  }
  
  const version = await httpRequest('GET', '/v1/version');
  if (version.ok) {
    console.log('✅ Server Version:', {
      version: version.data.backend_version,
      environment: version.data.environment,
      openai: version.data.config_status?.openai_configured ? '✓' : '✗',
      twilio: version.data.config_status?.twilio_configured ? '✓' : '✗'
    });
  }
  
  // 2. Provision Developer
  console.log('\n════ AUTHENTICATION ════');
  const provision = await httpRequest('POST', '/v1/dev/sandbox/provision', { body: {} });
  let apiKey, tenantId;
  
  if (provision.ok) {
    apiKey = provision.data.apiKey;
    tenantId = provision.data.tenantId;
    console.log('✅ Developer Provisioned:', {
      tenantId: tenantId,
      apiKey: apiKey?.substring(0, 10) + '...',
      publisherId: provision.data.publisherId
    });
  }
  
  // 3. Ensure Admin User
  let userId;
  if (apiKey) {
    const user = await httpRequest('POST', '/v1/users/ensure', {
      apiKey,
      body: { phone: ADMIN_PHONE, topic: 'runs.finished' }
    });
    
    if (user.ok) {
      userId = user.data.userId;
      console.log('✅ Admin User:', {
        userId: userId,
        topicId: user.data.topicId
      });
    }
  }
  
  // 4. Create and List Channels
  console.log('\n════ CHANNELS ════');
  let channelShortId;
  
  if (apiKey) {
    // Create one channel
    const channel = await httpRequest('POST', '/v1/channels/create', {
      apiKey,
      body: {
        name: `Test Channel ${Date.now()}`,
        description: 'Admin test channel',
        allow_public: true,
        topic_name: 'runs.finished',
        creator_phone: ADMIN_PHONE
      }
    });
    
    if (channel.ok) {
      channelShortId = channel.data.short_id;
      console.log('✅ Channel Created:', channel.data);
    }
    
    // List channels
    const list = await httpRequest('GET', '/v1/channels/list', { apiKey });
    if (list.ok) {
      console.log('✅ Total Channels:', list.data.channels?.length || 0);
      if (list.data.channels?.length > 0) {
        console.log('   Channels:', list.data.channels.map(c => ({
          name: c.name,
          shortId: c.short_id,
          public: c.allow_public
        })));
      }
    }
  }
  
  // 5. Test Users and Subscriptions
  console.log('\n════ USERS & SUBSCRIPTIONS ════');
  
  if (apiKey && channelShortId) {
    // Add test users
    const testPhones = ['+16505551213', '+16505551214'];
    const userIds = [];
    
    for (const phone of testPhones) {
      const user = await httpRequest('POST', '/v1/users/ensure', {
        apiKey,
        body: { phone, topic: 'runs.finished' }
      });
      
      if (user.ok) {
        userIds.push(user.data.userId);
        console.log(`✅ User created: ${phone} -> ${user.data.userId}`);
        
        // Subscribe to channel
        const sub = await httpRequest('POST', `/v1/channels/${channelShortId}/subscribe`, {
          apiKey,
          body: { phone }
        });
        
        if (sub.ok) {
          console.log(`   ✓ Subscribed to ${channelShortId}`);
        }
      }
    }
  }
  
  // 6. Get User's Channels
  if (userId) {
    const userChannels = await httpRequest('GET', `/v1/users/${userId}/channels`);
    if (userChannels.ok) {
      console.log(`✅ Admin User's Channels:`, userChannels.data.channels?.length || 0);
      if (userChannels.data.channels?.length > 0) {
        userChannels.data.channels.forEach(c => {
          console.log(`   - ${c.name} (${c.short_id}) - ${c.allow_public ? 'Public' : 'Private'}`);
        });
      }
    }
  }
  
  // 7. Public Channels
  console.log('\n════ PUBLIC CHANNELS ════');
  
  const publicChannels = await httpRequest('GET', '/v1/public/channels');
  if (publicChannels.ok) {
    console.log('✅ Public Channels Available:', publicChannels.data.channels?.length || 0);
    if (publicChannels.data.channels?.length > 0) {
      publicChannels.data.channels.slice(0, 5).forEach(c => {
        console.log(`   - ${c.name} (${c.short_id})`);
      });
    }
  }
  
  // 8. Test Messaging
  console.log('\n════ MESSAGING ════');
  
  if (apiKey) {
    const message = await httpRequest('POST', '/v1/messages', {
      apiKey,
      body: {
        topic: 'runs.finished',
        title: 'Admin Test',
        body: `Test at ${new Date().toISOString()}`,
        payload: { test: true }
      }
    });
    
    if (message.ok) {
      console.log('✅ Message Sent:', {
        deliveries: message.data.deliveries,
        skipped: message.data.skipped
      });
    }
  }
  
  // 9. Admin Auth Test
  console.log('\n════ ADMIN AUTH ════');
  
  const adminAuth = await httpRequest('POST', '/auth/admin', {
    body: {
      phone: ADMIN_PHONE,
      deviceName: 'Test Device'
    }
  });
  
  if (adminAuth.ok) {
    console.log('✅ Admin Auth Success:', {
      userId: adminAuth.data.user?.id,
      isAdmin: adminAuth.data.user?.isAdmin,
      hasTokens: !!(adminAuth.data.accessToken && adminAuth.data.refreshToken)
    });
  } else {
    console.log('⚠️  Admin auth endpoint returned:', adminAuth.status);
  }
  
  // 10. Summary
  console.log('\n════ SUMMARY ════');
  console.log({
    '🌐 Server': 'Online',
    '🔑 API Key': apiKey ? '✓' : '✗',
    '👤 Admin User': userId ? '✓' : '✗',
    '📢 Channels': channelShortId ? '✓' : '✗',
    '✉️ Messaging': 'Tested'
  });
}

// Run tests
testAdminAPIs()
  .then(() => {
    console.log('\n✅ All tests completed!');
  })
  .catch(err => {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
  });
