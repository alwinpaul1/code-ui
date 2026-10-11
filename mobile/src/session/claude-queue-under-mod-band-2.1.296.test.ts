import { describe, expect, it } from 'vitest'
import { queueBoxReadFromScreen } from './mobile-terminal-queue-read'
import {
  CLAUDE_ONE_QUEUED_2_1_296,
  CLAUDE_QUEUED_TEXT,
  CLAUDE_TWO_QUEUED_2_1_296,
  CLAUDE_TWO_QUEUED_TEXTS
} from './fixtures/queued-tap-recall-2.1.296-0.153.4'

// Found 2026-10-11 capturing the screens for tap-to-edit (Claude Code 2.1.296,
// tmux capture-pane, the user's own setup): a mod paints its band in the slot
// over the input box, under Claude's right-aligned `[-]` toggle, so the slot
// sits between the queue's send-now row and the box's top rule. The reader
// allowed only rules and the spinner there, refused the box, and the phone saw
// no queue at all: no queue box, no pencil, and a queued message drawn as sent.
// The slot is skipped only when its own toggle row bounds it; any other row
// there still refuses (mobile-terminal-hud-context-rows.ts reads the band).

const PLACEHOLDER = 'Press up to edit queued messages'

describe('the queue box over a mod band above the input box', () => {
  it('reads one queued message over the band', () => {
    const read = queueBoxReadFromScreen(CLAUDE_ONE_QUEUED_2_1_296, 'claude', PLACEHOLDER)
    expect(read.readable).toBe(true)
    expect(read.entries).toEqual([CLAUDE_QUEUED_TEXT])
  })

  it('reads two queued messages over the band, oldest first', () => {
    const read = queueBoxReadFromScreen(CLAUDE_TWO_QUEUED_2_1_296, 'claude', PLACEHOLDER)
    expect(read.readable).toBe(true)
    expect(read.entries).toEqual([...CLAUDE_TWO_QUEUED_TEXTS])
  })

  it('still refuses a row between the send-now row and the box with no toggle above it', () => {
    const screen = CLAUDE_ONE_QUEUED_2_1_296.filter((line) => !/^\s+\[-\]$/.test(line))
    expect(queueBoxReadFromScreen(screen, 'claude', PLACEHOLDER).readable).toBe(false)
  })
})
