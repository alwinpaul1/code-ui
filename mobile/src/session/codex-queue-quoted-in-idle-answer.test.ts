import { describe, expect, it } from 'vitest'
import { codexQueuedMessagesFromScreen } from './codex-terminal-queued-messages'
import { isCodexWorking } from './codex-picker-screen'

// An idle answer that quotes Codex's pending-input preview read as a queued message that does not
// exist: the chat drew it, and the queue editor read it as part of the queue. Codex draws the
// preview's headers at column 0, directly above its composer (codex-rs/tui/src/bottom_pane/mod.rs,
// pending_input_preview.rs); the busy-row reader already reads them that way (0b2c7a92), and the
// queue reader now does too.
//
// The composer, footer and busy rows are the recorded captures in codex-0158-screens.test.ts:
// Codex 0.158.0 (WORKING, IDLE_AFTER_TURN) and 0.155.1 (WORKING_0155), pasted verbatim. The preview
// rows are the wording codex-terminal-queued-messages.test.ts pins from pending_input_preview.rs;
// no live screen with a queue on it has been captured from 0.158.
const COMPOSER_0158 = [
  '› Ask Codex to do anything',
  '',
  '  GPT-6-Sol medium · ~/orca-lanes/sta8834/corpus/scratch',
  '  ? for shortcuts'
]
const COMPOSER_0155 = [
  '› Ask Codex to do anything',
  '',
  '  gpt-6-sol medium · ~/orca-lanes/sta8834/corpus/scratch · renaming... ⠙'
]
const BUSY_0158 = ['› List the files here and summarize in 2 bullets.', '', '', '• Working (0s • esc to interrupt)', '']
const BUSY_0155 = ['› List the files here and summarize in 2 bullets.', '', '', '• Working (3s • esc to interrupt)', '']

/** The screen the report named: an idle answer quoting the preview, over the 0.158 composer. */
const QUOTED_IN_ANSWER = [
  '› what does the queue preview look like?',
  '• It reads like this:',
  '  • Queued follow-up inputs',
  '    ↳ then run the tests',
  '  The header stays until the turn ends.',
  '› Ask Codex to do anything',
  '  GPT-6-Sol medium · ~/repo',
  '  ? for shortcuts'
]

describe('a Codex answer that quotes the queue preview', () => {
  it('shows no queued message that does not exist', () => {
    expect(codexQueuedMessagesFromScreen(QUOTED_IN_ANSWER)).toEqual([])
  })

  it('shows none under the 0.155 composer either', () => {
    const quoted = [...QUOTED_IN_ANSWER.slice(0, 5), ...COMPOSER_0155]
    expect(codexQueuedMessagesFromScreen(quoted)).toEqual([])
  })

  it('shows none for a quoted steer group, and the quote makes no running turn', () => {
    const quoted = [
      '› what happens to a steer?',
      '• It waits here:',
      '  • Messages to be submitted after next tool call (press esc',
      '    to interrupt and send immediately)',
      '    ↳ steer from phone',
      '  and goes in when the tool returns.',
      ...COMPOSER_0158
    ]
    expect(codexQueuedMessagesFromScreen(quoted)).toEqual([])
    expect(isCodexWorking(quoted)).toBe(false)
  })

  it('shows none for a preview quoted higher up, above other conversation', () => {
    // Column 0 this time, as a pasted screen would be, but not the block above the composer.
    const quoted = [
      '• Queued follow-up inputs',
      '  ↳ then run the tests',
      '',
      '• That was the preview.',
      '',
      ...COMPOSER_0158
    ]
    expect(codexQueuedMessagesFromScreen(quoted)).toEqual([])
  })
})

describe('a live Codex queue above the composer still reads', () => {
  const preview = (entries: string[]) => [
    '• Queued follow-up inputs',
    ...entries.map((entry) => `  ↳ ${entry}`),
    '    ⌥ + ↑ edit last queued message',
    ''
  ]

  it('reads one queued message under a 0.158 running turn', () => {
    expect(codexQueuedMessagesFromScreen([...BUSY_0158, ...preview(['then run the tests']), ...COMPOSER_0158])).toEqual([
      'then run the tests'
    ])
  })

  it('reads two under a 0.155 running turn', () => {
    expect(
      codexQueuedMessagesFromScreen([...BUSY_0155, ...preview(['fix the build', 'then run the tests']), ...COMPOSER_0155])
    ).toEqual(['fix the build', 'then run the tests'])
  })

  it('reads the live queue and not the one an earlier answer quoted', () => {
    const screen = [...QUOTED_IN_ANSWER.slice(0, 5), ...BUSY_0158.slice(3), ...preview(['mobile task']), ...COMPOSER_0158]
    expect(codexQueuedMessagesFromScreen(screen)).toEqual(['mobile task'])
  })

  it('reads every group directly above the composer, a wrapped steer header too', () => {
    const screen = [
      ...BUSY_0158,
      '• Messages to be submitted after next tool call (press esc',
      '  to interrupt and send immediately)',
      '  ↳ steer from phone',
      '',
      '• Messages to be submitted at end of turn',
      '  ↳ retry this',
      '',
      ...preview(['long queued message']),
      ...COMPOSER_0158
    ]
    expect(codexQueuedMessagesFromScreen(screen)).toEqual(['steer from phone', 'retry this', 'long queued message'])
  })

  it('reads an empty queue as empty, idle or running', () => {
    expect(codexQueuedMessagesFromScreen([...BUSY_0158, ...COMPOSER_0158])).toEqual([])
    expect(codexQueuedMessagesFromScreen(COMPOSER_0158)).toEqual([])
    expect(codexQueuedMessagesFromScreen([])).toEqual([])
  })

  it('reads no indented header even with no composer on screen', () => {
    // Codex draws the preview only above its composer, so a screen without one is a pager, a `cat`ed
    // transcript or a fixture cut short. A column-0 preview there still reads (the older fixtures pin
    // that), but an indented one is quoted text wherever it is.
    expect(codexQueuedMessagesFromScreen(QUOTED_IN_ANSWER.slice(0, 5))).toEqual([])
    expect(codexQueuedMessagesFromScreen(preview(['then run the tests']))).toEqual(['then run the tests'])
  })
})
