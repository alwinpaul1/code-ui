import { describe, expect, it, vi } from 'vitest'
import { isCodexIdle, isCodexWorking } from './codex-picker-screen'
import { submitInput, type QueueScreen } from './native-queue-input'

// A running Codex turn with messages waiting under its working row read as
// idle once the waiting rows pushed "esc to interrupt" out of the last six
// rows of the screen. Then the queue editor sent a bare Enter, which steers
// the message into the running turn instead of queueing it, and the model
// reader opened `/model` over a live turn.
//
// These screens are COMPOSED, not captured: the order and the row shapes come
// from Codex's own source at the tag this repo targets, rust-v0.153.4.
//   codex-rs/tui/src/bottom_pane/mod.rs, `as_renderable_with_composer_right_reserve`:
//     the status indicator, a blank row, pending thread approvals, the pending
//     input preview, then the composer (which lays its footer out under the
//     textarea, chat_composer.rs `layout_areas_with_textarea_right_reserve`).
//   codex-rs/tui/src/status_indicator_widget.rs: "<spinner> Working (12s • esc to interrupt)".
//   codex-rs/tui/src/bottom_pane/pending_input_preview.rs: "• " section headers
//     wrapped under a two-space indent, "  ↳ " entries wrapped under four
//     spaces and cut to three lines plus "    …", a blank row between groups,
//     and "    <binding> edit last queued message" under queued follow-ups only.
// The preview's own row text is the shapes already pinned from real screens in
// codex-terminal-queued-messages.test.ts. Orca 1.4.212 drops blank rows from
// `terminal.read --screen` (mobile-terminal-queue-block.ts), so the screens
// below have none unless a test says it keeps them.

const WORKING = '• Working (12s • esc to interrupt)'
const PLACEHOLDER = '› Ask Codex to do anything'
const FOOTER = '  gpt-5.6-sol xhigh · ~/Project'
const TRANSCRIPT = ['› run the tests', '• Ran npm test', '  └ 312 passed']

const runningTurn = (...waiting: string[]) => [
  ...TRANSCRIPT,
  WORKING,
  ...waiting,
  PLACEHOLDER,
  FOOTER
]

const expectRunning = (lines: string[]) => {
  expect(isCodexWorking(lines)).toBe(true)
  expect(isCodexIdle(lines)).toBe(false)
}

describe('a running Codex turn with messages waiting under its working row', () => {
  it('reads working, not idle, with two queued follow-ups', () => {
    expectRunning([
      WORKING,
      '• Queued follow-up inputs',
      '  ↳ first follow-up',
      '  ↳ second follow-up',
      '    ⌥ + ↑ edit last queued message',
      PLACEHOLDER,
      FOOTER
    ])
  })

  it('reads working, not idle, with three queued follow-ups', () => {
    expectRunning(
      runningTurn(
        '• Queued follow-up inputs',
        '  ↳ first follow-up',
        '  ↳ second follow-up',
        '  ↳ third follow-up',
        '    alt + ↑ edit last queued message'
      )
    )
  })

  it('reads working, not idle, when one queued follow-up wraps and is cut to three lines', () => {
    expectRunning(
      runningTurn(
        '• Queued follow-up inputs',
        '  ↳ long queued message',
        '    second line',
        '    third line',
        '    …',
        '    alt + ↑ edit last queued message'
      )
    )
  })

  it('reads working, not idle, when a narrow terminal wraps the steer header', () => {
    expectRunning(
      runningTurn(
        '• Messages to be submitted after',
        '  next tool call (press esc to',
        '  interrupt and send immediately)',
        '  ↳ wait for the next result'
      )
    )
  })

  it.each([
    ['as Orca reads it, blank rows dropped', false],
    ['with the blank separators Codex paints', true]
  ])(
    'reads working, not idle, with a steer, a retry and a follow-up all waiting, %s',
    (_, blanks) => {
      const gap = blanks ? [''] : []
      expectRunning([
        ...TRANSCRIPT,
        WORKING,
        ...gap,
        '• Messages to be submitted after next tool call (press esc',
        '  to interrupt and send immediately)',
        '  ↳ steer from phone',
        ...gap,
        '• Messages to be submitted at end of turn',
        '  ↳ retry this',
        ...gap,
        '• Queued follow-up inputs',
        '  ↳ follow-up from desktop',
        '    alt + ↑ edit last queued message',
        ...gap,
        PLACEHOLDER,
        ...gap,
        ...gap,
        FOOTER
      ])
    }
  )

  it('keeps a status detail row under the working row in view', () => {
    expectRunning([
      ...TRANSCRIPT,
      WORKING,
      '  └ Waiting for background terminal',
      '• Queued follow-up inputs',
      '  ↳ first follow-up',
      '  ↳ second follow-up',
      '    alt + ↑ edit last queued message',
      '› a draft of my own',
      FOOTER
    ])
  })
})

