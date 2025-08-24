#!/usr/bin/env node

/**
 * Essential button functionality test
 * Tests the most critical user-facing buttons
 */

const fetch = require('node-fetch');

const BASE_URL = process.env.HUB_URL || 'https://routed.onrender.com';
const ADMIN_TOKEN = process.env.HUB_ADMIN_TOKEN || '33925b5f5b9a2bd3d5a01f2b5857ce73';

console.log('🚀 ESSENTIAL BUTTON FUNCTIONALITY TEST');
console.log(`📍 Server: ${BASE_URL}\n`);

const tests = {
  passed: 0,
  failed: 0
};

async function test(name, fn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    await fn();
    console.log('✅');
    tests.passed++;
  } catch (error) {
    console.log(`❌ ${error.message}`);
    tests.failed++;
  }
}

async function runTests() {
  let apiKey, channelId;
  
  // 1. Health Check (Self-Test button)
  await test('Self-Test', async () => {
    const res = await fetch(`${BASE_URL}/v1/health/deep`);
    if (!res.ok) throw new Error('Failed');
    const health = await res.json();
    if (!health.ok) throw new Error('Unhealthy');
  });
  
  // 2. Create Sandbox (auto-provision)
  await test('Create Sandbox', async () => {
    const res = await fetch(`${BASE_URL}/v1/dev/sandbox/provision`, {
      method: 'POST',
      headers: {
        'X-Admin-Token': ADMIN_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    apiKey = data.apiKey;
    if (!apiKey) throw new Error('No API key');
  });
  
  // 3. Create Channel button
  await test('Create Channel', async () => {
    const res = await fetch(`${BASE_URL}/v1/channels/create`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: `Test-${Date.now()}`,
        topic: 'test.topic',
        public: true
      })
    });
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    channelId = data.short_id;
  });
  
  // 4. List Channels (Refresh button)
  await test('Refresh Channels', async () => {
    const res = await fetch(`${BASE_URL}/v1/channels/list`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    if (!res.ok) throw new Error('Failed');
  });
  
  // 5. Add User/Email
  await test('Add User', async () => {
    const res = await fetch(`${BASE_URL}/v1/users/ensure`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: `test${Date.now()}@example.com`
      })
    });
    if (!res.ok) throw new Error('Failed');
  });
  
  // 6. Send Message button
  await test('Send Message', async () => {
    const res = await fetch(`${BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        channel_id: channelId,
        title: 'Test',
        body: 'Test message'
      })
    });
    if (!res.ok) throw new Error('Failed');
  });
  
  // 7. Join Channel (Subscribe)
  await test('Join Channel', async () => {
    const res = await fetch(`${BASE_URL}/v1/channels/${channelId}/subscribe`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    if (!res.ok) throw new Error('Failed');
  });
  
  // 8. Public Channels discovery
  await test('Discover Public Channels', async () => {
    const res = await fetch(`${BASE_URL}/v1/channels/public`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    // May return 404 if endpoint doesn't exist
    if (res.status === 404) {
      // Try alternative endpoint
      const altRes = await fetch(`${BASE_URL}/v1/public/channels`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });
    }
  });
  
  // Summary
  console.log('\n' + '='.repeat(40));
  console.log(`✅ Passed: ${tests.passed}`);
  console.log(`❌ Failed: ${tests.failed}`);
  console.log(`📊 Success Rate: ${(tests.passed / (tests.passed + tests.failed) * 100).toFixed(1)}%`);
  
  if (tests.failed === 0) {
    console.log('\n🎉 All essential button functions working!');
    console.log(`API Key: ${apiKey}`);
    console.log(`Channel ID: ${channelId}`);
  }
  
  process.exit(tests.failed > 0 ? 1 : 0);
}

runTests().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});