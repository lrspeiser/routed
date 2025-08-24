# Routed App Build Process

## Overview

The Routed receiver app now includes a comprehensive pre-build validation system that ensures the server is operational and properly configured before creating a distributable build.

## Pre-Build Validation

Before building the DMG, the system automatically:

1. **Checks Server Health** - Verifies the backend server is running and accessible
2. **Ensures Admin Test User** - Creates/verifies a test user (+1-650-555-1212) 
3. **Ensures Test Channel** - Creates/verifies a test channel for validation
4. **Tests Messaging** - Sends a test message through the system
5. **Validates WebSocket** - Confirms WebSocket connectivity

## Build Commands

### Standard Build (with validation)
```bash
npm run dist
```
This command will:
- Run pre-build validation checks
- Build all workspace packages
- Create the macOS DMG installer

### Signed Build (with validation)
```bash
npm run dist:sign
```
Same as standard build but includes code signing with your Apple Developer certificate.

### Skip Validation (emergency use only)
```bash
npm run dist:no-check
```
Bypasses pre-build validation - use only when you're certain the server is working.

### Test Validation Only
```bash
npm run prebuild
```
Runs just the validation checks without building.

## Configuration

### Environment Variables

Create a `.env` file in the receiver-app directory:

```env
# Server URL (required)
HUB_URL=https://routed.onrender.com

# Admin token for test user creation (optional)
HUB_ADMIN_TOKEN=your_admin_token_here

# API key for channel/message operations (optional)
HUB_API_KEY=your_api_key_here
```

### Test User Configuration

The validation system uses a standard test user:
- Phone: +1-650-555-1212
- Name: Admin Test User
- Channel: Test Channel

## Build Output

Successful builds produce:
- **Location**: `dist/Routed-{version}-mac-arm64.dmg`
- **Size**: ~182 MB
- **Platform**: macOS Apple Silicon (ARM64)

## Troubleshooting

### Validation Failures

If pre-build validation fails:

1. **Server Unreachable**
   - Verify the server URL in `.env`
   - Check if the server is running
   - Test connectivity: `curl https://routed.onrender.com/v1/health/deep`

2. **Authentication Issues**
   - Ensure HUB_ADMIN_TOKEN is set for user creation
   - Verify HUB_API_KEY for channel operations

3. **Test User/Channel Issues**
   - The system will attempt to create these automatically
   - Check server logs for creation errors

### Emergency Build

If you need to build without validation:
```bash
npm run dist:no-check
```

**Warning**: Only use this if you're certain the server is functioning correctly.

## What's New in 1.9.9

- **Desktop-Only Mode**: External URL opening disabled for security
- **Connection Recovery**: Startup checks with re-authentication prompts
- **Pre-Build Validation**: Automated server health checks before building
- **Test Infrastructure**: Admin test user and channel for validation

## Development

### Running the App Locally
```bash
npm run dev
```

### Running Tests
```bash
npm test
```

### Modifying Validation

The validation script is located at:
```
scripts/prebuild-check.js
```

You can customize:
- Test phone number
- Test channel name
- Validation steps
- Timeout values

## Security Notes

- The app no longer opens external URLs
- All notifications stay within the desktop app
- Connection errors prompt for re-authentication
- Local settings can be cleared on connection failure

## Support

For build issues:
1. Check server status
2. Verify environment configuration
3. Review validation output
4. Use `dist:no-check` as last resort
