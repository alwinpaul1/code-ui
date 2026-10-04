import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The phone draws every terminal pane with xterm.js in the WebView, the engine Orca's own mobile
 * app ships. libghostty was the engine from 0.4 to 0.9.114 and was removed on purpose; this fence
 * keeps it from coming back through a stray import, a dependency a merge restores, or a second
 * engine branch in the pane.
 *
 * Structure, not behaviour: which module a pane mounts and what the package lists have no
 * behavioural handle, so these read source. They match code (import specifiers, JSON keys, JSX),
 * never commentary, because the files that remember why Ghostty left say its name in prose.
 */

const mobileDir = join(import.meta.dirname, '..', '..')
const SKIPPED_DIRS = new Set(['node_modules', 'build', '.gradle', '.expo', 'Pods', '.git', 'dist'])
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|json|ya?ml|gradle|kts|kt|java|patch)$/

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name)) {
      continue
    }
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...sourceFiles(path))
    } else if (SOURCE_FILE.test(entry.name) && entry.name !== 'pnpm-lock.yaml') {
      found.push(path)
    }
  }
  return found
}

const IMPORTS_LIBGHOSTTY = /(?:from\s*|require\(\s*|import\(\s*|import\s+)['"]expo-libghostty(?:\/[^'"]*)?['"]/

describe('the terminal engine is xterm.js in the WebView and nothing else', () => {
  const files = sourceFiles(mobileDir)

  it('has no file under mobile/ that imports expo-libghostty', () => {
    // The precondition: a walk that read nothing would report no offender either.
    expect(files.length).toBeGreaterThan(300)
    const offenders = files
      .filter((file) => !file.endsWith('terminal-xterm-only.test.ts'))
      .filter((file) => IMPORTS_LIBGHOSTTY.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(mobileDir.length + 1))
    expect(offenders).toEqual([])
  })

  it('would report a file that imported it', () => {
    expect(IMPORTS_LIBGHOSTTY.test("import { TerminalView } from 'expo-libghostty'")).toBe(true)
    expect(IMPORTS_LIBGHOSTTY.test("const m = require('expo-libghostty')")).toBe(true)
    expect(IMPORTS_LIBGHOSTTY.test("// expo-libghostty was removed")).toBe(false)
  })

  it('lists no libghostty package, patch or build allowance', () => {
    const manifest = JSON.parse(readFileSync(join(mobileDir, 'package.json'), 'utf8')) as Record<
      string,
      Record<string, string> | undefined
    >
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
      expect(Object.keys(manifest[section] ?? {}).filter((name) => /ghostty/i.test(name))).toEqual(
        []
      )
    }
    expect(readFileSync(join(mobileDir, 'pnpm-workspace.yaml'), 'utf8')).not.toMatch(/ghostty/i)
    expect(readdirSync(join(mobileDir, 'patches')).filter((name) => /ghostty/i.test(name))).toEqual(
      []
    )
  })

  it('keeps the Ghostty engine modules deleted', () => {
    const terminalDir = join(mobileDir, 'src', 'terminal')
    for (const name of [
      'TerminalGhosttyView.tsx',
      'ghostty-theme-from-mobile-theme.ts',
      'terminal-modes-from-ghostty-mask.ts',
      'terminal-engine-preference.ts',
      'use-terminal-engine.ts',
      'terminal-replay-guard.ts'
    ]) {
      expect(existsSync(join(terminalDir, name)), name).toBe(false)
    }
  })

  it('draws a pane with TerminalWebView and takes no engine to choose one', () => {
    const pane = readFileSync(join(mobileDir, 'src', 'session', 'TerminalPaneView.tsx'), 'utf8')
    expect(pane).toMatch(/<TerminalWebView[\s\n]/)
    expect(pane).not.toMatch(/\bengine\b/i)
    expect(pane).not.toMatch(/ghostty/i)
    const content = readFileSync(
      join(mobileDir, 'src', 'session', 'MobileSessionActiveContent.tsx'),
      'utf8'
    )
    expect(content).not.toMatch(/useTerminalEngine|terminalEngine/)
  })
})
