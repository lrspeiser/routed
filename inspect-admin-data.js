#!/usr/bin/env node

const fetch = require('node-fetch');

const BASE_URL = 'https://routed.onrender.com';
const ADMIN_PHONE = '+16505551212';

async function req(method, path, { headers = {}, body, apiKey } = {}) {
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
    return { ok: response.ok, status: response.status, data: JSON.parse(text) };
  } catch {
    return { ok: response.ok, status: response.status, data: text };
  }
}

async function main() {
  console.log('📊 ROUTED ADMIN DATA INSPECTION\n');
  console.log('=' . repeat(50));
  
  // Get API credentials
  const creds = await req('POST', '/v1/dev/sandbox/provision', { body: {} });
  const apiKey = creds.data.apiKey;
  const tenantId = creds.data.tenantId;
  
  console.log('\n1️⃣ DEVELOPER CREDENTIALS');
  console.log('-------------------------');
  console.log('Tenant ID:', tenantId);
  console.log('API Key:', apiKey);
  console.log('Publisher ID:', creds.data.publisherId);
  
  // Get admin user
  const adminUser = await req('POST', '/v1/users/ensure', {
    apiKey,
    body: { phone: ADMIN_PHONE, topic: 'runs.finished' }
  });
  
  console.log('\n2️⃣ ADMIN USER DETAILS');
  console.log('---------------------');
  console.log('Phone:', ADMIN_PHONE);
  console.log('User ID:', adminUser.data.userId);
  console.log('Topic ID:', adminUser.data.topicId);
  
  // List all channels
  const channels = await req('GET', '/v1/channels/list', { apiKey });
  
  console.log('\n3️⃣ ALL CHANNELS IN TENANT');
  console.log('--------------------------');
  console.log('Total:', channels.data.channels?.length || 0);
  
  if (channels.data.channels?.length > 0) {
    channels.data.channels.forEach((ch, i) => {
      console.log(`\nChannel ${i + 1}:`);
      console.log('  Name:', ch.name);
      console.log('  Short ID:', ch.short_id);
      console.log('  Topic:', ch.topic);
      console.log('  Public:', ch.allow_public ? 'Yes' : 'No');
      console.log('  Description:', ch.description || 'None');
    });
  }
  
  // Get admin user's channels
  const userChannels = await req('GET', `/v1/users/${adminUser.data.userId}/channels`);
  
  console.log('\n4️⃣ ADMIN USER\'S SUBSCRIBED CHANNELS');
  console.log('------------------------------------');
  console.log('Total:', userChannels.data.channels?.length || 0);
  
  if (userChannels.data.channels?.length > 0) {
    userChannels.data.channels.forEach((ch, i) => {
      console.log(`\n${i + 1}. ${ch.name}`);
      console.log('   Short ID:', ch.short_id);
      console.log('   Topic:', ch.topic);
      console.log('   Public:', ch.allow_public ? 'Yes' : 'No');
      console.log('   Created:', ch.created_at);
    });
  }
  
  // Get public channels (with tenant filter)
  const publicChannels = await req('GET', `/v1/public/channels?tenant_id=${tenantId}`);
  
  console.log('\n5️⃣ PUBLIC CHANNELS IN SYSTEM');
  console.log('-----------------------------');
  
  if (publicChannels.ok) {
    console.log('Total Public:', publicChannels.data.channels?.length || 0);
    
    if (publicChannels.data.channels?.length > 0) {
      publicChannels.data.channels.slice(0, 10).forEach((ch, i) => {
        console.log(`\n${i + 1}. ${ch.name}`);
        console.log('   Short ID:', ch.short_id);
        console.log('   Tenant:', ch.tenant_id === tenantId ? 'Current' : 'Other');
      });
    }
  } else {
    console.log('Error fetching public channels:', publicChannels.status);
  }
  
  // Test channel operations
  console.log('\n6️⃣ CHANNEL OPERATIONS TEST');
  console.log('---------------------------');
  
  // Create a test channel
  const testChannel = await req('POST', '/v1/channels/create', {
    apiKey,
    body: {
      name: `Admin Test ${Date.now()}`,
      description: 'Created by admin data inspection',
      allow_public: true,
      topic_name: 'runs.finished',
      creator_phone: ADMIN_PHONE
    }
  });
  
  if (testChannel.ok) {
    const shortId = testChannel.data.short_id;
    console.log('✅ Created test channel:', shortId);
    
    // Add subscribers
    const testPhones = ['+16505551220', '+16505551221'];
    let subscriberCount = 1; // Admin is auto-subscribed
    
    for (const phone of testPhones) {
      // Ensure user exists
      const user = await req('POST', '/v1/users/ensure', {
        apiKey,
        body: { phone, topic: 'runs.finished' }
      });
      
      if (user.ok) {
        // Subscribe to channel
        const sub = await req('POST', `/v1/channels/${shortId}/subscribe`, {
          apiKey,
          body: { phone }
        });
        
        if (sub.ok) {
          subscriberCount++;
          console.log(`✅ Added subscriber: ${phone}`);
        }
      }
    }
    
    console.log(`Total subscribers: ${subscriberCount}`);
    
    // Send a message
    const msg = await req('POST', '/v1/messages', {
      apiKey,
      body: {
        topic: 'runs.finished',
        title: 'Admin Test Message',
        body: `Sent to ${subscriberCount} subscribers at ${new Date().toLocaleTimeString()}`,
        payload: { channelId: shortId, test: true }
      }
    });
    
    if (msg.ok) {
      console.log('✅ Message sent successfully');
      console.log('   Deliveries:', msg.data.deliveries || 'N/A');
      console.log('   Skipped:', msg.data.skipped || 'N/A');
    }
  }
  
  // Check for scripts support
  console.log('\n7️⃣ SCRIPTS API STATUS');
  console.log('----------------------');
  
  if (channels.data.channels?.length > 0) {
    const firstChannel = channels.data.channels[0];
    const scripts = await req('GET', `/v1/channels/${firstChannel.short_id}/scripts`, { apiKey });
    
    if (scripts.ok) {
      console.log('✅ Scripts API available');
      console.log('Total scripts:', scripts.data.scripts?.length || 0);
      
      if (scripts.data.scripts?.length > 0) {
        scripts.data.scripts.forEach((s, i) => {
          console.log(`\n${i + 1}. ${s.name}`);
          console.log('   ID:', s.id);
          console.log('   Type:', s.trigger_type);
          console.log('   Created:', s.created_at);
        });
      }
    } else {
      console.log('⚠️ Scripts API error:', scripts.status);
    }
  }
  
  // Server configuration
  console.log('\n8️⃣ SERVER CONFIGURATION');
  console.log('------------------------');
  
  const version = await req('GET', '/v1/version');
  if (version.ok) {
    const cfg = version.data.config_status;
    console.log('Database:', cfg?.database ? '✅' : '❌');
    console.log('Twilio SMS:', cfg?.twilio_configured ? '✅' : '❌');
    console.log('Twilio Verify:', cfg?.twilio_verify ? '✅' : '❌');
    console.log('OpenAI:', cfg?.openai_configured ? '✅' : '❌');
    console.log('Gemini:', cfg?.gemini_configured ? '✅' : '❌');
    console.log('Redis:', cfg?.redis_configured ? '✅' : '❌');
    console.log('Push (VAPID):', cfg?.vapid_configured ? '✅' : '❌');
    console.log('Admin Token:', cfg?.admin_token_set ? '✅' : '❌');
  }
  
  console.log('\n' + '=' . repeat(50));
  console.log('✅ Inspection complete!\n');
}

main().catch(console.error);
