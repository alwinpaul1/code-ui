import { describe, expect, it } from 'vitest'
import { escapeCodexPicker, type CodexPickerIo } from './codex-picker-apply'
import { isCodexIdle, isCodexWorking } from './codex-picker-screen'

// Review of the merge that joined the Orca 1.4.217 busy-row port with the sweep's steer rule
// (ca774c00, 2026-09-30). Screens are composed from Codex's own source (pending_input_preview.rs
// draws its headers with "• " at column 0; status_indicator_widget.rs wraps a status detail under
// "  └ " then a four-space indent) and the repo's 0.158 capture shapes, as read through
// terminal.read --screen (blank rows dropped by Orca). A live `tmux capture-pane` should replace
// them when one is taken.

const read = (lines: string[]) => ({ working: isCodexWorking(lines), idle: isCodexIdle(lines) })
const IDLE = { working: false, idle: true }
const RUNNING = { working: true, idle: false }

// An idle 0.158 screen whose LAST answer quotes the steer preview (the shape of Orca's own
// `quotedInAnswer` fixture, with the steer group quoted instead of the busy row).
const IDLE_QUOTED_STEER = [
  '  >_ OpenAI Codex (v0.158.0)',
  '     ~/repo',
  '› what does the steer preview look like?',
  '• It reads like this:',
  '  • Messages to be submitted after next tool call (press esc to interrupt and send immediately)',
  '    ↳ steer from phone',
  '  The header stays until the next tool call.',
  '  9:46 PM',
  '› Ask Codex to do anything',
  '  GPT-6-Sol medium · ~/repo',
  '  ? for shortcuts'
]

// The 0.153/0.155 shape: no timestamp, the quoted header is the answer's last line.
const IDLE_QUOTED_STEER_0155 = [
  '› what header does a steer get?',
  '• Codex draws this over the composer:',
  '  • Messages to be submitted after next tool call (press esc to interrupt and send immediately)',
  '› Ask Codex to do anything',
  '  gpt-6-sol medium · ~/repo'
]

describe('an idle Codex whose last answer quotes a steer group', () => {
  it.each([
    ['0.158', IDLE_QUOTED_STEER],
    ['0.155', IDLE_QUOTED_STEER_0155]
  ])('reads idle, not as a running turn (%s)', (_, lines) => {
    expect(read(lines)).toEqual(IDLE)
  })

  it('still closes the /model picker it opened over that answer', async () => {
    const composer = IDLE_QUOTED_STEER.indexOf('› Ask Codex to do anything')
    const picker = [
      ...IDLE_QUOTED_STEER.slice(0, composer),
      '  Select Model and Effort',
      '  1. gpt-6-astra (default)  Our most capable model for complex work.',
      '› 2. gpt-5.6-sol (current)  Reliable agentic workhorse for everyday tasks.',
      '  Press enter to confirm or esc to go back'
    ]
    const sent: string[] = []
    const io: CodexPickerIo = {
      readScreen: async () => (sent.length ? IDLE_QUOTED_STEER : picker),
      sendKey: async (text) => {
        sent.push(text)
        return true
      },
      typeCommand: async () => true,
      sleep: async () => undefined,
      now: () => 0
    }
    await escapeCodexPicker(io)
    expect(sent).toEqual(['\x1b'])
  })
})

describe('an idle Codex whose last answer quotes a whole running screen', () => {
  it('reads idle: a quoted preview header does not make a quoted busy row "directly above"', () => {
    expect(
      read([
        '› what does a running turn with a queued message look like?',
        '• Like this:',
        '  • Working (12s • esc to interrupt)',
        '  • Queued follow-up inputs',
        '    ↳ then run the tests',
        '  9:46 PM',
        '› Ask Codex to do anything',
        '  GPT-6-Sol medium · ~/repo',
        '  ? for shortcuts'
      ])
    ).toEqual(IDLE)
  })
})

const FOOT = ['› Ask Codex to do anything', '  GPT-6-Sol medium · ~/repo', '  ? for shortcuts']
const EARLIER = ['› run the tests', '• Ran npm test', '  └ 312 passed']

describe('a running Codex turn whose status detail spans more than one line', () => {
  // status_indicator_widget.rs wraps a detail under "  └ " then a four-space indent, up to three
  // lines; parallel guardian reviews list one "• <detail>" per line.
  it.each([
    [
      'a wrapped retry detail',
      [
        ...EARLIER,
        '• Reconnecting... 2/5 (12s • esc to interrupt)',
        '  └ stream disconnected before completion: error sending request for url',
        '    (https://chatgpt.com/backend-api/codex/responses)',
        ...FOOT
      ]
    ],
    [
      'parallel approval reviews',
      [
        ...EARLIER,
        '• Reviewing 2 approval requests (5s • esc to interrupt)',
        '  └ • git push origin main',
        '    • rm -rf build',
        ...FOOT
      ]
    ],
    [
      'parallel approval reviews with a message queued',
      [
        ...EARLIER,
        '• Reviewing 2 approval requests (5s • esc to interrupt)',
        '  └ • git push origin main',
        '    • rm -rf build',
        '• Queued follow-up inputs',
        '  ↳ then deploy',
        '    ⌥ + ↑ edit last queued message',
        ...FOOT
      ]
    ]
  ])('reads as running, so nothing is typed into it (%s)', (_, lines) => {
    expect(read(lines)).toEqual(RUNNING)
  })
})
