import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Which module mounts what is a defect of structure, so these read the code (CLAUDE.md rule 6),
// comments stripped: the long "why" notes in these files would otherwise satisfy every match.
function code(file: string): string {
  return readFileSync(path.join(import.meta.dirname, file), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line))
    .join('\n')
}

describe('where the session pills are mounted', () => {
  it('the route builds them and hands them to the chat overlay, with the controller it already holds', () => {
    expect(code('MobileSessionActiveContent.tsx')).toMatch(
      /<MobileNativeChatOverlay[\s\S]*?sessionPills=\{<MobileSessionPillRow controller=\{controller\} \/>\}[\s\S]*?\/>/
    )
  })

  it('the overlay forwards the slot to the chat view untouched', () => {
    const overlay = code('MobileNativeChatOverlay.tsx')
    expect(overlay).toMatch(/sessionPills=\{sessionPills\}/)
    expect(overlay).not.toMatch(/MobileSessionPillRow/)
  })

  it('the pill row is not mounted by the session bar, which is the todo pill’s alone', () => {
    expect(code('MobileNativeChatSessionBar.tsx')).not.toMatch(/MobileSessionPillRow|sessionPills/)
  })

  it('draws no diff pill beside them: the user removed it on 2026-10-12', () => {
    const row = code('MobileSessionPillRow.tsx') + code('session-pill-row-model.ts')
    expect(row).not.toMatch(/diff-pill|useSessionDiffTotals|sessionDiffTotals|Open diff/)
  })
})

describe('the model sheet the header menu opens', () => {
  const controller = code('use-mobile-native-chat-controller.ts')

  it('is the composer’s own, asked for through a count beside the Codex /model request', () => {
    // A sum of two counters that only ever rise: either one raising it opens the sheet, and
    // neither can leave the other's last value standing in for a new request.
    expect(controller).toMatch(/openRequest: modelSheetRequest \+ headerModelRequests,/)
    expect(controller).toMatch(
      /requestModelSheet: \(\) => setHeaderModelRequests\(\(n\) => n \+ 1\)/
    )
  })
})
