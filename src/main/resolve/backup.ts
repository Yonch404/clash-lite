import { existsSync } from 'fs'
import dayjs from 'dayjs'
import AdmZip from 'adm-zip'
import { dialog } from 'electron'
import i18next from 'i18next'
import { systemLogger } from '../utils/logger'
import {
  appConfigPath,
  controledMihomoConfigPath,
  dataDir,
  profileConfigPath,
  profilesDir
} from '../utils/dirs'

function createBackupZip(): AdmZip {
  const zip = new AdmZip()

  const files = [appConfigPath(), controledMihomoConfigPath(), profileConfigPath()]
  const folders = [{ path: profilesDir(), name: 'profiles' }]

  for (const file of files) {
    if (existsSync(file)) {
      zip.addLocalFile(file)
    }
  }

  for (const { path, name } of folders) {
    if (existsSync(path)) {
      zip.addLocalFolder(path, name)
    }
  }

  return zip
}

export async function exportLocalBackup(): Promise<boolean> {
  const zip = createBackupZip()

  const date = new Date()
  const zipFileName = `clash-lite-backup-${dayjs(date).format('YYYY-MM-DD_HH-mm-ss')}.zip`
  const result = await dialog.showSaveDialog({
    title: i18next.t('localBackup.export.title'),
    defaultPath: zipFileName,
    filters: [
      { name: 'ZIP Files', extensions: ['zip'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })

  if (!result.canceled && result.filePath) {
    zip.writeZip(result.filePath)
    await systemLogger.info(`Local backup exported to: ${result.filePath}`)
    return true
  }
  return false
}

export async function importLocalBackup(): Promise<boolean> {
  const result = await dialog.showOpenDialog({
    title: i18next.t('localBackup.import.title'),
    filters: [
      { name: 'ZIP Files', extensions: ['zip'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  })

  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0]
    const zip = new AdmZip(filePath)
    zip.extractAllTo(dataDir(), true)
    await systemLogger.info(`Local backup imported from: ${filePath}`)
    return true
  }
  return false
}
