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

  it('draws no diff pill of Orca’s numbers: the user removed that one on 2026-10-12', () => {
    const row = code('MobileSessionPillRow.tsx') + code('session-pill-row-model.ts')
    expect(row).not.toMatch(/useSessionDiffTotals|sessionDiffTotals|Open diff/)
  })

  it('draws a Diff pill only from Anthropic’s answer for the session, never from the Orca-fed builder', () => {
    // 2026-10-15: the user asked for the Claude app's Diff pill back, its numbers from the same
    // source as the app's. Orca's guess stays out: buildSessionPills never makes one.
    const model = code('session-pill-row-model.ts')
    const orcaBuilder = model.slice(model.indexOf('export function buildSessionPills'), model.indexOf('export function sessionPillActions'))
    expect(orcaBuilder).not.toMatch(/kind: 'diff'/)
    const claudeBuilder = model.slice(model.indexOf('export function buildClaudeSessionPills'))
    expect(claudeBuilder).toMatch(/kind: 'diff'/)
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
