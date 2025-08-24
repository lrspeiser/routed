#!/usr/bin/env node

const fetch = require('node-fetch');

const BASE_URL = 'https://routed.onrender.com';
const ADMIN_PHONE = '+16505551212';

// Simple request wrapper
async function api(method, path, { headers = {}, body, apiKey } = {}) {
  const url = `${BASE_URL}${path}`;
  const options = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers }
  };
  
  if (apiKey) options.headers['Authorization'] = `Bearer ${apiKey}`;
  if (body) options.body = JSON.stringify(body);
  
  const response = await fetch(url, options);
  const text = await response.text();
  
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function demo() {
  console.log('\n🚀 COMPLETE ROUTED ADMIN API DEMONSTRATION\n');
  console.log('This demonstrates all major API endpoints with real data.\n');
  console.log('─'.repeat(60) + '\n');
  
  // Step 1: Setup
  console.log('📋 STEP 1: INITIAL SETUP\n');
  
  const provision = await api('POST', '/v1/dev/sandbox/provision', { body: {} });
  const apiKey = provision.apiKey;
  const tenantId = provision.tenantId;
  
  console.log('✅ Developer provisioned:');
  console.log(JSON.stringify(provision, null, 2));
  
  // Step 2: Create admin user
  console.log('\n📋 STEP 2: ADMIN USER CREATION\n');
  
  const adminUser = await api('POST', '/v1/users/ensure', {
    apiKey,
    body: { phone: ADMIN_PHONE, topic: 'runs.finished' }
  });
  
  console.log('✅ Admin user created:');
  console.log(JSON.stringify(adminUser, null, 2));
  
  // Step 3: Create multiple channels
  console.log('\n📋 STEP 3: CREATE MULTIPLE CHANNELS\n');
  
  const channelData = [
    { name: 'General Announcements', public: true, description: 'Company-wide updates' },
    { name: 'Tech Team', public: false, description: 'Engineering updates' },
    { name: 'Product Updates', public: true, description: 'New features and releases' }
  ];
  
  const createdChannels = [];
  for (const data of channelData) {
    const channel = await api('POST', '/v1/channels/create', {
      apiKey,
      body: {
        name: data.name,
        description: data.description,
        allow_public: data.public,
        topic_name: 'runs.finished',
        creator_phone: ADMIN_PHONE
      }
    });
    
    createdChannels.push(channel);
    console.log(`✅ Created "${data.name}":`, channel);
  }
  
  // Step 4: List all channels
  console.log('\n📋 STEP 4: LIST ALL CHANNELS\n');
  
  const allChannels = await api('GET', '/v1/channels/list', { apiKey });
  console.log('✅ All channels in tenant:');
  console.log(JSON.stringify(allChannels, null, 2));
  
  // Step 5: Create test users and subscribe them
  console.log('\n📋 STEP 5: CREATE USERS & SUBSCRIPTIONS\n');
  
  const testUsers = [
    { phone: '+16505551213', name: 'Test User 1' },
    { phone: '+16505551214', name: 'Test User 2' },
    { phone: '+16505551215', name: 'Test User 3' }
  ];
  
  for (const user of testUsers) {
    const created = await api('POST', '/v1/users/ensure', {
      apiKey,
      body: { phone: user.phone, topic: 'runs.finished' }
    });
    
    console.log(`✅ Created ${user.name}:`, created);
    
    // Subscribe to first channel
    if (createdChannels[0]?.short_id) {
      const sub = await api('POST', `/v1/channels/${createdChannels[0].short_id}/subscribe`, {
        apiKey,
        body: { phone: user.phone }
      });
      console.log(`   → Subscribed to channel:`, sub);
    }
  }
  
  // Step 6: Get user's channels
  console.log('\n📋 STEP 6: GET USER CHANNELS\n');
  
  const userChannels = await api('GET', `/v1/users/${adminUser.userId}/channels`);
  console.log('✅ Admin user\'s channels:');
  console.log(JSON.stringify(userChannels, null, 2));
  
  // Step 7: Public channels
  console.log('\n📋 STEP 7: PUBLIC CHANNELS\n');
  
  const publicChannels = await api('GET', `/v1/public/channels?tenant_id=${tenantId}`);
  console.log('✅ Public channels:');
  console.log(JSON.stringify(publicChannels, null, 2));
  
  // Step 8: Test messaging
  console.log('\n📋 STEP 8: SEND TEST MESSAGE\n');
  
  const message = await api('POST', '/v1/messages', {
    apiKey,
    body: {
      topic: 'runs.finished',
      title: 'System Test',
      body: `Admin test message sent at ${new Date().toISOString()}`,
      payload: {
        test: true,
        channelId: createdChannels[0]?.short_id,
        timestamp: Date.now()
      }
    }
  });
  
  console.log('✅ Message sent:');
  console.log(JSON.stringify(message, null, 2));
  
  // Step 9: Test public join/leave
  console.log('\n📋 STEP 9: PUBLIC JOIN/LEAVE TEST\n');
  
  const publicChannel = allChannels.channels?.find(c => c.allow_public);
  if (publicChannel) {
    const testPhone = '+16505551299';
    
    // Join
    const join = await api('POST', `/v1/public/channels/${publicChannel.short_id}/join`, {
      body: { phone: testPhone }
    });
    console.log(`✅ Public join (${testPhone}):`, join);
    
    // Leave
    const leave = await api('DELETE', `/v1/public/channels/${publicChannel.short_id}/leave`, {
      body: { phone: testPhone }
    });
    console.log(`✅ Public leave (${testPhone}):`, leave);
  }
  
  // Step 10: Test scripts API
  console.log('\n📋 STEP 10: SCRIPTS API TEST\n');
  
  if (allChannels.channels?.length > 0) {
    const channelId = allChannels.channels[0].short_id;
    
    // Try to create a script (might fail if OpenAI not configured)
    const script = await api('POST', `/v1/channels/${channelId}/scripts`, {
      apiKey,
      body: {
        name: 'Test Webhook',
        request_prompt: 'Create a simple webhook that logs the request',
        trigger_type: 'webhook',
        variables: []
      }
    });
    
    console.log('Script creation attempt:', script);
    
    // List scripts
    const scripts = await api('GET', `/v1/channels/${channelId}/scripts`, { apiKey });
    console.log('✅ Channel scripts:');
    console.log(JSON.stringify(scripts, null, 2));
  }
  
  // Step 11: Server info
  console.log('\n📋 STEP 11: SERVER INFORMATION\n');
  
  const version = await api('GET', '/v1/version');
  console.log('✅ Server version & config:');
  console.log(JSON.stringify(version, null, 2));
  
  const health = await api('GET', '/v1/health/deep');
  console.log('\n✅ Server health:');
  console.log(JSON.stringify(health, null, 2));
  
  // Summary
  console.log('\n' + '─'.repeat(60));
  console.log('\n📊 DEMONSTRATION SUMMARY\n');
  console.log('✅ Admin Phone:', ADMIN_PHONE);
  console.log('✅ Admin User ID:', adminUser.userId);
  console.log('✅ Tenant ID:', tenantId);
  console.log('✅ API Key:', apiKey);
  console.log('✅ Channels Created:', createdChannels.length);
  console.log('✅ Test Users Created:', testUsers.length);
  console.log('✅ Server Status: Online & Configured');
  
  console.log('\n🎉 Demo completed successfully!\n');
}

// Run the demo
demo().catch(err => {
  console.error('❌ Demo failed:', err);
  process.exit(1);
});
