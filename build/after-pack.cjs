module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return

  // electron-builder installs deb/rpm payloads into /opt/${sanitizedProductName}.
  // Keep the display name as "Clash Lite", but use a shell-friendly Linux directory.
  context.packager.appInfo.sanitizedProductName = 'clash-lite'
}
