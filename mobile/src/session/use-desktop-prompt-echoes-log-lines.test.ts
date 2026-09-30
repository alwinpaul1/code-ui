import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { DesktopPrompt } from './agent-hud-beacon'
import { useDesktopPromptEchoes } from './use-desktop-prompt-echoes'

// Review of 2026-09-30: the two [desk-prompt] lines quoted a message by
// `text.slice(0, 32)`, which counts UTF-16 code units, so an emoji across
// the 32nd left its first half in the log: a lone surrogate, drawn as a
// replacement box wherever the line is read.
const row = (id: string, timestamp: number): NativeChatMessage => ({
  id,
  role: 'assistant',
  blocks: [{ type: 'text', text: 'reply' }],
  timestamp,
  source: 'transcript'
})
const LONE_HIGH_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/
const straddling = 'x'.repeat(31) + '\u{1F600} and the rest'

function Probe({ prompts, raw }: { prompts: readonly DesktopPrompt[]; raw: readonly NativeChatMessage[] }) {
  useDesktopPromptEchoes(prompts, raw, raw)
  return null
}

describe('the desk-prompt log lines quote a message by whole characters', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.restoreAllMocks()
  })

  function linesFor(prompts: DesktopPrompt[], readings: number): string[] {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const raw = [row('m1', 1000)]
    act(() => {
      renderer = create(createElement(Probe, { prompts, raw }))
    })
    for (let reading = 0; reading < readings; reading += 1) {
      act(() => {
        renderer!.update(createElement(Probe, { prompts, raw }))
      })
    }
    return warn.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith('[desk-prompt]'))
  }

  it('keeps an emoji across the cut whole when a copy is drawn where it was first seen', () => {
    const lines = linesFor([{ nonce: 'log-emoji-1', text: straddling, anchorId: 'never', seenAt: Date.now() }], 40)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(`"${'x'.repeat(31)}…"`)
    expect(lines[0]).not.toMatch(LONE_HIGH_SURROGATE)
  })

  it('keeps an emoji across the cut whole when a copy is not drawn at all', () => {
    const longAgo = Date.now() - 11 * 60_000
    const lines = linesFor([{ nonce: 'log-emoji-2', text: straddling, anchorId: 'never', seenAt: longAgo }], 1)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(`"${'x'.repeat(31)}…"`)
    expect(lines[0]).not.toMatch(LONE_HIGH_SURROGATE)
  })

  it('quotes a message of 32 units, or of one emoji, whole and with no ellipsis', () => {
    const longAgo = Date.now() - 11 * 60_000
    for (const [nonce, text] of [
      ['log-emoji-3', 'y'.repeat(30) + '\u{1F600}'],
      ['log-emoji-4', '\u{1F600}']
    ]) {
      const lines = linesFor([{ nonce: nonce!, text: text!, anchorId: 'never', seenAt: longAgo }], 1)
      expect(lines[0]).toContain(`"${text}"`)
      vi.restoreAllMocks()
      act(() => renderer?.unmount())
      renderer = null
    }
  })
})
