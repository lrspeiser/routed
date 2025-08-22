#!/usr/bin/env node

// Test sending a message to a channel

const channelShortId = 'p5dd7v'; // Your Quotes channel
const targetPhone = '+16502079445'; // Your verified phone number

// Get API key from dev.json
const fs = require('fs');
const path = require('path');
const devPath = path.join(process.env.HOME, 'Library/Application Support/routed/dev.json');

let apiKey;
try {
  const devData = JSON.parse(fs.readFileSync(devPath, 'utf8'));
  apiKey = devData.apiKey;
  console.log('✓ Using API key from dev.json');
} catch (error) {
  console.error('Error reading dev.json:', error.message);
  process.exit(1);
}

if (!apiKey) {
  console.error('No API key found in dev.json');
  process.exit(1);
}

const baseUrl = 'https://routed.onrender.com';

async function sendTestMessage() {
  console.log('\n=== Sending Test Message ===');
  console.log(`Channel: ${channelShortId}`);
  console.log(`Target phone: ${targetPhone}`);
  
  try {
    const response = await fetch(`${baseUrl}/v1/channels/${channelShortId}/test-message`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: 'Test Message from Script',
        body: `This is a test message sent at ${new Date().toLocaleTimeString()}`,
        data: {
          source: 'test_script',
          timestamp: Date.now()
        },
        target_phone: targetPhone
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error('❌ Failed to send message:', response.status, data);
      return;
    }

    console.log('✓ Message sent successfully!');
    console.log('Message ID:', data.message_id);
    console.log('Recipients:', data.recipients);
    console.log('Notifications:', JSON.stringify(data.notifications, null, 2));
    
  } catch (error) {
    console.error('❌ Error sending message:', error.message);
  }
}

async function testScriptExecution() {
  console.log('\n=== Testing Script Execution ===');
  
  // First get the script ID
  try {
    const scriptsResponse = await fetch(`${baseUrl}/v1/channels/${channelShortId}/scripts`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    const scriptsData = await scriptsResponse.json();
    
    if (!scriptsResponse.ok) {
      console.error('❌ Failed to get scripts:', scriptsResponse.status, scriptsData);
      return;
    }

    if (!scriptsData.scripts || scriptsData.scripts.length === 0) {
      console.log('No scripts found for channel');
      return;
    }

    const script = scriptsData.scripts[0];
    console.log(`Found script: ${script.name} (${script.id})`);
    
    // Now execute the script
    console.log('Executing script...');
    const execResponse = await fetch(`${baseUrl}/v1/scripts/${script.id}/execute`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        test_data: {
          message: 'Manual test execution'
        }
      })
    });

    const execData = await execResponse.json();
    
    if (!execResponse.ok) {
      console.error('❌ Failed to execute script:', execResponse.status, execData);
      return;
    }

    console.log('✓ Script executed!');
    console.log('Success:', execData.ok);
    console.log('Notifications sent:', execData.notificationsSent);
    console.log('Duration:', execData.duration, 'ms');
    if (execData.error) {
      console.error('Error:', execData.error);
    }
    if (execData.logs && execData.logs.length > 0) {
      console.log('\nScript logs:');
      execData.logs.forEach(log => console.log('  ', log));
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function main() {
  // Send a test message first
  await sendTestMessage();
  
  // Wait a bit for the backend to deploy
  console.log('\nWaiting for backend deployment...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Then test script execution
  await testScriptExecution();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
