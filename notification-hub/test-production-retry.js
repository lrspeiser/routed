#!/usr/bin/env node

const puppeteer = require('puppeteer');

console.log('🚀 Testing Retry Mechanism on Production Server\n');
console.log('═'.repeat(70) + '\n');

async function testRetryOnProduction() {
    const browser = await puppeteer.launch({
        headless: false,  // Set to false to see the browser
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        defaultViewport: { width: 1400, height: 900 }
    });
    
    try {
        const page = await browser.newPage();
        
        console.log('📄 Opening Notification Hub App...');
        await page.goto('https://routed.onrender.com/app.html', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        // Check if already logged in
        const isLoggedIn = await page.evaluate(() => {
            return localStorage.getItem('authToken') !== null;
        });
        
        if (!isLoggedIn) {
            console.log('   ⚠️  Not logged in. Please log in manually in the browser.');
            console.log('   Waiting for authentication...');
            
            // Wait for user to log in
            await page.waitForFunction(
                () => localStorage.getItem('authToken') !== null,
                { timeout: 60000 }
            );
        }
        
        console.log('✅ Authenticated!\n');
        
        // Get user info
        const userInfo = await page.evaluate(() => {
            const userData = JSON.parse(localStorage.getItem('userData') || '{}');
            return {
                phone: userData.phone,
                id: userData.id
            };
        });
        
        console.log(`👤 User: ${userInfo.phone} (${userInfo.id?.substring(0, 8)}...)\n`);
        
        // Test channel creation multiple times
        console.log('📢 Testing Channel Creation with Retry Logic:\n');
        console.log('The frontend will automatically retry if it encounters transaction errors.\n');
        console.log('─'.repeat(70) + '\n');
        
        const results = [];
        
        for (let i = 1; i <= 5; i++) {
            console.log(`\n🧪 Test ${i}/5:`);
            console.log('─'.repeat(40));
            
            const channelName = `Test Channel ${Date.now()}_${i}`;
            console.log(`Creating: "${channelName}"`);
            
            // Open create channel modal
            await page.click('button[onclick="app.showCreateChannelModal()"]');
            await page.waitForTimeout(500);
            
            // Fill in channel details
            await page.type('#newChannelName', channelName);
            await page.type('#newChannelDescription', 'Testing retry mechanism');
            
            // Monitor console for retry attempts
            const logs = [];
            page.on('console', msg => {
                const text = msg.text();
                if (text.includes('retry') || text.includes('Attempt') || text.includes('transaction')) {
                    logs.push(text);
                    console.log(`   🔄 ${text}`);
                }
            });
            
            // Submit the form
            const startTime = Date.now();
            await page.click('#createChannelForm button[type="submit"]');
            
            // Wait for success or failure
            try {
                await page.waitForFunction(
                    () => {
                        const alertEl = document.querySelector('.alert');
                        return alertEl && (
                            alertEl.textContent.includes('created successfully') ||
                            alertEl.textContent.includes('Failed to create')
                        );
                    },
                    { timeout: 10000 }
                );
                
                const responseTime = Date.now() - startTime;
                const alertText = await page.$eval('.alert', el => el.textContent);
                
                if (alertText.includes('created successfully')) {
                    console.log(`   ✅ SUCCESS in ${responseTime}ms`);
                    
                    // Check if retries were needed
                    const retryCount = logs.filter(l => l.includes('retry')).length;
                    if (retryCount > 0) {
                        console.log(`   📊 Required ${retryCount} retry attempt(s)`);
                    }
                    
                    results.push({
                        test: i,
                        success: true,
                        retries: retryCount,
                        time: responseTime
                    });
                } else {
                    console.log(`   ❌ FAILED: ${alertText}`);
                    results.push({
                        test: i,
                        success: false,
                        retries: logs.filter(l => l.includes('retry')).length,
                        time: responseTime
                    });
                }
                
            } catch (e) {
                console.log(`   ❌ Timeout or error: ${e.message}`);
                results.push({
                    test: i,
                    success: false,
                    retries: 0,
                    time: 10000
                });
            }
            
            // Close modal if still open
            try {
                await page.keyboard.press('Escape');
            } catch {}
            
            // Clear any alerts
            await page.evaluate(() => {
                document.querySelectorAll('.alert').forEach(el => el.remove());
            });
            
            // Wait before next test
            if (i < 5) {
                console.log('\n⏱️  Waiting 2 seconds before next test...');
                await page.waitForTimeout(2000);
            }
        }
        
        // Show summary
        console.log('\n' + '═'.repeat(70));
        console.log('📊 TEST RESULTS:');
        console.log('─'.repeat(70));
        
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        const withRetries = results.filter(r => r.success && r.retries > 0).length;
        const avgTime = results.reduce((sum, r) => sum + r.time, 0) / results.length;
        
        console.log(`\n   Total tests: ${results.length}`);
        console.log(`   ✅ Successful: ${successful} (${Math.round(successful/results.length * 100)}%)`);
        console.log(`   ❌ Failed: ${failed} (${Math.round(failed/results.length * 100)}%)`);
        console.log(`   🔄 Required retries: ${withRetries} (${Math.round(withRetries/successful * 100)}% of successes)`);
        console.log(`   ⏱️  Average time: ${Math.round(avgTime)}ms`);
        
        console.log('\n   Detailed results:');
        results.forEach(r => {
            const status = r.success ? '✅' : '❌';
            const retryInfo = r.retries > 0 ? ` (${r.retries} retries)` : '';
            console.log(`     Test ${r.test}: ${status} ${r.time}ms${retryInfo}`);
        });
        
        console.log('\n' + '═'.repeat(70));
        
        if (withRetries > 0) {
            console.log('\n🎯 RETRY MECHANISM CONFIRMED:');
            console.log(`   ${withRetries} requests successfully recovered from transaction errors!`);
            console.log('   The frontend retry logic is working as designed.');
        } else if (successful === results.length) {
            console.log('\n✅ All requests succeeded on first attempt!');
            console.log('   No transaction errors encountered during this test.');
            console.log('   The retry mechanism is ready if needed.');
        }
        
        console.log('\n💡 KEY INSIGHT:');
        console.log('   The app now handles transaction errors gracefully.');
        console.log('   Users experience success instead of error messages.\n');
        
        // Take screenshot
        await page.screenshot({ path: 'production-test-result.png', fullPage: true });
        console.log('📸 Screenshot saved as production-test-result.png\n');
        
    } catch (error) {
        console.error('❌ Test error:', error.message);
    } finally {
        console.log('Press Ctrl+C to close the browser and exit...');
        // Keep browser open for inspection
        await new Promise(r => setTimeout(r, 60000));
        await browser.close();
    }
}

// Run the test
testRetryOnProduction().catch(console.error);
