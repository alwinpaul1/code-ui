import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// On 2026-10-04 two new test files passed tsc, vitest and oxlint and still failed the
// tests-typecheck ratchet, because neither the release workflow nor CLAUDE.md's gate ran it.
const repoRoot = path.resolve(__dirname, '..', '..')

function codeLines(text: string, commentPrefix: string): string[] {
  return text.split('\n').filter((line) => !line.trimStart().startsWith(commentPrefix))
}

describe('the gate a release passes', () => {
  it('runs the tests-typecheck ratchet in the release workflow', () => {
    const workflow = fs.readFileSync(
      path.join(repoRoot, '.github', 'workflows', 'mobile-android-release.yml'),
      'utf8'
    )
    const runsRatchet = codeLines(workflow, '#').some((line) =>
      /^\s*(-\s*run:\s*)?pnpm check:tests-typecheck\s*$/.test(line)
    )
    expect(runsRatchet).toBe(true)
  })

  it("lists the ratchet in CLAUDE.md's checks before calling work done", () => {
    const guide = fs.readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf8')
    const block = guide.split('## Checks before calling work done')[1]?.split('```')[1] ?? ''
    expect(block).toContain('node scripts/check-tests-typecheck-ratchet.mjs')
  })
})
