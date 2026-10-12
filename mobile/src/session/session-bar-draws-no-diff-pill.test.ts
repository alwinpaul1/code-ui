import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Reported 2026-10-12 with a screenshot circling "Diff +1305" above the
// composer: "Remove this diff". Which component feeds the bar is a defect of
// structure, so this reads the code (CLAUDE.md rule 6), comments stripped.
function code(file: string): string {
  return readFileSync(path.join(import.meta.dirname, file), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')
}

describe('the session bar above the composer', () => {
  it('is handed no diff, so it draws only the task pill', () => {
    expect(code('MobileNativeChatView.tsx')).not.toMatch(/<MobileNativeChatSessionBar[^>]*\bdiff=/)
  })

  it('reads no git status for a diff it would not draw', () => {
    expect(code('MobileSessionActiveContent.tsx')).not.toMatch(/useSessionDiffTotals\(/)
  })
})
