#!/usr/bin/env node

/**
 * Test script to verify OpenAI configuration on the Routed backend
 * This checks the new health endpoints to ensure the server recognizes
 * the OPEN_AI_KEY environment variable
 */

const https = require('https');

const BASE_URL = process.env.BASE_URL || 'https://routed.onrender.com';

function makeRequest(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: JSON.parse(data)
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            data: data
          });
        }
      });
    }).on('error', reject);
  });
}

async function test() {
  console.log('🔍 Testing OpenAI Configuration on', BASE_URL);
  console.log('=' . repeat(60));
  
  // Test 1: Check version endpoint for config_status
  console.log('\n📋 Checking /v1/version for config status...');
  try {
    const version = await makeRequest('/v1/version');
    if (version.status === 200 && version.data.config_status) {
      const openaiConfigured = version.data.config_status.openai_configured;
      console.log(`  ✅ Version endpoint available`);
      console.log(`  OpenAI configured: ${openaiConfigured ? '✅ YES' : '❌ NO'}`);
      if (version.data.features?.script_generation) {
        console.log(`  Script generation feature: ✅ ENABLED`);
      } else {
        console.log(`  Script generation feature: ❌ DISABLED`);
      }
    } else if (version.status === 200) {
      console.log(`  ⚠️  Version endpoint exists but no config_status (old version)`);
    } else {
      console.log(`  ❌ Version endpoint returned status ${version.status}`);
    }
  } catch (e) {
    console.log(`  ❌ Error checking version:`, e.message);
  }
  
  // Test 2: Check OpenAI-specific health endpoint
  console.log('\n🤖 Checking /v1/health/openai...');
  try {
    const health = await makeRequest('/v1/health/openai');
    if (health.status === 200) {
      console.log(`  ✅ OpenAI is configured!`);
      console.log(`  Key source: ${health.data.key_source}`);
      console.log(`  Key prefix: ${health.data.key_prefix}`);
    } else if (health.status === 503) {
      console.log(`  ❌ OpenAI NOT configured`);
      console.log(`  Message: ${health.data.message}`);
    } else if (health.status === 404) {
      console.log(`  ⚠️  Endpoint not found (server not yet updated)`);
    } else {
      console.log(`  ❌ Unexpected status: ${health.status}`);
    }
  } catch (e) {
    console.log(`  ❌ Error checking OpenAI health:`, e.message);
  }
  
  // Test 3: Check comprehensive config health
  console.log('\n🏥 Checking /v1/health/config...');
  try {
    const config = await makeRequest('/v1/health/config');
    if (config.status === 200) {
      console.log(`  ✅ Config health endpoint available`);
      const services = config.data.services;
      
      console.log('\n  Service Status:');
      console.log(`    Database: ${services.database.configured ? '✅' : '❌'}`);
      console.log(`    Redis: ${services.redis.configured ? '✅' : '❌'}`);
      console.log(`    Twilio: ${services.twilio.account_configured ? '✅' : '❌'}`);
      console.log(`    OpenAI: ${services.ai.openai.configured ? '✅' : '❌'} (${services.ai.openai.env_var_used})`);
      console.log(`    Gemini: ${services.ai.gemini.configured ? '✅' : '❌'}`);
      
      if (config.data.recommendations && config.data.recommendations.length > 0) {
        console.log('\n  ⚠️  Recommendations:');
        config.data.recommendations.forEach(rec => {
          const icon = rec.severity === 'critical' ? '🔴' : rec.severity === 'warning' ? '🟡' : '🔵';
          console.log(`    ${icon} [${rec.service}] ${rec.message}`);
        });
      }
    } else if (config.status === 404) {
      console.log(`  ⚠️  Endpoint not found (server not yet updated)`);
    } else {
      console.log(`  ❌ Unexpected status: ${config.status}`);
    }
  } catch (e) {
    console.log(`  ❌ Error checking config health:`, e.message);
  }
  
  console.log('\n' + '=' . repeat(60));
  console.log('✅ Test complete!\n');
  
  console.log('💡 Next steps:');
  console.log('  1. If OpenAI is not configured, wait for server to redeploy');
  console.log('  2. The server should now recognize OPEN_AI_KEY env variable');
  console.log('  3. Once configured, script generation should work in the app');
}

test().catch(console.error);
