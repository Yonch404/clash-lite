import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { parse as parsePlist } from 'plist'

function isIOSApp(appPath: string): boolean {
  const appDir = appPath.endsWith('.app')
    ? appPath
    : appPath.includes('.app')
      ? appPath.substring(0, appPath.indexOf('.app') + 4)
      : path.dirname(appPath)

  return !fs.existsSync(path.join(appDir, 'Contents'))
}

function findBestAppPath(appPath: string): string | null {
  if (!appPath.includes('.app') && !appPath.includes('.xpc')) {
    return null
  }

  const parts = appPath.split(path.sep)
  const appPaths: string[] = []

  for (let i = 0; i < parts.length; i++) {
    if (parts[i].endsWith('.app') || parts[i].endsWith('.xpc')) {
      const fullPath = parts.slice(0, i + 1).join(path.sep)
      appPaths.push(fullPath)
    }
  }
  if (appPaths.length === 0) {
    return null
  }
  if (appPaths.length === 1) {
    return appPaths[0]
  }
  return appPaths[appPaths.length - 1]
}

export async function getAppName(appPath: string): Promise<string> {
  if (process.platform === 'darwin') {
    try {
      const targetPath = findBestAppPath(appPath)
      if (!targetPath) return ''

      if (isIOSApp(targetPath)) {
        const plistPath = path.join(targetPath, 'Info.plist')
        const xml = fs.readFileSync(plistPath, 'utf-8')
        const parsed = parsePlist(xml) as Record<string, unknown>
        return (parsed.CFBundleDisplayName as string) || (parsed.CFBundleName as string) || ''
      }

      try {
        const appName = getLocalizedAppName(targetPath)
        if (appName) return appName
      } catch {
        // ignore
      }

      const plistPath = path.join(targetPath, 'Contents', 'Info.plist')
      if (fs.existsSync(plistPath)) {
        const xml = fs.readFileSync(plistPath, 'utf-8')
        const parsed = parsePlist(xml) as Record<string, unknown>

        return (parsed.CFBundleDisplayName as string) || (parsed.CFBundleName as string) || ''
      } else {
        // ignore
      }
    } catch {
      // ignore
    }
  }
  return ''
}

function getLocalizedAppName(appPath: string): string {
  const escapedPath = appPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const jxa = `
  ObjC.import('Foundation');
  const fm = $.NSFileManager.defaultManager;
  const name = fm.displayNameAtPath('${escapedPath}');
  name.js;
`
  const res = spawnSync('osascript', ['-l', 'JavaScript'], {
    input: jxa,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  })
  if (res.error) {
    throw res.error
  }
  if (res.status !== 0) {
    throw new Error(res.stderr.trim() || `osascript exited ${res.status}`)
  }
  return res.stdout.trim()
}
