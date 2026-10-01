import { describe, expect, it } from 'vitest'
import { claudeSubmitNotice, readClaudeInput } from './claude-composer-screen'
import {
  AFTER_REVIEW_NOTICE,
  composerWithTextInDraft,
  composerWithTextInRows,
  EMPTY_COMPOSER,
  INCIDENT_MESSAGE,
  REVIEW_NOTICE
} from './fixtures/claude-composer-2.1.287'
import { NAMED_RULES, queuedScreen2_1_285 } from './fixtures/claude-queued-named-rule-2.1.285'

// Shapes: Claude Code 2.1.287, transcribed from Orca's history log of the
// 2026-10-01 incident (fixtures/claude-composer-2.1.287.ts says what is
// transcribed and what is modelled).

describe("reading the text in Claude Code's input box", () => {
  it('has the message the report had, 176 characters', () => {
    expect(INCIDENT_MESSAGE).toHaveLength(176)
  })

  it('reads an empty input as empty, a bare prompt row between two rules', () => {
    expect(readClaudeInput(EMPTY_COMPOSER, '')).toEqual({ located: true, text: '', rows: 1 })
  })

  it('reads the text drawn in the rows, and counts the rows it wraps onto', () => {
    const read = readClaudeInput(composerWithTextInRows(INCIDENT_MESSAGE, 90), '')
    expect(read).toMatchObject({ located: true, rows: 2 })
    expect(read.located && read.text.replace(/\n/g, '')).toBe(INCIDENT_MESSAGE)
  })

  it('reads the text Orca published as the draft when the row is a bare prompt', () => {
    const read = readClaudeInput(composerWithTextInDraft(), INCIDENT_MESSAGE)
    expect(read).toMatchObject({ located: true, text: INCIDENT_MESSAGE })
    // 176 characters across a 190-column box: the screen's own width, not 20 columns.
    expect(read.located && read.rows).toBe(1)
  })

  it('does not call a bare prompt row with text under it empty (the state after the review notice)', () => {
    // The bare `❯` and the wrapped rows under it: Claude's input holds text.
    const read = readClaudeInput(AFTER_REVIEW_NOTICE, '')
    expect(read).toMatchObject({ located: true, rows: 2 })
    expect(read.located && read.text).toBe(INCIDENT_MESSAGE)
  })

  it('reads an empty input under a rule that carries the session name', () => {
    const lines = queuedScreen2_1_285(NAMED_RULES.captured1152)
    // The placeholder Claude paints under a queue is not text.
    expect(readClaudeInput(lines, '')).toEqual({ located: true, text: '', rows: 1 })
  })

  it('does not take the queue hint, in the rows or as the draft, for text', () => {
    for (const hint of [
      'Press up to edit queued messages',
      'Press up to select a queued message to edit, or Enter to send them now',
      'Press Enter to edit the selected message, or up again for an older one'
    ]) {
      const inRows = [...EMPTY_COMPOSER]
      inRows[inRows.findIndex((row) => row.startsWith('❯'))] = `❯ ${hint}`
      expect(readClaudeInput(inRows, '')).toMatchObject({ located: true, text: '' })
      expect(readClaudeInput(composerWithTextInDraft(), hint)).toMatchObject({
        located: true,
        text: ''
      })
    }
  })

  it('finds no composer where a dialog stands in its place, and says nothing of the input', () => {
    const dialog = [
      '⏺ Bash(rm -rf build)',
      '  Do you want to proceed?',
      '❯ 1. Yes',
      '  2. No',
      '  Esc to cancel'
    ]
    expect(readClaudeInput(dialog, '')).toEqual({ located: false })
  })

  it('is not taken in by a sent prompt in the conversation, or a quoted prompt row', () => {
    const lines = ['❯ an earlier prompt that the user sent', '⏺ Done.', ...EMPTY_COMPOSER]
    expect(readClaudeInput(lines, '')).toEqual({ located: true, text: '', rows: 1 })
    // Only the sent prompt, no box: nothing located.
    expect(readClaudeInput(['❯ an earlier prompt', '⏺ Done.'], '')).toEqual({ located: false })
  })

  it('finds nothing on an empty or one-row screen', () => {
    expect(readClaudeInput([], '')).toEqual({ located: false })
    expect(readClaudeInput(['❯'], '')).toEqual({ located: false })
  })

  it('counts a single character as one row', () => {
    expect(readClaudeInput(composerWithTextInRows('y'), '')).toEqual({
      located: true,
      text: 'y',
      rows: 1
    })
  })
})

describe("reading Claude Code's review notice", () => {
  it('reads the notice painted at column 129 above the box', () => {
    expect(claudeSubmitNotice(AFTER_REVIEW_NOTICE)).toBe(REVIEW_NOTICE)
  })

  it('does not pin the key name or the plural', () => {
    for (const notice of [
      'Removed 1 invisible character · review and press Enter to send',
      'Removed 12 invisible characters · review and press Return to send'
    ]) {
      const lines = [...AFTER_REVIEW_NOTICE]
      lines[lines.findIndex((row) => row.includes('Removed'))] = `${' '.repeat(40)}${notice}`
      expect(claudeSubmitNotice(lines)).toBe(notice)
    }
  })

  it('does not take the notice quoted in the conversation, or one far above the box', () => {
    const quoted = [
      '  Claude said: Removed 67 invisible characters · review and press Enter to send',
      ...EMPTY_COMPOSER
    ]
    expect(claudeSubmitNotice(quoted)).toBeNull()
    const far = [REVIEW_NOTICE, 'a', 'b', 'c', 'd', 'e', 'f', ...EMPTY_COMPOSER.slice(2)]
    expect(claudeSubmitNotice(far)).toBeNull()
  })

  it('finds none on a clean screen, with no composer, or on an empty one', () => {
    expect(claudeSubmitNotice(EMPTY_COMPOSER)).toBeNull()
    expect(claudeSubmitNotice([REVIEW_NOTICE])).toBeNull()
    expect(claudeSubmitNotice([])).toBeNull()
  })
})
