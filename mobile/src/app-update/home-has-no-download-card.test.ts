import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Why: the user asked for the in-app download progress card on Home to go
// (2026-10-11). The download still runs in the store and the dialog returns
// with Install when the file is in; only the progress shower is gone. This is
// a structure pin (what Home mounts), so it reads source with comments removed
// and matches code, not the prose that explains why.

const src = path.resolve(import.meta.dirname, '..')

function code(relative: string): string {
  return readFileSync(path.join(src, relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('Home draws no download progress card', () => {
  it('has no HomeUpdateDownloadCard component file', () => {
    expect(existsSync(path.join(src, 'app-update/HomeUpdateDownloadCard.tsx'))).toBe(false)
  })

  it('mounts only the update dialog from HomeUpdateSurface', () => {
    const surface = code('app-update/HomeUpdateSurface.tsx')
    expect(surface).not.toMatch(/DownloadCard/)
    expect(surface).toMatch(/<AppUpdateDialog\s*\/>/)
  })

  it('does not mount any download card from the Home screen', () => {
    expect(code('home/MobileHomeScreen.tsx')).not.toMatch(/DownloadCard/)
  })
})
