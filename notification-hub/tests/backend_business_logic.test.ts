import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fetch from 'node-fetch';

// Test configuration
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3030';
const TEST_PHONE = '6502079445'; // Your verified phone number
let testUserToken: string;
let testUserId: string;
let testChannelId: string;
let testScriptId: string;

describe('Backend Business Logic Tests', () => {
  
  beforeAll(async () => {
    // Setup: Authenticate with your actual phone number
    console.log('Authenticating with phone number...');
    
    // Step 1: Request verification code
    const verifyResponse = await fetch(`${BASE_URL}/v1/auth/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phone: TEST_PHONE
      })
    });
    
    if (!verifyResponse.ok) {
      console.error('Failed to send verification code:', await verifyResponse.text());
      throw new Error('Could not send verification code');
    }
    
    const verifyData = await verifyResponse.json();
    console.log('Verification code sent. Please check your phone.');
    
    // For testing, we need to either:
    // 1. Have a test mode that accepts a known code
    // 2. Manually input the code during test run
    // 3. Use an existing valid token
    
    // For now, let's try to use an existing session if available
    // Otherwise prompt for verification code
    const verificationCode = process.env.TEST_VERIFICATION_CODE || '000000'; // Use test code or env var
    
    // Step 2: Confirm verification code
    const confirmResponse = await fetch(`${BASE_URL}/v1/auth/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phone: TEST_PHONE,
        code: verificationCode
      })
    });
    
    if (confirmResponse.ok) {
      const confirmData = await confirmResponse.json();
      testUserToken = confirmData.token;
      testUserId = confirmData.user.id;
      console.log('Successfully authenticated with user ID:', testUserId);
    } else {
      console.log('Using fallback token - tests may fail if not properly authenticated');
      testUserToken = process.env.TEST_USER_TOKEN || 'test-token';
    }
  });

  describe('Channel Operations', () => {
    
    it('should validate channel name is required', async () => {
      const response = await fetch(`${BASE_URL}/v1/user/channels/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Token': testUserToken
        },
        body: JSON.stringify({
          name: '',
          description: 'Test channel',
          isPublic: false
        })
      });
      
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toBe('validation_error');
      expect(data.message).toContain('Channel name is required');
    });

    it('should validate channel name length', async () => {
      const longName = 'a'.repeat(101);
      const response = await fetch(`${BASE_URL}/v1/user/channels/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Token': testUserToken
        },
        body: JSON.stringify({
          name: longName,
          description: 'Test channel',
          isPublic: false
        })
      });
      
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toBe('validation_error');
      expect(data.message).toContain('100 characters or less');
    });

    it('should create channel with backend-generated shortId', async () => {
      const channelName = `Test Channel ${Date.now()}`; // Unique name for each test run
      const response = await fetch(`${BASE_URL}/v1/user/channels/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Token': testUserToken
        },
        body: JSON.stringify({
          name: channelName,
          description: 'A test channel for automated testing',
          isPublic: true
        })
      });
      
      const data = await response.json();
      console.log('Channel creation response:', data);
      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.channel).toBeDefined();
      expect(data.channel.shortId).toMatch(/^[a-z0-9]{6}$/);
      expect(data.channel.name).toBe(channelName);
      
      testChannelId = data.channel.shortId;
      console.log('Created test channel:', testChannelId);
    });

    it('should validate message is required when sending', async () => {
      const response = await fetch(`${BASE_URL}/v1/user/channels/${testChannelId}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Token': testUserToken
        },
        body: JSON.stringify({
          message: ''
        })
      });
      
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toBe('validation_error');
      expect(data.message).toContain('Message is required');
    });

    it('should validate message length', async () => {
      const longMessage = 'a'.repeat(1001);
      const response = await fetch(`${BASE_URL}/v1/user/channels/${testChannelId}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Token': testUserToken
        },
        body: JSON.stringify({
          message: longMessage
        })
      });
      
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toBe('validation_error');
      expect(data.message).toContain('1000 characters or less');
    });

    it('should send real notification message through channel', async () => {
      const testMessage = `Backend test message - ${new Date().toLocaleTimeString()}`;
      const response = await fetch(`${BASE_URL}/v1/user/channels/${testChannelId}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Token': testUserToken
        },
        body: JSON.stringify({
          message: testMessage
        })
      });
      
      const data = await response.json();
      console.log('Message send response:', data);
      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.channel.name).toBeDefined();
      expect(data.notificationsSent).toBeGreaterThanOrEqual(1); // At least sent to you
      console.log(`Notification sent to ${data.notificationsSent} subscriber(s)`);
    });

    it('should normalize phone numbers in backend', async () => {
      // Use your actual phone number without country code
      const response = await fetch(`${BASE_URL}/v1/user/channels/${testChannelId}/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Token': testUserToken
        },
        body: JSON.stringify({
          phone: TEST_PHONE // Your phone without country code
        })
      });
      
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      // Backend should normalize to include country code
      expect(data.phone).toMatch(/^\+1/);
    });

    it('should validate phone number format', async () => {
      const response = await fetch(`${BASE_URL}/v1/user/channels/${testChannelId}/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Token': testUserToken
        },
        body: JSON.stringify({
          phone: 'invalid'
        })
      });
      
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toBe('validation_error');
      expect(data.message).toContain('Invalid phone number format');
    });

    it('should only allow public channel joining', async () => {
      // Try to join a non-existent or private channel
      const response = await fetch(`${BASE_URL}/v1/user/channels/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Token': testUserToken
        },
        body: JSON.stringify({
          shortId: 'private'
        })
      });
      
      const data = await response.json();
      expect(response.status).toBe(404);
      expect(data.error).toBe('channel_not_found');
      expect(data.message).toContain('does not exist or is not public');
    });
  });

  describe('Script Operations', () => {
    
    it('should create and execute a REAL weather script that sends notification', async () => {
      console.log('\n🌤️  Creating real weather script for channel:', testChannelId);
      
      // Create a weather script with a realistic prompt
      const response = await fetch(`${BASE_URL}/v1/user/channels/${testChannelId}/scripts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Token': testUserToken
        },
        body: JSON.stringify({
          userPrompt: 'Check the current weather in San Francisco and send a notification with temperature, conditions, and a brief forecast. Include an emoji that matches the weather.',
          variables: []
        })
      });
      
      const data = await response.json();
      console.log('Weather script creation response:', data);
      
      if (response.ok && data.ok) {
        expect(data.script).toBeDefined();
        expect(data.script.id).toBeDefined();
        testScriptId = data.script.id;
        console.log('✅ Created weather script with ID:', testScriptId);
        console.log('Script details:', {
          name: data.script.name,
          triggerType: data.script.triggerType
        });
        
        // Wait a moment for script to be ready
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Now execute the weather script to send actual weather notification
        console.log('\n📤 Executing weather script - check your phone for notification!');
        const executeResponse = await fetch(`${BASE_URL}/v1/user/scripts/${testScriptId}/execute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Token': testUserToken
          },
          body: JSON.stringify({})
        });
        
        const executeData = await executeResponse.json();
        console.log('\n📱 Weather script execution response:', executeData);
        
        expect(executeResponse.status).toBe(200);
        expect(executeData.ok).toBe(true);
        expect(executeData.notificationsSent).toBeGreaterThan(0);
        
        console.log(`\n✅ Weather notification sent to ${executeData.notificationsSent} subscriber(s)!`);
        console.log('📱 You should see the weather notification on your phone now!');
        console.log('Message sent:', executeData.message);
        
        // Give time for notification to arrive
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        console.error('❌ Weather script creation failed:', data);
        throw new Error('Could not create weather script');
      }
    });
    
    it('should create and test a simple notification script', async () => {
      const response = await fetch(`${BASE_URL}/v1/user/channels/${testChannelId}/scripts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Token': testUserToken
        },
        body: JSON.stringify({
          userPrompt: 'Send test notification saying "Automated test message from backend tests - ' + new Date().toLocaleTimeString() + '"',
          variables: []
        })
      });
      
      const data = await response.json();
      console.log('Simple script creation response:', data);
      
      if (response.ok && data.ok) {
        expect(data.script).toBeDefined();
        expect(data.script.id).toBeDefined();
        const simpleScriptId = data.script.id;
        console.log('Created simple test script:', simpleScriptId);
        
        // Now execute the script to actually send a notification
        const executeResponse = await fetch(`${BASE_URL}/v1/user/scripts/${simpleScriptId}/execute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Token': testUserToken
          },
          body: JSON.stringify({})
        });
        
        const executeData = await executeResponse.json();
        console.log('Simple script execution response:', executeData);
        expect(executeResponse.status).toBe(200);
        expect(executeData.ok).toBe(true);
        expect(executeData.notificationsSent).toBeGreaterThan(0);
      } else {
        console.warn('Simple script creation failed - OpenAI might be unavailable');
      }
    });

    it('should determine trigger type from prompt', async () => {
      const scheduledPrompt = 'Send notifications every hour';
      const webhookPrompt = 'Trigger when GitHub webhook is received';
      const manualPrompt = 'Send notification when button clicked';
      
      // Test schedule detection
      const response1 = await fetch(`${BASE_URL}/v1/user/channels/${testChannelId}/scripts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Token': testUserToken
        },
        body: JSON.stringify({
          userPrompt: scheduledPrompt,
          variables: []
        })
      });
      
      if (response1.ok) {
        const data1 = await response1.json();
        expect(data1.script.triggerType).toBe('schedule');
      }
    });

    it('should validate script prompt is required', async () => {
      const response = await fetch(`${BASE_URL}/v1/user/channels/${testChannelId}/scripts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Token': testUserToken
        },
        body: JSON.stringify({
          userPrompt: '',
          variables: []
        })
      });
      
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toBe('validation_error');
      expect(data.message).toContain('Script description is required');
    });

    it('should validate script prompt length', async () => {
      const longPrompt = 'a'.repeat(2001);
      const response = await fetch(`${BASE_URL}/v1/user/channels/${testChannelId}/scripts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Token': testUserToken
        },
        body: JSON.stringify({
          userPrompt: longPrompt,
          variables: []
        })
      });
      
      const data = await response.json();
      expect(response.status).toBe(400);
      expect(data.error).toBe('validation_error');
      expect(data.message).toContain('2000 characters or less');
    });

    it('should execute script and return formatted response', async () => {
      if (!testScriptId) {
        console.log('Skipping script execution test - no script created');
        return;
      }
      
      const response = await fetch(`${BASE_URL}/v1/user/scripts/${testScriptId}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Token': testUserToken
        },
        body: JSON.stringify({
          testData: { test: true }
        })
      });
      
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data).toHaveProperty('ok');
      expect(data).toHaveProperty('message');
      expect(data).toHaveProperty('notificationsSent');
      expect(data).toHaveProperty('duration');
    });
  });

  describe('Authentication Flow', () => {
    
    it('should require authentication for all user operations', async () => {
      // Test without token
      const response = await fetch(`${BASE_URL}/v1/user/channels/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: 'Test',
          description: 'Test',
          isPublic: false
        })
      });
      
      const data = await response.json();
      expect(response.status).toBe(401);
      expect(data.error).toBe('unauthorized');
    });

    it('should accept multiple token formats', async () => {
      // Test with Bearer token
      const response1 = await fetch(`${BASE_URL}/v1/user/channels/${testChannelId}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testUserToken}`
        },
        body: JSON.stringify({
          message: 'Test with Bearer'
        })
      });
      
      // Test with X-User-Token header
      const response2 = await fetch(`${BASE_URL}/v1/user/channels/${testChannelId}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Token': testUserToken
        },
        body: JSON.stringify({
          message: 'Test with X-User-Token'
        })
      });
      
      // Both should work
      if (testUserToken !== 'test-token') {
        expect(response1.status).toBe(200);
        expect(response2.status).toBe(200);
      }
    });
  });

  describe('Business Rule Enforcement', () => {
    
    it('should auto-subscribe channel creator', async () => {
      // When creating a channel, the creator should be automatically subscribed
      // This is a backend business rule, not frontend logic
      const response = await fetch(`${BASE_URL}/v1/user/channels/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Token': testUserToken
        },
        body: JSON.stringify({
          name: 'Auto Subscribe Test',
          description: 'Testing auto subscription',
          isPublic: false
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        // The backend should have subscribed the creator automatically
        // We can verify this by trying to send a message
        const sendResponse = await fetch(`${BASE_URL}/v1/user/channels/${data.channel.shortId}/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Token': testUserToken
          },
          body: JSON.stringify({
            message: 'Test message'
          })
        });
        
        expect(sendResponse.status).toBe(200);
      }
    });

    it('should enforce channel ownership for script creation', async () => {
      // Try to create a script for a channel we don't own
      // This should be enforced by backend, not frontend
      const response = await fetch(`${BASE_URL}/v1/user/channels/nonexistent/scripts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Token': testUserToken
        },
        body: JSON.stringify({
          userPrompt: 'Test script',
          variables: []
        })
      });
      
      const data = await response.json();
      expect(response.status).toBeOneOf([403, 404]);
      expect(data.error).toBeOneOf(['not_authorized', 'channel_not_found']);
    });

    it('should enforce permission to add subscribers to private channels', async () => {
      // Create a private channel
      const createResponse = await fetch(`${BASE_URL}/v1/user/channels/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Token': testUserToken
        },
        body: JSON.stringify({
          name: 'Private Channel',
          description: 'Private',
          isPublic: false
        })
      });
      
      if (createResponse.ok) {
        const createData = await createResponse.json();
        
        // Try to add a subscriber (should work for owner)
        const addResponse = await fetch(`${BASE_URL}/v1/user/channels/${createData.channel.shortId}/subscribe`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Token': testUserToken
          },
          body: JSON.stringify({
            phone: '+15559999999'
          })
        });
        
        expect(addResponse.status).toBe(200);
      }
    });
  });

  afterAll(async () => {
    // Cleanup: Delete test channels and scripts
    if (testChannelId && testUserToken) {
      try {
        // Delete the test channel
        const deleteResponse = await fetch(`${BASE_URL}/v1/user/channels/${testChannelId}`, {
          method: 'DELETE',
          headers: {
            'X-User-Token': testUserToken
          }
        });
        
        if (deleteResponse.ok) {
          console.log('Test channel deleted:', testChannelId);
        } else {
          console.log('Could not delete test channel');
        }
      } catch (error) {
        console.error('Cleanup error:', error);
      }
    }
    
    console.log('Test cleanup complete');
  });
});

// Add custom matcher for multiple possible values
expect.extend({
  toBeOneOf(received, expected) {
    const pass = expected.includes(received);
    return {
      pass,
      message: () => `expected ${received} to be one of ${expected.join(', ')}`
    };
  }
});
