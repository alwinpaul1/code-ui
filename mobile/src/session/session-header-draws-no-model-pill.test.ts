import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Reported 2026-10-11 with a screenshot circling "Opus 5.5 Medium" beside
// "2 tabs" in the session header: "Stop showing model name and effort here".
// The composer's own model pill stays; the header draws none. A source check,
// because the defect is which component mounts the label (CLAUDE.md rule 6):
// it reads the JSX, not the comments.
const source = readFileSync(path.join(import.meta.dirname, 'MobileSessionHeader.tsx'), 'utf8')
const code = source
  .split('\n')
  .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/*'))
  .join('\n')

describe('the session header', () => {
  it('draws no model and effort pill beside the tab count', () => {
    expect(code).not.toMatch(/accessibilityLabel=\{`Model /)
    expect(code).not.toMatch(/\{modelLabel\}/)
  })
})
