const { notarize } = require('@electron/notarize');

exports.default = async function notarizeMac(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== 'darwin') return;

  // Read secrets from environment (set via .env when using dist:sign)
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    // Skip notarization when credentials are not present
    console.log('[notarize] Skipping (APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID not set)');
    return;
  }

  const appName = packager.appInfo.productFilename;
  const appBundleId = packager.appInfo.bundleId || packager.appInfo.appId || 'com.routed.app';
  const appPath = `${appOutDir}/${appName}.app`;

  console.log(`[notarize] Notarizing ${appBundleId} at ${appPath}`);
  await notarize({
    appBundleId,
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  });
  console.log('[notarize] Done');
};
