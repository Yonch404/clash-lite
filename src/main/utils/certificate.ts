import path from 'path'
import { readFile } from 'fs/promises'
import { resourcesFilesDir } from './dirs'

const CHROME_CA_FILE = 'chrome.pem'

let chromeCaBundlePromise: Promise<Buffer> | undefined

export function chromeCaBundlePath(): string {
  return path.join(resourcesFilesDir(), CHROME_CA_FILE)
}

export async function getChromeCaBundle(): Promise<Buffer> {
  if (!chromeCaBundlePromise) {
    chromeCaBundlePromise = readChromeCaBundle()
  }
  return chromeCaBundlePromise
}

async function readChromeCaBundle(): Promise<Buffer> {
  const caPath = chromeCaBundlePath()
  const bundle = await readFile(caPath)
  const content = bundle.toString('utf-8')
  if (!content.includes('-----BEGIN CERTIFICATE-----')) {
    throw new Error(`Invalid Chrome certificate bundle: ${caPath}`)
  }
  return bundle
}
