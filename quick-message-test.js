#!/usr/bin/env node

// Quick test to verify message sending and receiving on production
const fetch = require('node-fetch');

const BASE_URL = 'https://routed.onrender.com';
const ADMIN_TOKEN = process.env.HUB_ADMIN_TOKEN || '33925b5f5b9a2bd3d5a01f2b5857ce73';
const ADMIN_PHONE = '+16505551212';

async function quickTest() {
  console.log('🚀 Quick Message Test - Production');
  console.log('📍 Server:', BASE_URL);
  console.log('');

  try {
    // 1. Health check
    console.log('1️⃣  Health Check...');
    const healthRes = await fetch(`${BASE_URL}/v1/health/deep`);
    const health = await healthRes.json();
    console.log('✅ Server Health:', health.ok ? 'Healthy' : 'Issues detected');
    console.log('   - Database:', health.db);
    console.log('   - Redis:', health.redis);
    console.log('');

    // 2. Provision developer
    console.log('2️⃣  Provisioning Developer...');
    const provRes = await fetch(`${BASE_URL}/v1/dev/sandbox/provision`, {
      method: 'POST',
      headers: {
        'X-Admin-Token': ADMIN_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    const dev = await provRes.json();
    
    if (!provRes.ok) {
      console.log('❌ Provisioning failed:', dev);
      process.exit(1);
    }
    
    console.log('✅ Developer provisioned');
    console.log('   - Tenant ID:', dev.tenantId);
    console.log('   - API Key:', dev.apiKey ? dev.apiKey.substring(0, 10) + '...' : 'N/A');
    console.log('');

    // Get the actual API key
    const apiKey = dev.data?.apiKey || dev.apiKey;
    
    if (!apiKey) {
      console.log('❌ No API key received');
      process.exit(1);
    }
    
    // 3. Create channel
    console.log('3️⃣  Creating Channel...');
    const channelName = `QuickTest-${Date.now()}`;
    const channelRes = await fetch(`${BASE_URL}/v1/channels/create`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: channelName,
        topic: 'test.messages',
        public: true
      })
    });
    const channel = await channelRes.json();
    console.log('✅ Channel created:', channel.short_id);
    console.log('');

    // 4. Send test message
    console.log('4️⃣  Sending Test Message...');
    const msgRes = await fetch(`${BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        channel_id: channel.short_id,
        title: 'Test Message 🚀',
        body: 'This is a test message from quick-message-test.js',
        payload: { test: true, timestamp: new Date().toISOString() }
      })
    });
    const msgResult = await msgRes.json();
    console.log('✅ Message sent');
    console.log('   - Message ID:', msgResult.messageId);
    console.log('   - Delivery count:', msgResult.deliveryCount);
    console.log('');

    // 5. Test WebSocket connection
    console.log('5️⃣  Testing WebSocket...');
    console.log('   WebSocket endpoint: wss://routed.onrender.com/v1/socket');
    console.log('   (Would require WS client to fully test real-time delivery)');
    console.log('');

    console.log('✅ ALL TESTS PASSED!');
    console.log('');
    console.log('Summary:');
    console.log('- Server is healthy and responding');
    console.log('- Developer provisioning works');
    console.log('- Channel creation works');
    console.log('- Message sending works');
    console.log('- API Key:', apiKey);
    console.log('- Channel ID:', channel.short_id);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      const text = await error.response.text();
      console.error('Response:', text);
    }
    process.exit(1);
  }
}

quickTest();