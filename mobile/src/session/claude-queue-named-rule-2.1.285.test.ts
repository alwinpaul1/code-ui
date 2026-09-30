import { describe, expect, it } from 'vitest'
import { codexQueuedMessagesFromScreen } from './codex-terminal-queued-messages'
import {
  NAMED_RULES,
  QUEUED_ROW_TEXT,
  queuedScreen2_1_285,
  takenScreen2_1_285
} from './fixtures/claude-queued-named-rule-2.1.285'
import { claudeQueueViewFromScreen, queuedMessagesFromScreen } from './mobile-terminal-queued-messages'

// Claude Code 2.1.285 (reported 2026-09-30). The fixture's provenance, and what
// only a live capture can settle, are in the fixture file.
describe('Claude Code 2.1.285 queue under a named prompt rule', () => {
  it('keeps a queued message queued when the rule under the spinner carries the session name, as captured from a live 2.1.285 tab', () => {
    expect(queuedMessagesFromScreen(queuedScreen2_1_285(NAMED_RULES.captured1152))).toEqual([QUEUED_ROW_TEXT])
  })

  it('reads the same with the blank rows a real terminal has and Orca drops', () => {
    const screen = queuedScreen2_1_285(NAMED_RULES.captured1152)
    const spinner = screen.findIndex((line) => line.startsWith('*'))
    const withBlanks = [...screen.slice(0, spinner), '', screen[spinner]!, '', ...screen.slice(spinner + 1)]
    expect(queuedMessagesFromScreen(withBlanks)).toEqual([QUEUED_ROW_TEXT])
  })

  it('is not a selection: the view reads the entry with nothing marked', () => {
    const view = claudeQueueViewFromScreen(queuedScreen2_1_285(NAMED_RULES.captured1152))
    expect(view.entries).toEqual([QUEUED_ROW_TEXT])
    expect(view.selecting).toBe(false)
  })

  it('still reads the unnamed rule 2.1.284 and older draw', () => {
    expect(queuedMessagesFromScreen(queuedScreen2_1_285(NAMED_RULES.bare))).toEqual([QUEUED_ROW_TEXT])
  })

  it('drops the row once Claude takes the message (no send-now row, no placeholder)', () => {
    for (const rule of Object.values(NAMED_RULES)) {
      expect(queuedMessagesFromScreen(takenScreen2_1_285(rule))).toEqual([])
    }
  })

  it('refuses when the send-now row has no marked row above it', () => {
    const screen = queuedScreen2_1_285(NAMED_RULES.captured1152).filter((line) => !line.startsWith('❯ Can'))
    expect(queuedMessagesFromScreen(screen)).toEqual([])
  })

  it('does not treat a row of text that merely starts with rule glyphs as a rule', () => {
    const screen = queuedScreen2_1_285('──── and then some words')
    expect(queuedMessagesFromScreen(screen)).toEqual([])
  })

  it('reads an empty screen and a lone queue row without throwing', () => {
    expect(queuedMessagesFromScreen([])).toEqual([])
    expect(queuedMessagesFromScreen(['❯ Press up to edit queued messages'])).toEqual([])
  })

  it('leaves Codex alone: it has its own reader and this screen is no Codex queue', () => {
    expect(codexQueuedMessagesFromScreen(queuedScreen2_1_285(NAMED_RULES.captured1152))).toEqual([])
  })
})
