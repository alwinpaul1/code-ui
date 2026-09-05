import { beforeEach, describe, expect, it } from 'vitest'
import type { CodexPickerIo } from './codex-picker-apply'
import {
  peekCodexVisibleModels,
  resetCodexVisibleModelsForTests,
  scrapeCodexVisibleModels,
  subscribeCodexVisibleModels
} from './codex-visible-models'

const IDLE = ['• ok', '› Ask Codex to do anything', '  gpt-5.6-sol xhigh · ~/Project']
const PICKER = [
  '  Select Model and Effort',
  '  1. gpt-6-astra (default)  Our most capable model for complex, demanding work.',
  '› 2. gpt-5.6-sol (current)  Reliable agentic workhorse for everyday tasks.',
  '  3. gpt-5.3-codex-spark    Ultra-fast coding model.',
  '  Press enter to confirm or esc to go back'
]

/** A scripted terminal: typing /model opens the picker, Esc closes it. */
function fakeIo(): CodexPickerIo & { sent: string[]; typed: string[] } {
  let open = false
  const sent: string[] = []
  const typed: string[] = []
  return {
    sent,
    typed,
    readScreen: async () => (open ? [...IDLE.slice(0, 1), ...PICKER] : IDLE),
    sendKey: async (text) => {
      sent.push(text)
      if (text === '\x1b') {
        open = false
      }
      return true
    },
    typeCommand: async (command) => {
      typed.push(command)
      open = command === '/model'
      return true
    },
    sleep: async () => {},
    now: () => Date.now()
  }
}

describe('scrapeCodexVisibleModels', () => {
  beforeEach(() => resetCodexVisibleModelsForTests())

  it('opens the picker, reads the visible rows, escapes, caches, and notifies', async () => {
    const io = fakeIo()
    let notified = 0
    const unsubscribe = subscribeCodexVisibleModels(() => {
      notified += 1
    })
    const models = await scrapeCodexVisibleModels(io, 'h\0w')
    unsubscribe()
    expect(models?.map((model) => model.slug)).toEqual([
      'gpt-6-astra',
      'gpt-5.6-sol',
      'gpt-5.3-codex-spark'
    ])
    expect(models?.[0]?.isDefault).toBe(true)
    expect(models?.[1]?.isCurrent).toBe(true)
    expect(io.typed).toEqual(['/model'])
    expect(io.sent).toContain('\x1b')
    expect(peekCodexVisibleModels('h\0w')?.length).toBe(3)
    expect(notified).toBe(1)
  })

  it('does nothing while a turn is running', async () => {
    const io = fakeIo()
    io.readScreen = async () => ['› 3', '• Working (1s • esc to interrupt)']
    expect(await scrapeCodexVisibleModels(io, 'h\0w')).toBeNull()
    expect(io.typed).toEqual([])
  })
})
