const { notarize } = require('@electron/notarize');

exports.default = async function notarizeMac(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== 'darwin') return;

  // Read secrets from environment (set via .env when using dist:sign)
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  // Optional: use a stored notarytool keychain profile instead of raw creds
  const keychainProfile = process.env.AC_PASSWORD_PROFILE || process.env.NOTARYTOOL_PROFILE;

  if ((!keychainProfile && (!appleId || !appleIdPassword)) || !teamId) {
    // Skip notarization when credentials are not present
    console.log('[notarize] Skipping (missing creds). Provide AC_PASSWORD_PROFILE (or NOTARYTOOL_PROFILE) or APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID.');
    return;
  }

  const appName = packager.appInfo.productFilename;
  const appBundleId = packager.appInfo.bundleId || packager.appInfo.appId || 'com.routed.app';
  const appPath = `${appOutDir}/${appName}.app`;

  console.log(`[notarize] Notarizing ${appBundleId} at ${appPath}`);
  try {
    const options = {
      tool: 'notarytool',
      appBundleId,
      appPath,
    };
    if (keychainProfile) {
      options.keychainProfile = keychainProfile;
      options.teamId = teamId;
    } else {
      options.appleId = appleId;
      options.appleIdPassword = appleIdPassword;
      options.teamId = teamId;
    }
    await notarize(options);
    console.log('[notarize] Done');
  } catch (err) {
    console.error('[notarize] Failed:', err && err.message ? err.message : err);
    throw err;
  }
};
