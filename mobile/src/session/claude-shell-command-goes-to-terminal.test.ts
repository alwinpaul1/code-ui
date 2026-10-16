import { describe, expect, it, vi } from 'vitest'
import { claudeComposerSend, claudeComposerSendGoes } from './claude-composer-send-route'
import { nativeChatComposerSend } from './native-chat-send-route'

/**
 * 2026-10-16, a Claude tab on the Anthropic lane: the phone asked "Run on the desktop? This
 * message starts with !, so it runs as a shell command…", the user tapped Run, and nothing ran.
 * The send posted `! node "…"` to Anthropic as a plain user event, which Claude Code takes as a
 * prompt for the model; while Claude worked it waited in the phone's local queue as text, and came
 * back to the composer joined to the draft by a blank line. Only a `!` typed into the EMPTY
 * terminal input enters bash mode (mobile-native-chat-shell-command.ts), and whether Claude Code
 * runs a `!` that arrives over Remote Control is unverified, as it is for a slash command. So a
 * confirmed shell command goes the terminal way, which is what the question says will happen.
 */

function sends() {
  return { anthropic: vi.fn(async (_text: string) => true), terminal: vi.fn(async (_text: string) => true) }
}

describe('a `!` shell command on a Claude tab that sends through Anthropic', () => {
  it('is typed into the terminal, where it runs, instead of posted to Anthropic as a prompt', async () => {
    const { anthropic, terminal } = sends()
    const send = claudeComposerSend(anthropic, terminal, () => 0)
    await send('! node "/private/tmp/x/p19-dictation-cleanup.cjs"')
    await send('!ls -la')
    expect(anthropic).not.toHaveBeenCalled()
    expect(terminal.mock.calls.map((call) => call[0])).toEqual(['! node "/private/tmp/x/p19-dictation-cleanup.cjs"', '!ls -la'])
  })

  it('says terminal for the share sheet and every other caller of the route', () => {
    expect(claudeComposerSendGoes('!ls')).toBe('terminal')
    expect(claudeComposerSendGoes('! node x.cjs')).toBe('terminal')
  })

  it('still posts words that only contain a `!`, or start with a space before it, to Anthropic', async () => {
    const { anthropic, terminal } = sends()
    const send = claudeComposerSend(anthropic, terminal, () => 0)
    await send('ship it!')
    await send(' !not a command')
    expect(terminal).not.toHaveBeenCalled()
    expect(anthropic.mock.calls.map((call) => call[0])).toEqual(['ship it!', ' !not a command'])
  })

  it('goes the terminal way when the tab sends its attachments through Anthropic too', async () => {
    const sendAnthropic = vi.fn(async (_text: string) => true)
    const sendNativeChat = vi.fn(async (_text: string) => true)
    const send = nativeChatComposerSend({ nativeChatAnthropicAttachments: {} }, { sendAnthropic, sendNativeChat, attachments: [] })
    await send('!ls')
    expect(sendAnthropic).not.toHaveBeenCalled()
    expect(sendNativeChat).toHaveBeenCalledExactlyOnceWith('!ls')
  })
})
