#!/usr/bin/env node

/**
 * Test Twilio Verify Response
 * Tests what happens when we submit an incorrect verification code
 */

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Configuration
const HUB_URL = process.env.HUB_URL || 'https://routed.onrender.com';
const TEST_PHONE = '+16502079445';
const TEST_CODE = '123456'; // Intentionally wrong code

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testVerifyStart() {
  log('\n━━━ Step 1: Starting Verification ━━━', 'blue');
  log(`Phone: ${TEST_PHONE}`, 'cyan');
  
  try {
    const response = await fetch(`${HUB_URL}/v1/verify/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phone: TEST_PHONE,
        country: 'US'
      })
    });
    
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    
    log(`Response Status: ${response.status}`, response.ok ? 'green' : 'red');
    log('Response Body:', 'cyan');
    console.log(JSON.stringify(data, null, 2));
    
    if (!response.ok) {
      log('\n⚠️  Cannot proceed - verification start failed', 'red');
      
      // Analyze the error
      if (data.error === 'twilio_error' && data.details) {
        log('\n━━━ Twilio Error Details ━━━', 'magenta');
        if (data.details.code === 20404) {
          log('❌ Twilio Service Not Found', 'red');
          log('The TWILIO_VERIFY_SERVICE_SID is invalid or the service does not exist', 'yellow');
        } else if (data.details.code === 20003) {
          log('❌ Authentication Error', 'red');
          log('The Twilio API credentials are invalid', 'yellow');
        } else if (data.details.code === 60200) {
          log('⚠️  Rate Limit', 'yellow');
          log('Too many verification attempts for this number. Wait a few minutes.', 'yellow');
        } else {
          log(`Twilio Error Code: ${data.details.code}`, 'red');
          log(`Message: ${data.details.message}`, 'yellow');
        }
      }
      return false;
    }
    
    log('✓ Verification started successfully', 'green');
    return true;
  } catch (error) {
    log(`Network Error: ${error.message}`, 'red');
    return false;
  }
}

async function testVerifyCheck() {
  log('\n━━━ Step 2: Testing Incorrect Code ━━━', 'blue');
  log(`Phone: ${TEST_PHONE}`, 'cyan');
  log(`Code: ${TEST_CODE} (intentionally incorrect)`, 'yellow');
  
  try {
    const response = await fetch(`${HUB_URL}/v1/verify/check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phone: TEST_PHONE,
        code: TEST_CODE
      })
    });
    
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    
    log(`Response Status: ${response.status}`, response.ok ? 'green' : 'red');
    log('Response Body:', 'cyan');
    console.log(JSON.stringify(data, null, 2));
    
    // Analyze the response
    log('\n━━━ Analysis ━━━', 'magenta');
    
    if (response.status === 400 && data.error === 'invalid_code') {
      log('✓ CORRECT BEHAVIOR: Server properly rejects invalid code', 'green');
      log('This means Twilio is working and verification sessions exist', 'green');
    } else if (response.status === 404 || (data.details && data.details.code === 20404)) {
      log('❌ PROBLEM: Verification session not found', 'red');
      log('Possible causes:', 'yellow');
      log('  1. No verification was started for this phone number', 'yellow');
      log('  2. The verification session expired (>10 minutes)', 'yellow');
      log('  3. The code was already successfully used', 'yellow');
      log('  4. Wrong TWILIO_VERIFY_SERVICE_SID configured', 'yellow');
    } else if (data.details && data.details.code === 60202) {
      log('⚠️  Max attempts reached for this verification', 'yellow');
      log('Need to start a new verification', 'yellow');
    } else if (response.ok && data.ok) {
      log('🤔 UNEXPECTED: Code was accepted as valid!', 'yellow');
      log('This should not happen with a random code', 'yellow');
    } else {
      log('❓ Unexpected response type', 'yellow');
    }
    
    return response.status === 400 && data.error === 'invalid_code';
  } catch (error) {
    log(`Network Error: ${error.message}`, 'red');
    return false;
  }
}

async function testDirectTwilioCheck() {
  log('\n━━━ Step 3: Direct Test (No Prior Start) ━━━', 'blue');
  log('Testing what happens when we check a code without starting verification first', 'cyan');
  
  try {
    const response = await fetch(`${HUB_URL}/v1/verify/check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phone: TEST_PHONE,
        code: '999999' // Random code
      })
    });
    
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    
    log(`Response Status: ${response.status}`, response.ok ? 'green' : 'red');
    log('Response Body:', 'cyan');
    console.log(JSON.stringify(data, null, 2));
    
    if (data.error === 'twilio_error' && data.details && data.details.code === 20404) {
      log('✓ Expected: No verification session exists', 'green');
    } else if (data.error === 'invalid_code') {
      log('⚠️  There might be an active verification session from a previous test', 'yellow');
    }
  } catch (error) {
    log(`Network Error: ${error.message}`, 'red');
  }
}

async function runTests() {
  console.log(colors.cyan + '\n╔══════════════════════════════════════════╗');
  console.log('║     Twilio Verify Response Test         ║');
  console.log('╚══════════════════════════════════════════╝' + colors.reset);
  
  log(`\nTesting against: ${HUB_URL}`, 'cyan');
  log(`Test phone: ${TEST_PHONE}`, 'cyan');
  
  // Test 1: Try to start a verification
  const startSuccess = await testVerifyStart();
  
  // Wait a moment to ensure Twilio processes it
  if (startSuccess) {
    log('\nWaiting 2 seconds for Twilio to process...', 'yellow');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test 2: Try an incorrect code
    await testVerifyCheck();
  }
  
  // Test 3: Try checking without starting (to see the error)
  await testDirectTwilioCheck();
  
  // Summary
  log('\n━━━ Summary ━━━', 'blue');
  log('\nDiagnosis:', 'magenta');
  
  if (!startSuccess) {
    log('❌ Twilio Verify is not properly configured', 'red');
    log('Check the server environment variables:', 'yellow');
    log('  - TWILIO_ACCOUNT_SID', 'yellow');
    log('  - TWILIO_AUTH_TOKEN or TWILIO_API_KEY_SID/SECRET', 'yellow');
    log('  - TWILIO_VERIFY_SERVICE_SID', 'yellow');
  } else {
    log('✓ Twilio Verify service is reachable', 'green');
    log('Check if you received an SMS with a code', 'cyan');
  }
}

// Run the tests
runTests().catch(error => {
  log(`\nFatal error: ${error.message}`, 'red');
  process.exit(1);
});
