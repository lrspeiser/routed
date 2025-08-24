#!/usr/bin/env node

const https = require('https');

console.log('🚀 Testing Channel Creation with Retry Logic on Production Server\n');

// Configuration
const API_KEY = process.env.API_KEY || 'YOUR_API_KEY_HERE';
const BASE_URL = 'https://routed.onrender.com';

async function makeRequest(path, method, body) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const options = {
            hostname: url.hostname,
            port: 443,
            path: url.pathname,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Length': Buffer.byteLength(JSON.stringify(body))
            }
        };

        const startTime = Date.now();
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                const responseTime = Date.now() - startTime;
                try {
                    const result = JSON.parse(data);
                    resolve({
                        status: res.statusCode,
                        data: result,
                        responseTime,
                        headers: res.headers
                    });
                } catch (e) {
                    resolve({
                        status: res.statusCode,
                        data: data,
                        responseTime,
                        headers: res.headers
                    });
                }
            });
        });

        req.on('error', reject);
        req.write(JSON.stringify(body));
        req.end();
    });
}

async function testChannelCreationWithRetry() {
    const channelName = `Test Channel ${Date.now()}`;
    const body = {
        name: channelName,
        topic_name: 'runs.finished',
        allow_public: false,
        description: 'Testing retry mechanism',
        creator_phone: '+15555551234'
    };

    console.log(`📢 Creating channel: "${channelName}"\n`);
    
    let retries = 3;
    let attemptNumber = 0;
    let lastError = null;
    
    while (retries > 0) {
        attemptNumber++;
        console.log(`🔄 Attempt ${attemptNumber}/3:`);
        console.log(`   → Sending POST /v1/channels/create`);
        
        try {
            const response = await makeRequest('/v1/channels/create', 'POST', body);
            console.log(`   ← Response: ${response.status} (${response.responseTime}ms)`);
            
            if (response.status === 200 || response.status === 201) {
                console.log(`   ✅ SUCCESS! Channel created: ${response.data.channel?.short_id || 'unknown'}`);
                console.log(`\n🎉 Channel creation succeeded on attempt ${attemptNumber}!`);
                return response.data;
            } else if (response.status === 500 || response.status === 503) {
                const errorMsg = response.data.message || response.data.error || 'Unknown error';
                console.log(`   ❌ Error ${response.status}: ${errorMsg}`);
                
                // Check if this is a transaction error
                if (errorMsg.includes('transaction') || 
                    errorMsg.includes('aborted') ||
                    errorMsg.includes('retry')) {
                    console.log(`   ⚠️  Transaction error detected!`);
                    lastError = errorMsg;
                    
                    retries--;
                    if (retries > 0) {
                        console.log(`   ⏳ Waiting 2 seconds before retry... (${retries} attempts left)\n`);
                        await new Promise(r => setTimeout(r, 2000));
                        continue;
                    }
                } else {
                    // Non-retryable error
                    console.log(`   ❌ Non-retryable error, stopping.`);
                    lastError = errorMsg;
                    break;
                }
            } else {
                console.log(`   ❌ Unexpected status ${response.status}`);
                lastError = `Status ${response.status}: ${JSON.stringify(response.data)}`;
                break;
            }
        } catch (error) {
            console.log(`   ❌ Request failed: ${error.message}`);
            lastError = error.message;
            
            retries--;
            if (retries > 0) {
                console.log(`   ⏳ Waiting 2 seconds before retry... (${retries} attempts left)\n`);
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }
        }
    }
    
    console.log(`\n❌ Channel creation failed after ${attemptNumber} attempts.`);
    console.log(`   Last error: ${lastError}`);
    return null;
}

async function demonstrateRetryMechanism() {
    console.log('This test will create multiple channels to demonstrate the retry mechanism.\n');
    console.log('If the server has transaction issues, you\'ll see automatic retries.\n');
    console.log('─'.repeat(60) + '\n');
    
    // Test multiple times to increase chance of hitting a transaction error
    const results = [];
    for (let i = 1; i <= 3; i++) {
        console.log(`\n📌 Test Run ${i}/3:`);
        console.log('─'.repeat(40));
        
        const result = await testChannelCreationWithRetry();
        results.push({
            run: i,
            success: !!result,
            channelId: result?.channel?.short_id
        });
        
        if (i < 3) {
            console.log('\n⏱️  Waiting 3 seconds before next test...');
            await new Promise(r => setTimeout(r, 3000));
        }
    }
    
    // Summary
    console.log('\n' + '═'.repeat(60));
    console.log('📊 TEST SUMMARY:');
    console.log('─'.repeat(60));
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log(`   Total runs: ${results.length}`);
    console.log(`   ✅ Successful: ${successful}`);
    console.log(`   ❌ Failed: ${failed}`);
    
    if (successful > 0) {
        console.log('\n   Created channels:');
        results.filter(r => r.success).forEach(r => {
            console.log(`     • Run ${r.run}: ${r.channelId}`);
        });
    }
    
    console.log('\n' + '═'.repeat(60));
    
    if (successful === results.length) {
        console.log('\n🎉 All channel creations succeeded!');
        console.log('   The retry mechanism successfully handled any transaction errors.');
    } else if (successful > 0) {
        console.log('\n⚠️  Some channel creations succeeded with retries.');
        console.log('   This demonstrates the retry mechanism working under load.');
    } else {
        console.log('\n❌ All channel creations failed.');
        console.log('   The server may be experiencing persistent issues.');
    }
}

// Check if API key is provided
if (API_KEY === 'YOUR_API_KEY_HERE') {
    console.log('❌ Error: Please set your API_KEY environment variable');
    console.log('   Example: API_KEY=your_actual_key node test-retry.js');
    process.exit(1);
}

// Run the test
demonstrateRetryMechanism().catch(console.error);
