import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
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
    expect(src).toMatch(/homeBodyKind\(\s*data\.hostCatalogLoaded/)
    expect(src).not.toMatch(/hostCatalog\.length\s*===\s*0/)
  })

  it('the home screen hands the body its kind unchanged, not a re-derived one', () => {
    const src = code('./home/MobileHomeScreen.tsx')
    // The whole derivation, to the end of its line: a suffix like `=== 'hosts' ? 'hosts' : 'pair'`
    // fails it. The read failure is an input: without it a failed read is drawn as "none".
    expect(src).toMatch(
      /^\s*const bodyKind = homeBodyKind\(\s*data\.hostCatalogLoaded,\s*data\.hostCatalog\.length,\s*data\.hostCatalogFailed\s*\)\s*$/m
    )
    expect(src).toMatch(/kind=\{bodyKind\}/)
    // A re-mapped kind (loading drawn as the pairing screen) is the launch flash again.
    expect(src).not.toMatch(/kind=\{(?!bodyKind\})/)
  })

  it('no route or component seeds a host list with [] and fills it from a bare load', () => {
    // Found by shape, not by a list of screens: every non-test source file under app/ and src/.
    const root = join(import.meta.dirname, '..')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules') {
          continue
        }
        const full = join(dir, name)
        if (statSync(full).isDirectory()) {
          walk(full)
        } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          files.push(full)
        }
      }
    }
    walk(join(root, 'app'))
    walk(join(root, 'src'))
    // These two seed [] on purpose and carry their own "loaded" flag.
    const owners = ['src/transport/use-loaded-hosts.ts', 'src/home/use-home-host-catalog.ts']
    const offenders = files
      .filter((file) => !owners.some((owner) => file.endsWith(owner)))
      .filter((file) => {
        const src = code(relative(import.meta.dirname, file))
        return (
          /useState<(HostProfile|HostCatalogEntry)\[\]>\(\[\]\)/.test(src) ||
          /loadHosts\(\)\s*\.then\(\s*set/.test(src)
        )
      })
      .map((file) => relative(root, file))
    expect(offenders).toEqual([])
    // The three settings routes the flash was found in must still go through the hook.
    for (const route of ['terminal-settings', 'connection-log', 'voice-settings']) {
      expect(code(`../app/${route}.tsx`), route).toContain('useLoadedHosts()')
    }
  })

  it("an unavailable card's re-check takes its place in the read order when it starts", () => {
    const src = code('./home/MobileHomeScreen.tsx')
    expect(src).toMatch(/data\s*\.recheckHostCatalog\(\)/)
    expect(src).not.toMatch(/loadHostCatalog\(\)\s*\.then\(data\.setHostCatalog\)/)
  })

  it('home removes a desktop through removeHomeHost, which tells a failed removal from a failed re-read', () => {
    const src = code('./home/MobileHomeScreen.tsx')
    expect(src).toMatch(/removeHomeHost\(/)
    // An inline read after the removal, inside the removal's own try, is the defect.
    expect(src).not.toMatch(/loadHostCatalog/)
    expect(src).not.toMatch(/Could not remove host/)
  })

  it('the failed-read home body takes its colours from the theme, not a literal', () => {
    const src = code('./home/MobileHomeCatalogFailedState.tsx')
    expect(src).toMatch(/useTheme\(\)/)
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)
  })

  it('the loading home body and the theme background come from the theme, not a literal', () => {
    const src = code('./home/MobileHomeScreen.tsx')
    expect(src).toContain('backgroundColor: colors.bg')
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})
