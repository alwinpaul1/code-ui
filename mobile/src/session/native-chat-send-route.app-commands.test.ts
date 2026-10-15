import { describe, expect, it, vi } from 'vitest'
import { nativeChatComposerSend } from './native-chat-send-route'

// The composer's Send on a Claude tab matched to its Anthropic session: the Claude app's own
// `/model`, `/diff` and `/workflows` open a phone sheet (iu7.a, ay8.java:8650) before anything is
// posted or typed, so a typed `/model` never reaches Claude Code's terminal picker.

function lanes() {
  const anthropic = vi.fn(async () => true)
  const terminal = vi.fn(async () => true)
  const sendAnthropic = vi.fn(async () => true)
  return { anthropic, terminal, sendAnthropic }
}

describe('the app’s own commands at the composer’s Send', () => {
  it('opens the sheet and sends nothing, through either lane', async () => {
    const { anthropic, terminal, sendAnthropic } = lanes()
    const appCommand = vi.fn((text: string) => text.trim() === '/model')
    const send = nativeChatComposerSend({ nativeChatAnthropicSend: anthropic, nativeChatAppCommand: appCommand }, { sendNativeChat: terminal, sendAnthropic, attachments: [] })
    await expect(send('/model')).resolves.toBe(true)
    expect(appCommand).toHaveBeenCalledWith('/model')
    expect(anthropic).not.toHaveBeenCalled()
    expect(terminal).not.toHaveBeenCalled()
  })

  it('sends anything that is not one as before', async () => {
    const { anthropic, terminal, sendAnthropic } = lanes()
    const send = nativeChatComposerSend({ nativeChatAnthropicSend: anthropic, nativeChatAppCommand: () => false }, { sendNativeChat: terminal, sendAnthropic, attachments: [] })
    await send('fix the tests')
    await send('/compact')
    expect(anthropic).toHaveBeenCalledWith('fix the tests')
    expect(terminal).toHaveBeenCalledWith('/compact')
  })

  it('never takes a send that carries a chip: the file goes with the words', async () => {
    const { anthropic, terminal, sendAnthropic } = lanes()
    const appCommand = vi.fn(() => true)
    const send = nativeChatComposerSend({ nativeChatAnthropicSend: anthropic, nativeChatAppCommand: appCommand }, { sendNativeChat: terminal, sendAnthropic, attachments: [{}] })
    await send('/model')
    expect(appCommand).not.toHaveBeenCalled()
    expect(terminal).toHaveBeenCalledWith('/model')
  })

  it('keeps one function per pair of sends, so the composer’s onSend keeps its identity', () => {
    const { anthropic, terminal, sendAnthropic } = lanes()
    const appCommand = () => false
    const images = { sendNativeChat: terminal, sendAnthropic, attachments: [] }
    const first = nativeChatComposerSend({ nativeChatAnthropicSend: anthropic, nativeChatAppCommand: appCommand }, images)
    expect(nativeChatComposerSend({ nativeChatAnthropicSend: anthropic, nativeChatAppCommand: appCommand }, images)).toBe(first)
  })

  it('leaves a tab with no app commands (Codex, every other agent) on its own send', () => {
    const { terminal, sendAnthropic } = lanes()
    expect(nativeChatComposerSend({}, { sendNativeChat: terminal, sendAnthropic, attachments: [] })).toBe(terminal)
  })
})
