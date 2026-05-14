import { exec, execFile, spawn } from 'child_process'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { promisify } from 'util'
import { app, dialog, nativeTheme, shell } from 'electron'
import i18next from 'i18next'
import { dataDir, exePath, mihomoCorePath, profilePath, resourcesDir } from '../utils/dirs'
import { checkAdminPrivileges } from '../core/admin'

export function getFilePath(
  ext: string[],
  title?: string,
  filterName?: string
): string[] | undefined {
  return dialog.showOpenDialogSync({
    title: title || i18next.t('common.dialog.selectSubscriptionFile'),
    filters: [{ name: filterName || `${ext} file`, extensions: ext }],
    properties: ['openFile']
  })
}

export async function readTextFile(filePath: string): Promise<string> {
  return await readFile(filePath, 'utf8')
}

export async function readImageFileDataURL(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase()
  const mimeType =
    ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : ext === '.webp'
        ? 'image/webp'
        : ext === '.gif'
          ? 'image/gif'
          : 'image/png'
  const data = await readFile(filePath)

  return `data:${mimeType};base64,${data.toString('base64')}`
}

export function openFile(type: 'profile', id: string): void {
  if (type === 'profile') shell.openPath(profilePath(id))
}

export async function openUWPTool(): Promise<void> {
  const execPromise = promisify(exec)
  const execFilePromise = promisify(execFile)
  const uwpToolPath = path.join(resourcesDir(), 'files', 'enableLoopback.exe')

  const isAdmin = await checkAdminPrivileges()

  if (!isAdmin) {
    const escapedPath = uwpToolPath.replace(/'/g, "''")
    const command = `powershell -NoProfile -Command "Start-Process -FilePath '${escapedPath}' -Verb RunAs -Wait"`

    await execPromise(command, { windowsHide: true })
    return
  }
  await execFilePromise(uwpToolPath)
}

export async function setupFirewall(): Promise<void> {
  const execFilePromise = promisify(execFile)

  if (process.platform === 'win32') {
    const rules = [
      { name: 'mihomo', program: mihomoCorePath('mihomo') },
      { name: 'Clash Lite', program: exePath() }
    ]

    const escapePowerShellSingleQuoted = (value: string): string => value.replace(/'/g, "''")
    const scriptPath = path.join(dataDir(), 'reset-firewall.ps1')
    const script = `\
$rules = @(
${rules
  .map(
    (rule) =>
      `  @{ Name = '${escapePowerShellSingleQuoted(rule.name)}'; Program = '${escapePowerShellSingleQuoted(rule.program)}' }`
  )
  .join(',\n')}
)

foreach ($rule in $rules) {
  & netsh advfirewall firewall delete rule name="$($rule.Name)" | Out-Null
  & netsh advfirewall firewall add rule name="$($rule.Name)" dir=in action=allow program="$($rule.Program)" enable=yes profile=any | Out-Null
}
`

    await writeFile(scriptPath, script, 'utf8')

    const isAdmin = await checkAdminPrivileges()
    if (!isAdmin) {
      const argumentList = `-NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`
      const command =
        `$arguments = '${escapePowerShellSingleQuoted(argumentList)}'; ` +
        `Start-Process -FilePath 'powershell.exe' ` +
        `-ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -Wait`

      await execFilePromise(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
        { windowsHide: true }
      )
      return
    }

    await execFilePromise(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { windowsHide: true }
    )

    return
  }

  if (process.platform === 'linux') {
    const linuxFirewallResetScript = `
if command -v nft >/dev/null 2>&1; then
  for family in inet ip ip6; do
    for table in mihomo clash; do
      nft delete table "$family" "$table" 2>/dev/null || true
    done
  done
fi

reset_iptables() {
  cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || return 0
  for table in nat mangle; do
    for chain in MIHOMO Mihomo mihomo CLASH Clash clash; do
      for base in PREROUTING OUTPUT INPUT FORWARD POSTROUTING; do
        while "$cmd" -t "$table" -D "$base" -j "$chain" 2>/dev/null; do :; done
      done
      "$cmd" -t "$table" -F "$chain" 2>/dev/null || true
      "$cmd" -t "$table" -X "$chain" 2>/dev/null || true
    done
  done
}

reset_iptables iptables
reset_iptables ip6tables
exit 0
`.trim()

    if (process.geteuid?.() === 0) {
      await execFilePromise('sh', ['-c', linuxFirewallResetScript])
    } else {
      await execFilePromise('pkexec', ['sh', '-c', linuxFirewallResetScript])
    }
  }
}

export function setNativeTheme(theme: 'system' | 'light' | 'dark'): void {
  nativeTheme.themeSource = theme
}

export function resetAppConfig(): void {
  if (process.platform === 'win32') {
    spawn(
      'cmd',
      [
        '/C',
        `"timeout /t 2 /nobreak >nul && rmdir /s /q "${dataDir()}" && start "" "${exePath()}""`
      ],
      {
        shell: true,
        detached: true
      }
    ).unref()
  } else {
    const script = `while kill -0 ${process.pid} 2>/dev/null; do
  sleep 0.1
done
  rm -rf '${dataDir()}'
  ${process.argv.join(' ')} & disown
exit
`
    spawn('sh', ['-c', `"${script}"`], {
      shell: true,
      detached: true,
      stdio: 'ignore'
    })
  }
  app.quit()
}
