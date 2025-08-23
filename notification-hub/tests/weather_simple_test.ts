#!/usr/bin/env ts-node

/**
 * Simple Weather Script Test - Uses existing authentication
 * 
 * This test assumes you already have a valid token from your UI session.
 * 
 * Usage:
 * 1. Start backend: npm run dev
 * 2. Get your token from the UI (check browser dev tools localStorage or network tab)
 * 3. Run: TOKEN=your-token npx ts-node tests/weather_simple_test.ts
 * 
 * Or just run it and enter the token when prompted.
 */

import fetch from 'node-fetch';
import * as readline from 'readline';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3030';

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
  console.log('🌤️  Weather Script Test - Real notification test');
  console.log('================================================\n');

  try {
    // Get token from env or prompt
    let token = process.env.TOKEN || '';
    if (!token) {
      console.log('📝 You need an auth token from your current UI session.');
      console.log('   Open browser dev tools > Application > Local Storage');
      console.log('   Or check Network tab for Authorization header\n');
      token = await prompt('Enter your auth token: ');
      token = token.trim();
    }

    // Step 1: Get user's existing channels (to verify auth works)
    console.log('\n🔍 Checking authentication...');
    const channelsResponse = await fetch(`${BASE_URL}/v1/user/channels`, {
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${token}`
      }
    });

    if (!channelsResponse.ok) {
      const error = await channelsResponse.text();
      throw new Error(`Authentication failed. Make sure your token is valid.\nError: ${error}`);
    }

    const channelsData = await channelsResponse.json() as any;
    console.log(`✅ Authenticated! Found ${channelsData.channels?.length || 0} existing channels.`);

    // Step 2: Create a test channel
    console.log('\n📢 Creating weather test channel...');
    const timestamp = new Date().toLocaleString();
    const channelName = `Weather Test - ${timestamp}`;
    
    const createChannelResponse = await fetch(`${BASE_URL}/v1/user/channels/create`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ 
        name: channelName,
        description: 'Automated test channel for weather notifications',
        isPublic: false
      })
    });

    if (!createChannelResponse.ok) {
      const error = await createChannelResponse.text();
      throw new Error(`Failed to create channel: ${error}`);
    }

    const channelData = await createChannelResponse.json() as any;
    const channelId = channelData.channel.shortId;
    console.log(`✅ Created channel: "${channelName}"`);
    console.log(`   Channel ID: ${channelId}`);

    // Step 3: Create weather script with detailed prompt
    console.log('\n🌤️  Creating weather script...');
    const weatherPrompt = `Create a script that fetches the current weather for San Francisco, CA and sends a notification.

The notification should include:
- Current temperature in Fahrenheit
- Weather condition (sunny, cloudy, rainy, etc.)
- "Feels like" temperature if available
- Humidity percentage
- Wind speed
- A brief forecast for the next few hours
- Use appropriate weather emojis (☀️ 🌤️ ☁️ 🌧️ ⛈️ 🌨️ 🌫️)

Format the message nicely for a mobile push notification. Keep it concise but informative.`;

    const scriptResponse = await fetch(`${BASE_URL}/v1/user/channels/${channelId}/scripts`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ 
        userPrompt: weatherPrompt,
        variables: []
      })
    });

    if (!scriptResponse.ok) {
      const error = await scriptResponse.text();
      throw new Error(`Failed to create weather script: ${error}`);
    }

    const scriptData = await scriptResponse.json() as any;
    const scriptId = scriptData.script.id;
    console.log(`✅ Weather script created successfully!`);
    console.log(`   Script Name: ${scriptData.script.name}`);
    console.log(`   Script ID: ${scriptId}`);
    console.log(`   Trigger Type: ${scriptData.script.triggerType}`);

    // Wait a moment for script to be ready
    console.log('\n⏳ Waiting for script to be ready...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 4: Execute the weather script
    console.log('\n⚡ EXECUTING WEATHER SCRIPT NOW...');
    console.log('📱 CHECK YOUR PHONE FOR THE WEATHER NOTIFICATION!\n');
    
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
      throw new Error(`Failed to execute weather script: ${error}`);
    }

    const executeData = await executeResponse.json() as any;
    
    console.log('✅ WEATHER NOTIFICATION SENT!');
    console.log('================================');
    console.log(`📤 Notifications delivered: ${executeData.notificationsSent}`);
    console.log(`📝 Message content: ${executeData.message}`);
    console.log(`⏱️  Execution time: ${executeData.duration}ms`);
    console.log('================================\n');

    // Step 5: Send a follow-up test message
    console.log('📨 Sending follow-up confirmation message...');
    const confirmMessage = `✅ Weather test successful at ${new Date().toLocaleTimeString()}! The weather script is working correctly.`;
    
    const messageResponse = await fetch(`${BASE_URL}/v1/user/channels/${channelId}/send`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ message: confirmMessage })
    });

    if (messageResponse.ok) {
      const msgData = await messageResponse.json() as any;
      console.log(`✅ Confirmation message sent to ${msgData.notificationsSent} subscriber(s)!`);
    }

    // Optional cleanup
    console.log('\n🧹 Cleanup Options:');
    console.log(`   Channel ID: ${channelId}`);
    const cleanup = await prompt('Delete the test channel? (y/n): ');
    
    if (cleanup.toLowerCase() === 'y') {
      const deleteResponse = await fetch(`${BASE_URL}/v1/user/channels/${channelId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (deleteResponse.ok) {
        console.log('✅ Test channel deleted successfully.');
      } else {
        console.log(`⚠️  Could not delete channel. You can delete it manually: ${channelId}`);
      }
    } else {
      console.log(`ℹ️  Channel kept: ${channelId}`);
    }

    console.log('\n🎉 TEST COMPLETE!');
    console.log('================');
    console.log('You should have received:');
    console.log('  1. 🌤️  A weather notification with current SF weather');
    console.log('  2. ✅ A confirmation message');
    console.log('\nThe weather script feature is working correctly!');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ ERROR:', error);
    console.error('\n💡 Troubleshooting tips:');
    console.error('  1. Make sure the backend is running (npm run dev)');
    console.error('  2. Verify your auth token is valid and not expired');
    console.error('  3. Check that you have an active subscription to receive notifications');
    process.exit(1);
  }
}

// Run the test
main().catch(console.error);
