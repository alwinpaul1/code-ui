import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sourceRoot = fileURLToPath(new URL('..', import.meta.url))

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

/**
 * "Keep computer awake" was a mirror of Orca's desktop popover, and this host
 * build never exposed it: the mobile `settings.get` whitelist leaves the
 * keep-awake keys out, so the row could only render disabled with an
 * "unsupported" hint. Removed on the user's instruction (2026-09-13); this
 * keeps it from drifting back in from an upstream port.
 *
 * Scoped to the phone app. `src/shared/` is vendored Orca and keeps its own
 * settings types, and the Mac host controls' `caffeinate` is a different
 * feature (waking a display on demand, not holding the machine awake).
 */
describe('the keep-awake mirror', () => {
  it('is gone from the phone app', () => {
    const offenders = sourceFiles(sourceRoot)
      .filter((path) => !path.endsWith('computer-awake-removed.test.ts'))
      .filter((path) => /computerAwake|ComputerAwake|computer-awake/.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(sourceRoot.length))
    expect(offenders).toEqual([])
  })
})
