// The cost of reading a joined dequeue between a mid-turn copy and a later
// row of its words (joinedLineBetween, desk-prompt-row-owners.ts), on the
// render path: the review of 4409aa51 (P1) measured the run-of-lines scan at
// 1.3 s a call for a 200-line paste between them.
import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'
import { withoutLandedDesktopPrompts } from './use-desktop-prompt-echoes'

const T0 = Date.parse('2026-09-29T05:00:00Z')
const row = (id: string, role: 'user' | 'assistant', text: string, at: number): NativeChatMessage => ({ id, role, blocks: [{ type: 'text', text }], timestamp: at, source: 'transcript' })

describe('a long paste between a mid-turn message and a later prompt of its words', () => {
  // "continue" typed mid-turn, a 200-line paste typed idle (its hook copy cut
  // at 2,000 bytes, so it owns no row), and "continue" typed again.
  it('is read in a few milliseconds, and keeps the mid-turn copy', () => {
    const paste = Array.from({ length: 200 }, (_, index) => `${String(index).padStart(4, '0')} ${'log output of a failing build step '.repeat(8)}`.slice(0, 160)).join('\n')
    const raw = [
      row('a1', 'assistant', 'words before the mid-turn message', T0),
      row('a2', 'assistant', 'the reply that ends the turn', T0 + 60_000),
      row('p3', 'user', paste, T0 + 120_000),
      row('a4', 'assistant', 'the reply to the paste', T0 + 180_000),
      row('u5', 'user', 'continue', T0 + 240_000),
      row('a6', 'assistant', 'the reply to continue', T0 + 300_000)
    ]
    const prompts: DesktopPrompt[] = [
      { nonce: '91001', text: 'continue', cut: false, anchorId: 'a1', seenAt: T0 + 30_000 },
      { nonce: '91002', text: 'continue', cut: false, anchorId: 'a4', seenAt: T0 + 240_000 },
      { nonce: '91003', text: new TextDecoder().decode(new TextEncoder().encode(paste).slice(0, 2000)), cut: true, anchorId: 'a2', seenAt: T0 + 120_000 }
    ]
    withoutLandedDesktopPrompts(prompts, raw, [], raw)
    const started = performance.now()
    let kept: DesktopPrompt[] = []
    for (let run = 0; run < 5; run += 1) {
      kept = withoutLandedDesktopPrompts(prompts, raw, [], raw)
    }
    expect(kept.map((prompt) => prompt.nonce)).toContain('91001')
    expect((performance.now() - started) / 5).toBeLessThan(50)
  })
})
