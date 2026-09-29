import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Structure, not behaviour: which module decides "no hosts" and from what. A defect of shape, so
 * a source-reading test (CLAUDE.md rule 6). Comments are stripped first so the long "why" notes
 * cannot satisfy or trip a pattern.
 */
function code(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('a screen that words an empty host list as a claim waits for the read', () => {
  it('the home screen decides its body through homeBodyKind, not hostCatalog.length', () => {
    const src = code('./home/MobileHomeScreen.tsx')
    expect(src).toContain('homeBodyKind(data.hostCatalogLoaded')
    expect(src).not.toMatch(/hostCatalog\.length\s*===\s*0/)
  })

  it('no app route seeds its host list with [] and fills it from a bare loadHosts()', () => {
    for (const route of ['terminal-settings', 'connection-log', 'voice-settings']) {
      const src = code(`../app/${route}.tsx`)
      expect(src, route).toContain('useLoadedHosts()')
      expect(src, route).not.toMatch(/useState<HostProfile\[\]>\(\[\]\)/)
      expect(src, route).not.toMatch(/loadHosts\(\)\s*\.then/)
    }
  })

  it('the loading home body and the theme background come from the theme, not a literal', () => {
    const src = code('./home/MobileHomeScreen.tsx')
    expect(src).toContain('backgroundColor: colors.bg')
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})
