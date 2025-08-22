#!/usr/bin/env node

// Regenerate an existing script with the improved code generation

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

const baseUrl = 'https://routed.onrender.com';
const channelShortId = 'p5dd7v'; // Your Quotes channel

async function regenerateScript() {
  console.log('\n=== Regenerating Script ===');
  
  try {
    // First get the script ID
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
    
    // Get full script details
    const scriptDetailResponse = await fetch(`${baseUrl}/v1/scripts/${script.id}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    const scriptDetail = await scriptDetailResponse.json();
    
    if (!scriptDetailResponse.ok) {
      console.error('❌ Failed to get script details:', scriptDetailResponse.status, scriptDetail);
      return;
    }

    console.log('Current request prompt:', scriptDetail.script.request_prompt);
    
    // Regenerate the script with improved prompt
    console.log('\nRegenerating script code...');
    const updateResponse = await fetch(`${baseUrl}/v1/scripts/${script.id}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        regenerate_code: true,
        request_prompt: 'Every 10 minutes, fetch weather for Los Altos, CA and send a notification with current temperature and conditions to all subscribers',
        api_docs: `Weather API: https://api.open-meteo.com/v1/forecast
Parameters:
- latitude: 37.3852 (for Los Altos)
- longitude: -122.1141  
- current: temperature_2m,weather_code,wind_speed_10m
- temperature_unit: fahrenheit
- timezone: America/Los_Angeles

Weather codes:
0: Clear sky
1-3: Partly cloudy
45-48: Foggy
51-67: Drizzle/Rain
71-86: Snow
95-99: Thunderstorm`
      })
    });

    const updateData = await updateResponse.json();
    
    if (!updateResponse.ok) {
      console.error('❌ Failed to regenerate script:', updateResponse.status, updateData);
      return;
    }

    console.log('✓ Script regenerated successfully!');
    
    // Now test the regenerated script
    console.log('\nTesting regenerated script...');
    const testResponse = await fetch(`${baseUrl}/v1/scripts/${script.id}/execute`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    const testData = await testResponse.json();
    
    if (!testResponse.ok) {
      console.error('❌ Test failed:', testResponse.status, testData);
      return;
    }

    console.log('✓ Script executed successfully!');
    console.log('Success:', testData.ok);
    console.log('Notifications sent:', testData.notificationsSent);
    console.log('Duration:', testData.duration, 'ms');
    
    if (testData.error) {
      console.error('Error:', testData.error);
    }
    
    if (testData.logs && testData.logs.length > 0) {
      console.log('\nScript logs:');
      testData.logs.forEach(log => console.log('  ', log));
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

regenerateScript().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
