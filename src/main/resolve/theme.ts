import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import path from 'path'
import { mainWindow } from '../window'
import { resourcesFilesDir } from '../utils/dirs'

export async function applyTheme(): Promise<void> {
  const themePath = path.join(resourcesFilesDir(), 'themes', 'default.css')
  const css = existsSync(themePath) ? await readFile(themePath, 'utf-8') : ''
  await mainWindow?.webContents.insertCSS(css)
}