// The steer header says "(press esc to interrupt and send immediately)". It is
// counted deliberately, by its shape and not by that phrase: Codex makes a
// pending steer only while a turn runs (chatwidget/input_submission.rs at
// rust-v0.153.4: `pending_steer` is set when `agent_turn_running`), and it
// hides the working row while an answer streams (chatwidget/streaming.rs,
// `run_commit_tick_with_scope`). So a live steer group is the
// one sign of a running turn left on screen then, whether or not the header
// wrapped the phrase across two rows. Reading "working" there costs a model
// read that waits; reading "idle" sends Esc or `/model` into a live turn.
describe('the steer header', () => {
  it.each([
    [
      'on one row',
      [
        '• Messages to be submitted after next tool call (press esc to interrupt and send immediately)'
      ]
    ],
    [
      'wrapped',
      [
        '• Messages to be submitted after next tool call (press esc',
        '  to interrupt and send immediately)'
      ]
    ]
  ])(
    'reads a live steer group as a running turn while streaming hides the working row, %s',
    (_, header) => {
      expectRunning([
        ...TRANSCRIPT,
        '• Streaming the answer so far',
        '  and its second line',
        ...header,
        '  ↳ steer from phone',
        PLACEHOLDER,
        FOOTER
      ])
    }
  )

  it('does not count the header quoted in the transcript, above the live rows', () => {
    const lines = [
      '• The preview draws this header:',
      '  • Messages to be submitted after next tool call (press esc to interrupt and send immediately)',
      '  ↳ an example entry',
      '• Ran npm test',
      '  └ 312 passed',
      '• Tests pass.',
      '• Nothing else to do.',
      PLACEHOLDER,
      FOOTER
    ]
    expect(isCodexWorking(lines)).toBe(false)
    expect(isCodexIdle(lines)).toBe(true)
  })
})

describe('screens that must keep their old reading', () => {
  it('still reads an idle prompt with nothing queued as idle', () => {
    const lines = [...TRANSCRIPT, '• All 312 tests pass.', PLACEHOLDER, FOOTER]
    expect(isCodexWorking(lines)).toBe(false)
    expect(isCodexIdle(lines)).toBe(true)
  })

  it('does not make a turn out of a queue box with no working row above it', () => {
    const lines = [
      ...TRANSCRIPT,
      '• All 312 tests pass.',
      '• Queued follow-up inputs',
      '  ↳ first follow-up',
      '  ↳ second follow-up',
      '    alt + ↑ edit last queued message',
      PLACEHOLDER,
      FOOTER
    ]
    expect(isCodexWorking(lines)).toBe(false)
    expect(isCodexIdle(lines)).toBe(true)
  })

  it('does not read the model picker as idle', () => {
    const lines = [
      '  Select Model and Effort',
      '  1. gpt-6-astra (default)  Our most capable model for complex work.',
      '› 2. gpt-5.6-sol (current)  Reliable agentic workhorse for everyday tasks.',
      '  Press enter to confirm or esc to go back'
    ]
    expect(isCodexIdle(lines)).toBe(false)
    expect(isCodexWorking(lines)).toBe(false)
  })

  it('reads neither from an empty screen', () => {
    expect(isCodexWorking([])).toBe(false)
    expect(isCodexIdle([])).toBe(false)
  })

  it('reads a one-row screen by that row alone', () => {
    expect(isCodexWorking([WORKING])).toBe(true)
    expect(isCodexIdle([WORKING])).toBe(false)
    expect(isCodexWorking(['• Queued follow-up inputs'])).toBe(false)
    expect(isCodexIdle(['• Queued follow-up inputs'])).toBe(false)
    expect(isCodexWorking([''])).toBe(false)
    expect(isCodexIdle([''])).toBe(false)
  })
})

it('does not steer an edited message into a running turn with two messages queued', async () => {
  // Tab queues; the queue editor falls back to a bare Enter only when the Tab
  // has not moved the draft after two polls AND no turn is running, because
  // Enter on a running Codex turn steers the message into it.
  const lines = runningTurn(
    '• Queued follow-up inputs',
    '  ↳ first follow-up',
    '  ↳ second follow-up',
    '    ⌥ + ↑ edit last queued message'
  )
  lines[lines.length - 2] = '› edited text'
  const read = async (): Promise<QueueScreen> => ({ source: 'screen', draft: 'edited text', lines })
  const write = vi.fn(async (_text: string, _idleOnly?: boolean) => {})
  await expect(
    submitInput({ read, write, pause: async () => {} }, 'codex', 'edited text', true)
  ).rejects.toThrow('remains in its input, unsent')
  expect(write.mock.calls).toEqual([['\t']])
})
