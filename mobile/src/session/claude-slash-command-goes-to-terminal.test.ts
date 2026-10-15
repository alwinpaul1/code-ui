import { describe, expect, it, vi } from 'vitest'
import { claudeComposerSend } from './claude-composer-send-route'

/**
 * A Claude tab on the Anthropic lane posted a typed slash command ("/compact") to Anthropic as a
 * plain user message, or queued it as text while Claude worked. Whether Claude Code runs a slash
 * command that arrives over Remote Control is unverified (docs/claude-app-parity-gaps.md §1.4), so
 * until it is proven a typed command goes the way it went before the lane: the terminal path,
 * which classifies it (classifyMobileNativeChatSend) and types it as a command.
 */

function sends(): { anthropic: ReturnType<typeof vi.fn>; terminal: ReturnType<typeof vi.fn> } {
  return { anthropic: vi.fn(async (_text: string) => true), terminal: vi.fn(async (_text: string) => true) }
}

describe('the composer send of a Claude tab on the Anthropic lane', () => {
  it('types a slash command into the terminal instead of posting it to Anthropic', async () => {
    const { anthropic, terminal } = sends()
    const send = claudeComposerSend(anthropic, terminal, 0)
    await send('/compact')
    await send('/model opus')
    expect(anthropic).not.toHaveBeenCalled()
    expect(terminal.mock.calls.map((call) => call[0])).toEqual(['/compact', '/model opus'])
  })

  it('sends an unknown slash token the terminal way too, never as Anthropic text', async () => {
    const { anthropic, terminal } = sends()
    await claudeComposerSend(anthropic, terminal, 0)('/not-a-real-command now')
    expect(anthropic).not.toHaveBeenCalled()
    expect(terminal).toHaveBeenCalledWith('/not-a-real-command now')
  })

  it('posts ordinary words, a path, and a slash mid-sentence to Anthropic', async () => {
    const { anthropic, terminal } = sends()
    const send = claudeComposerSend(anthropic, terminal, 0)
    await send('run the tests')
    await send('look at src/app.ts')
    await send('use /compact later')
    expect(terminal).not.toHaveBeenCalled()
    expect(anthropic.mock.calls.map((call) => call[0])).toEqual(['run the tests', 'look at src/app.ts', 'use /compact later'])
  })

  it('keeps the terminal send with attachments in the composer or with no Anthropic lane', () => {
    const { anthropic, terminal } = sends()
    expect(claudeComposerSend(anthropic, terminal, 1)).toBe(terminal)
    expect(claudeComposerSend(undefined, terminal, 0)).toBe(terminal)
  })

  it('hands the composer the same function for the same pair, render after render', () => {
    const { anthropic, terminal } = sends()
    expect(claudeComposerSend(anthropic, terminal, 0)).toBe(claudeComposerSend(anthropic, terminal, 0))
  })
})
