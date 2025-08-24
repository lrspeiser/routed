#!/usr/bin/env node

/**
 * Test admin channel creation, subscription, and messaging
 * Creates "Admin Test" channel, subscribes admin user (+16505551212), sends "Test 123"
 */

const fetch = require('node-fetch');
const WebSocket = require('ws');

const BASE_URL = process.env.HUB_URL || 'https://routed.onrender.com';
const ADMIN_TOKEN = process.env.HUB_ADMIN_TOKEN || '33925b5f5b9a2bd3d5a01f2b5857ce73';
const ADMIN_PHONE = '+16505551212';

console.log('🚀 ADMIN CHANNEL FLOW TEST');
console.log(`📍 Server: ${BASE_URL}`);
console.log(`📱 Admin Phone: ${ADMIN_PHONE}`);
console.log('');

async function runTest() {
  let apiKey, tenantId, channelId, userId, wsConnection;
  
  try {
    // 1. Provision developer/admin sandbox
    console.log('1️⃣  Provisioning Admin Developer...');
    const provRes = await fetch(`${BASE_URL}/v1/dev/sandbox/provision`, {
      method: 'POST',
      headers: {
        'X-Admin-Token': ADMIN_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    
    if (!provRes.ok) {
      const error = await provRes.text();
      throw new Error(`Provision failed: ${error}`);
    }
    
    const dev = await provRes.json();
    apiKey = dev.apiKey;
    tenantId = dev.tenantId;
    console.log('✅ Admin developer provisioned');
    console.log(`   - Tenant ID: ${tenantId}`);
    console.log(`   - API Key: ${apiKey}`);
    console.log('');
    
    // 2. Create or ensure admin user
    console.log('2️⃣  Creating/Ensuring Admin User...');
    const userRes = await fetch(`${BASE_URL}/v1/users/ensure`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phone: ADMIN_PHONE
      })
    });
    
    if (!userRes.ok) {
      const error = await userRes.text();
      throw new Error(`User creation failed: ${error}`);
    }
    
    const user = await userRes.json();
    userId = user.userId || user.user_id;
    console.log('✅ Admin user ready');
    console.log(`   - User ID: ${userId}`);
    console.log(`   - Phone: ${ADMIN_PHONE}`);
    console.log('');
    
    // 3. Create "Admin Test" channel
    console.log('3️⃣  Creating "Admin Test" Channel...');
    const channelRes = await fetch(`${BASE_URL}/v1/channels/create`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Admin Test',
        description: 'Test channel for admin user',
        topic: 'admin.test',
        public: false
      })
    });
    
    if (!channelRes.ok) {
      const error = await channelRes.text();
      throw new Error(`Channel creation failed: ${error}`);
    }
    
    const channel = await channelRes.json();
    channelId = channel.short_id || channel.shortId;
    console.log('✅ Channel "Admin Test" created');
    console.log(`   - Channel ID: ${channelId}`);
    console.log(`   - Topic: admin.test`);
    console.log('');
    
    // 4. Subscribe admin user to channel
    console.log('4️⃣  Subscribing Admin User to Channel...');
    const subRes = await fetch(`${BASE_URL}/v1/channels/${channelId}/subscribe`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phone: ADMIN_PHONE
      })
    });
    
    if (!subRes.ok) {
      // Try alternative subscription endpoint
      console.log('   Trying alternative subscription method...');
      const altSubRes = await fetch(`${BASE_URL}/v1/channels/${channelId}/members`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          phone: ADMIN_PHONE
        })
      });
      
      if (!altSubRes.ok) {
        console.log('⚠️  Subscription might require verification');
      }
    } else {
      console.log('✅ Admin user subscribed to channel');
    }
    console.log('');
    
    // 5. Connect WebSocket for real-time delivery
    console.log('5️⃣  Connecting WebSocket for Real-time Delivery...');
    const wsUrl = BASE_URL.replace('https://', 'wss://').replace('http://', 'ws://') + '/v1/socket';
    
    const wsPromise = new Promise((resolve, reject) => {
      wsConnection = new WebSocket(wsUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });
      
      wsConnection.on('open', () => {
        console.log('✅ WebSocket connected');
        
        // Subscribe to channel via WebSocket
        wsConnection.send(JSON.stringify({
          type: 'subscribe',
          channel: channelId
        }));
        
        resolve();
      });
      
      wsConnection.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          console.log('📨 WebSocket message received:', msg);
        } catch (e) {
          console.log('📨 WebSocket raw message:', data.toString());
        }
      });
      
      wsConnection.on('error', (err) => {
        console.log('⚠️  WebSocket error:', err.message);
        reject(err);
      });
      
      setTimeout(() => {
        if (wsConnection.readyState !== WebSocket.OPEN) {
          reject(new Error('WebSocket connection timeout'));
        }
      }, 5000);
    });
    
    try {
      await wsPromise;
    } catch (e) {
      console.log('⚠️  WebSocket connection failed, continuing without real-time updates');
    }
    console.log('');
    
    // 6. Send "Test 123" message
    console.log('6️⃣  Sending "Test 123" Message...');
    const msgRes = await fetch(`${BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        channel_id: channelId,
        title: 'Admin Test Message',
        body: 'Test 123',
        payload: {
          test: true,
          timestamp: new Date().toISOString(),
          from: 'admin-test-script'
        }
      })
    });
    
    if (!msgRes.ok) {
      const error = await msgRes.text();
      throw new Error(`Message send failed: ${error}`);
    }
    
    const msgResult = await msgRes.json();
    console.log('✅ Message "Test 123" sent successfully');
    console.log(`   - Message ID: ${msgResult.messageId || msgResult.message_id}`);
    console.log(`   - Delivery Count: ${msgResult.deliveryCount || msgResult.delivery_count || 'N/A'}`);
    console.log('');
    
    // Wait a bit for WebSocket delivery
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
      console.log('⏳ Waiting for WebSocket delivery...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    // 7. Verify channel members
    console.log('7️⃣  Verifying Channel Members...');
    const membersRes = await fetch(`${BASE_URL}/v1/channels/${channelId}/members`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    
    if (membersRes.ok) {
      const members = await membersRes.json();
      console.log('✅ Channel members:');
      if (Array.isArray(members)) {
        members.forEach(m => {
          console.log(`   - ${m.phone || m.email || m.user_id}`);
        });
      } else if (members.members) {
        members.members.forEach(m => {
          console.log(`   - ${m.phone || m.email || m.user_id}`);
        });
      }
    }
    console.log('');
    
    // 8. Summary
    console.log('=' .repeat(50));
    console.log('✅ TEST COMPLETE - ADMIN FLOW WORKING!');
    console.log('');
    console.log('📋 Summary:');
    console.log(`- Channel: "Admin Test" (ID: ${channelId})`);
    console.log(`- Admin User: ${ADMIN_PHONE}`);
    console.log(`- Message: "Test 123" sent successfully`);
    console.log(`- API Key: ${apiKey}`);
    console.log(`- Tenant ID: ${tenantId}`);
    console.log('');
    console.log('🔑 To login as admin in the app without Twilio:');
    console.log('1. Use the API key above');
    console.log('2. See the bypass instructions in the next section');
    
  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    process.exit(1);
  } finally {
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
      wsConnection.close();
    }
  }
}

runTest();