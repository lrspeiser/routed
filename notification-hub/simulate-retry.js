#!/usr/bin/env node

console.log('🔬 SIMULATION: Transaction Error Retry Mechanism\n');
console.log('This simulation demonstrates how the retry logic handles transaction errors.\n');
console.log('═'.repeat(70) + '\n');

// Simulate server behavior with random transaction errors
class MockServer {
    constructor() {
        this.requestCount = 0;
        this.transactionErrorRate = 0.6; // 60% chance of transaction error on first attempt
    }

    async handleChannelCreate(channelName, attemptNumber) {
        this.requestCount++;
        
        // Simulate network delay
        const responseTime = 200 + Math.random() * 300;
        await new Promise(r => setTimeout(r, responseTime));
        
        // Simulate transaction errors that decrease with retries
        const errorChance = this.transactionErrorRate / attemptNumber;
        const hasTransactionError = Math.random() < errorChance;
        
        if (hasTransactionError) {
            return {
                status: 500,
                error: 'current transaction is aborted, commands ignored until end of transaction block',
                responseTime: Math.floor(responseTime)
            };
        }
        
        // Success
        return {
            status: 200,
            channel: {
                short_id: `ch_${Math.random().toString(36).substr(2, 9)}`,
                name: channelName
            },
            responseTime: Math.floor(responseTime)
        };
    }
}

async function createChannelWithRetry(server, channelName) {
    console.log(`📢 Creating channel: "${channelName}"\n`);
    
    let retries = 3;
    let attemptNumber = 0;
    let lastError = null;
    
    while (retries > 0) {
        attemptNumber++;
        console.log(`🔄 Attempt ${attemptNumber}/3:`);
        console.log(`   → Sending POST /v1/channels/create`);
        
        const response = await server.handleChannelCreate(channelName, attemptNumber);
        console.log(`   ← Response: ${response.status} (${response.responseTime}ms)`);
        
        if (response.status === 200) {
            console.log(`   ✅ SUCCESS! Channel created: ${response.channel.short_id}`);
            console.log(`\n🎉 Channel creation succeeded on attempt ${attemptNumber}!`);
            
            if (attemptNumber > 1) {
                console.log(`   📊 The retry mechanism successfully recovered from ${attemptNumber - 1} transaction error(s)!`);
            }
            
            return response;
        } else if (response.status === 500 && response.error.includes('transaction')) {
            console.log(`   ❌ Error 500: ${response.error}`);
            console.log(`   ⚠️  Transaction error detected!`);
            lastError = response.error;
            
            retries--;
            if (retries > 0) {
                console.log(`   ⏳ Waiting 1 second before retry... (${retries} attempts left)\n`);
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }
        }
    }
    
    console.log(`\n❌ Channel creation failed after ${attemptNumber} attempts.`);
    console.log(`   Last error: ${lastError}`);
    return null;
}

async function runSimulation() {
    const server = new MockServer();
    
    console.log('📋 SCENARIO: Database has intermittent transaction issues\n');
    console.log('   • Transaction error rate: 60% on first attempt');
    console.log('   • Error rate decreases with each retry');
    console.log('   • Maximum 3 attempts per request\n');
    console.log('─'.repeat(70) + '\n');
    
    const results = [];
    
    // Simulate 5 channel creation attempts
    for (let i = 1; i <= 5; i++) {
        console.log(`\n🧪 Test ${i}/5:`);
        console.log('─'.repeat(40));
        
        const channelName = `Test Channel ${Date.now()}_${i}`;
        const result = await createChannelWithRetry(server, channelName);
        
        results.push({
            test: i,
            success: !!result,
            attempts: result ? Math.ceil(server.requestCount / i) : 3,
            channelId: result?.channel?.short_id
        });
        
        if (i < 5) {
            console.log('\n⏱️  Waiting before next test...\n');
            await new Promise(r => setTimeout(r, 1500));
        }
    }
    
    // Show summary
    console.log('\n' + '═'.repeat(70));
    console.log('📊 SIMULATION RESULTS:');
    console.log('─'.repeat(70));
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalAttempts = results.reduce((sum, r) => sum + r.attempts, 0);
    const retriedSuccessfully = results.filter(r => r.success && r.attempts > 1).length;
    
    console.log(`\n   Total channel creations: ${results.length}`);
    console.log(`   ✅ Successful: ${successful} (${Math.round(successful/results.length * 100)}%)`);
    console.log(`   ❌ Failed: ${failed} (${Math.round(failed/results.length * 100)}%)`);
    console.log(`   🔄 Required retries: ${retriedSuccessfully} (${Math.round(retriedSuccessfully/successful * 100)}% of successes)`);
    console.log(`   📈 Average attempts per request: ${(totalAttempts/results.length).toFixed(1)}`);
    
    console.log('\n   Detailed results:');
    results.forEach(r => {
        const status = r.success ? '✅' : '❌';
        const retryInfo = r.attempts > 1 ? ` (${r.attempts} attempts)` : '';
        console.log(`     Test ${r.test}: ${status} ${r.success ? r.channelId : 'Failed'}${retryInfo}`);
    });
    
    console.log('\n' + '═'.repeat(70));
    console.log('\n🎯 KEY INSIGHTS:\n');
    
    if (successful > failed) {
        console.log('✅ The retry mechanism successfully handled most transaction errors!');
        console.log(`   • ${retriedSuccessfully} out of ${successful} successful requests needed retries`);
        console.log('   • This shows the retry logic effectively recovers from transient DB issues');
    }
    
    console.log('\n💡 HOW IT WORKS:');
    console.log('   1. Frontend detects transaction error in response');
    console.log('   2. Waits 1 second for database to recover');
    console.log('   3. Retries the request (up to 3 times)');
    console.log('   4. Usually succeeds on 2nd or 3rd attempt');
    
    console.log('\n🔧 REAL-WORLD BENEFITS:');
    console.log('   • Users don\'t see "500 Internal Server Error"');
    console.log('   • Operations complete successfully despite DB issues');
    console.log('   • No manual intervention required');
    console.log('   • Better user experience under load\n');
}

// Run the simulation
runSimulation().catch(console.error);
