import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Structure, not behaviour: which read a screen decides "this desktop is gone" from. loadHosts()
 * drops a host whose Keychain read throws, so any screen that looked its host up there called a
 * locked desktop removed or not found (review, 2026-09-30). A defect of shape, so a source-reading
 * test (CLAUDE.md rule 6). Comments are stripped first, so the "why" notes that name loadHosts()
 * and the old wording cannot satisfy or trip a pattern.
 */
function code(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

// `hosts.find((h) => h.id === hostId)` and its spellings: the lookup the screens used to do.
const FINDS_HOST_BY_ID = /\.find\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.id\s*===\s*hostId\s*\)/

/** Every non-test source file under app/ and src/, as paths relative to this test. */
function sourceFiles(): string[] {
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
        files.push(relative(import.meta.dirname, full))
      }
    }
  }
  walk(join(root, 'app'))
  walk(join(root, 'src'))
  return files
}

describe('a screen opened for one desktop says what the catalog knows about it', () => {
  it.each([
    ['../app/h/[hostId]/edit.tsx', /\busePairedHostLookup\(hostId,/],
    ['../app/h/[hostId]/accounts.tsx', /\buseAccountsHostLookup\(hostId\)/],
    ['./accounts/use-accounts-host-lookup.ts', /\busePairedHostLookup\(hostId,/],
    ['./transport/use-paired-host-lookup.ts', /\blookUpPairedHost\(hostId\)/],
    ['./host-screen/use-host-screen-identity.ts', /\blookUpPairedHost\(hostId\)/]
  ])('%s looks its desktop up through lookUpPairedHost, not in a loaded list', (path, lookup) => {
    const src = code(path)
    expect(src).toMatch(lookup)
    expect(src).not.toMatch(FINDS_HOST_BY_ID)
    expect(src).not.toMatch(/'Host not found'|removed from this phone/)
  })

  it('every module that looks one desktop up reads a failed lookup again on a new connection', () => {
    // Found by shape: Accounts and Edit host each looked their desktop up once per host id, so a
    // failed read stayed on screen over a desktop that had since connected (review, 2026-09-30).
    // CLAUDE.md "Nothing stays stale once the relay connects" puts the re-read beside the lookup.
    const callers = sourceFiles().filter((file) =>
      /(?<!function\s)\blookUpPairedHost\(/.test(code(file))
    )
    expect(callers.length).toBeGreaterThan(0)
    const stale = callers.filter((file) => !/\bshouldRefetchAfterReconnect\(/.test(code(file)))
    expect(stale).toEqual([])
  })

  it('Troubleshooting counts and walks the catalog and never reads loadHosts()', () => {
    const src = code('../app/troubleshoot.tsx')
    expect(src).not.toMatch(/\bloadHosts\(/)
    expect(src).toMatch(/troubleshootPairedHostsCheck\(\s*await loadHostCatalog\(\)\s*\)/)
    expect(src).toMatch(/troubleshootHostTarget\(entry\)/)
  })

  it('the client opener reads the catalog, so its log can say why a listed desktop did not open', () => {
    const src = code('./transport/host-entry-opener.ts')
    expect(src).not.toMatch(/\bloadHosts\(/)
    expect(src).toMatch(/await loadHostCatalog\(\)/)
  })

  it('no module that reads loadHosts() words a desktop it did not find as removed or not found', () => {
    // Found by shape, not by a list of screens: every non-test source file under app/ and src/.
    const offenders = sourceFiles().filter((file) => {
      const src = code(file)
      return /\bloadHosts\(\)/.test(src) && /['"`][^'"`]*(not found|removed)[^'"`]*['"`]/i.test(src)
    })
    expect(offenders).toEqual([])
  })
})
