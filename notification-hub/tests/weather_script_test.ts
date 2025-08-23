#!/usr/bin/env ts-node

/**
 * Weather Script Test - Sends real weather notification to your phone
 * 
 * Usage:
 * 1. Start backend: npm run dev
 * 2. Run test: npx ts-node tests/weather_script_test.ts
 * 3. Enter verification code when prompted
 * 4. See weather notification on your phone!
 */

import fetch from 'node-fetch';
import * as readline from 'readline';

const BASE_URL = 'http://localhost:3030';
const YOUR_PHONE = '6502079445';

// Helper to get user input
function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  console.log('🚀 Weather Script Test - Will send real notification to your phone!');
  console.log(`📱 Phone number: ${YOUR_PHONE}\n`);

  try {
    // Step 1: Send verification code
    console.log('📤 Sending verification code to your phone...');
    const verifyResponse = await fetch(`${BASE_URL}/v1/verify/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: `+1${YOUR_PHONE}` })
    });

    if (!verifyResponse.ok) {
      const error = await verifyResponse.text();
      throw new Error(`Failed to send verification code: ${error}`);
    }

    console.log('✅ Verification code sent! Check your SMS messages.');
    
    // Step 2: Get verification code from user
    const code = await prompt('Enter the 6-digit verification code: ');

    // Step 3: Verify the code
    console.log('\n🔐 Verifying code...');
    const checkResponse = await fetch(`${BASE_URL}/v1/verify/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        phone: `+1${YOUR_PHONE}`,
        code: code.trim()
      })
    });

    if (!checkResponse.ok) {
      const error = await checkResponse.text();
      throw new Error(`Failed to verify code: ${error}`);
    }

    const verifyData = await checkResponse.json() as any;
    console.log('✅ Phone verified!');
    console.log(`👤 User ID: ${verifyData.userId}`);
    console.log(`🔑 Dev ID: ${verifyData.devId}`);

    // Step 4: Complete authentication to get token
    console.log('\n🔓 Getting authentication token...');
    const authResponse = await fetch(`${BASE_URL}/auth/complete-sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        phone: `+1${YOUR_PHONE}`,
        deviceName: 'Weather Test Script'
      })
    });

    if (!authResponse.ok) {
      const error = await authResponse.text();
      throw new Error(`Failed to complete auth: ${error}`);
    }

    const authData = await authResponse.json() as any;
    const token = authData.accessToken;
    console.log('✅ Authenticated successfully!');

    // Step 5: Create a test channel
    console.log('\n📢 Creating test channel...');
    const channelName = `Weather Test ${new Date().toLocaleTimeString()}`;
    const channelResponse = await fetch(`${BASE_URL}/v1/user/channels/create`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ 
        name: channelName,
        description: 'Test channel for weather notifications',
        isPublic: false
      })
    });

    if (!channelResponse.ok) {
      const error = await channelResponse.text();
      throw new Error(`Failed to create channel: ${error}`);
    }

    const channelData = await channelResponse.json() as any;
    const channelId = channelData.channel.shortId;
    console.log(`✅ Created channel: ${channelName} (${channelId})`);

    // Step 6: Create weather script
    console.log('\n🌤️  Creating weather script...');
    const scriptPrompt = `Check the current weather in San Francisco, California and send a notification with:
    - Current temperature in Fahrenheit
    - Weather conditions (sunny, cloudy, rainy, etc)
    - "Feels like" temperature
    - Brief forecast for the rest of the day
    - Include weather emoji that matches conditions (☀️ 🌤️ ☁️ 🌧️ ⛈️ 🌨️)
    Format it nicely for a push notification.`;

    const scriptResponse = await fetch(`${BASE_URL}/v1/user/channels/${channelId}/scripts`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ 
        userPrompt: scriptPrompt,
        variables: []
      })
    });

    if (!scriptResponse.ok) {
      const error = await scriptResponse.text();
      throw new Error(`Failed to create script: ${error}`);
    }

    const scriptData = await scriptResponse.json() as any;
    const scriptId = scriptData.script.id;
    console.log(`✅ Created weather script: ${scriptData.script.name}`);
    console.log(`   Script ID: ${scriptId}`);

    // Step 7: Execute the weather script
    console.log('\n⚡ Executing weather script...');
    console.log('📱 CHECK YOUR PHONE NOW FOR THE WEATHER NOTIFICATION!');
    
    const executeResponse = await fetch(`${BASE_URL}/v1/user/scripts/${scriptId}/execute`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({})
    });

    if (!executeResponse.ok) {
      const error = await executeResponse.text();
      throw new Error(`Failed to execute script: ${error}`);
    }

    const executeData = await executeResponse.json() as any;
    console.log('\n✅ Weather notification sent successfully!');
    console.log(`📤 Notifications sent: ${executeData.notificationsSent}`);
    console.log(`📝 Message: ${executeData.message}`);
    console.log(`⏱️  Execution time: ${executeData.duration}ms`);

    // Step 8: Send a follow-up test message
    console.log('\n📨 Sending follow-up test message...');
    const testMessage = `Test complete! Weather script executed at ${new Date().toLocaleTimeString()}`;
    
    const messageResponse = await fetch(`${BASE_URL}/v1/user/channels/${channelId}/send`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ message: testMessage })
    });

    if (messageResponse.ok) {
      console.log('✅ Follow-up message sent!');
    }

    // Cleanup option
    const cleanup = await prompt('\nDelete test channel? (y/n): ');
    if (cleanup.toLowerCase() === 'y') {
      const deleteResponse = await fetch(`${BASE_URL}/v1/user/channels/${channelId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (deleteResponse.ok) {
        console.log('🗑️  Test channel deleted.');
      }
    }

    console.log('\n🎉 Test complete! You should have received:');
    console.log('   1. A weather notification with current SF weather');
    console.log('   2. A follow-up test message');
    console.log('\n✨ The weather script is working correctly!');

  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

// Run the test
main().catch(console.error);
