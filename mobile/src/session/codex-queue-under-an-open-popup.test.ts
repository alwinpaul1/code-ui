import { describe, expect, it } from 'vitest'
import { isCodexWorking } from './codex-picker-screen'
import {
  codexPendingInputPreviewRows,
  codexQueuedMessagesFromScreen
} from './codex-terminal-queued-messages'

// The Codex queue box read [] while a slash or @ popup was open, so the chat redrew the pending
// bubbles and the absorbed-echo path took the entries as sent (review, 2026-09-30). The phone opens
// that popup itself: typing '/' in a Codex tab mirrors it into the desktop composer.
//
// Codex 0.158.0 draws the popup ABOVE its composer whenever a status row or the pending-input
// preview is shown (codex-rs rust-v0.158.0 tui/src/bottom_pane/mod.rs as_renderable_with_options
// turns CommandPopupPlacement::Overlay into AboveComposer; chat_composer/composer_layout.rs puts the
// popup rect at the top of the composer area, then the composer's blank top inset, then its input
// row). command_popup.rs, file_search_popup.rs and the mention popups mark the selected row with '› ',
// the composer's own glyph, and indent the others two spaces. Codex 0.153.4 draws it BELOW the
// composer with no '›' at all (slash_popup_mo.snap at rust-v0.153.4).
//
// These screens are built from codex-rs rust-v0.158.0 snapshots, not a tmux capture, and still need
// confirming on a live Codex 0.158:
//   status_and_queued_messages_snapshot.snap  '• Working (0s • esc to interrupt)', '', the preview,
//                                             '', '› Ask Codex to do anything', '', the footer
//   slash_popup_res.snap                      '› /resume  resume a saved chat', '', '› /res', …
//   slash_command_popup_dismissed.snap        '  tab to queue message    100% context left'
//   default_unified_mention_popup.snap        the '  Mentions' popup below
//   skill_popup_scrolled.snap                 the '↑' and '↓' rows of a scrolled list
// with the popup rows placed between the preview and the composer, where the layout puts them.

const BUSY = ['• Working (12s • esc to interrupt)', '']
const QUEUED = [
  '• Queued follow-up inputs',
  '  ↳ run the tests again',
  '    shift+← edit last queued message'
]
// A pending steer draws no edit hint, so nothing ends the entry before the popup's rows.
const STEER = [
  '• Messages to be submitted after next tool call (press esc to interrupt and send immediately)',
  '  ↳ run the tests again'
]
const FOOTER_RUNNING = ['', '  tab to queue message                   100% context left']
const composer = (draft: string) => ['', `› ${draft}`, ...FOOTER_RUNNING]

describe('the Codex queue while a popup is open above the composer (0.158)', () => {
  it('keeps the queue readable while a one-row slash popup is open', () => {
    const screen = [...BUSY, ...QUEUED, '› /resume  resume a saved chat', ...composer('/res')]
    expect(codexQueuedMessagesFromScreen(screen)).toEqual(['run the tests again'])
  })

  it('keeps a pending steer whole when the user arrowed down past unselected commands', () => {
    // Unselected rows are indented two spaces, like an entry's own indent, never like its
    // continuation (four spaces, pending_input_preview.rs subsequent_indent).
    const screen = [
      ...BUSY,
      ...STEER,
      '  /model     choose what model and reasoning effort to use',
      '  /memories  configure memory use and generation',
      '› /mention   mention a file',
      '  /mcp       list configured MCP tools; use /mcp verbose for details',
      ...composer('/m')
    ]
    expect(codexQueuedMessagesFromScreen(screen)).toEqual(['run the tests again'])
  })

  it('keeps a pending steer whole under an @-mention popup with its title, tabs and hint', () => {
    const screen = [
      ...BUSY,
      ...STEER,
      '  Mentions',
      '   All Results   Filesystem Only   Plugins',
      '  sa',
      '› Sample Plugin   Plugin with skills and an MCP server                                        Plugin',
      '  enter/tab insert · esc close · ↑/↓ select · ←/→ filter',
      ...composer('@sa')
    ]
    expect(codexQueuedMessagesFromScreen(screen)).toEqual(['run the tests again'])
  })

  it('keeps the queue under a scrolled popup and under one that matched nothing', () => {
    const scrolled = [
      ...QUEUED,
      '↑',
      '  Mention 07  [Skill] Description 07',
      '› Mention 08  [Skill] Description 08',
      '↓',
      '  enter insert · esc close',
      ...composer('$men')
    ]
    expect(codexQueuedMessagesFromScreen(scrolled)).toEqual(['run the tests again'])
    // selection_popup_common.rs render_rows_inner draws the empty message at the popup's column 0.
    expect(
      codexQueuedMessagesFromScreen([...BUSY, ...QUEUED, 'no matches', ...composer('/zz')])
    ).toEqual(['run the tests again'])
  })

  it('marks the preview rows and none of the popup rows', () => {
    const screen = [
      ...BUSY,
      ...STEER,
      '  /model  choose what model',
      '› /mention  mention a file',
      ...composer('/m')
    ]
    expect([...codexPendingInputPreviewRows(screen).rows].sort((a, b) => a - b)).toEqual([2, 3])
    expect([...codexPendingInputPreviewRows(screen).steerHeaders]).toEqual([2])
  })

  it('reads no queue from a popup with nothing queued, and none from an empty screen', () => {
    expect(
      codexQueuedMessagesFromScreen([...BUSY, '› /model  choose what model', ...composer('/mo')])
    ).toEqual([])
    expect(
      codexQueuedMessagesFromScreen(['› /model  choose what model', ...composer('/mo')])
    ).toEqual([])
    expect(codexQueuedMessagesFromScreen([])).toEqual([])
  })

  it('does not step over a second › row to reach a preview an answer quoted higher up', () => {
    // One popup has one selected row. A second › row above it is the conversation (a user turn),
    // so the column-0 preview above that is quoted text, not the live queue.
    const screen = [
      '• Queued follow-up inputs',
      '  ↳ quoted in an answer',
      '› what does that mean?',
      '  /model  choose what model',
      '› /mention  mention a file',
      ...composer('/m')
    ]
    expect(codexQueuedMessagesFromScreen(screen)).toEqual([])
  })
})

describe('a running Codex turn while a popup is open (0.158)', () => {
  it('still reads the turn as running with only the popup between the busy row and the composer', () => {
    // No preview: the bottom pane pushes a blank after the status row, then the popup.
    expect(
      isCodexWorking([
        ...BUSY,
        '› /model  choose what model and reasoning effort to use',
        ...composer('/mo')
      ])
    ).toBe(true)
    const arrowedDown = [
      '• Working (12s • esc to interrupt)',
      '  └ First detail line',
      '    Second detail line',
      '',
      '  /model     choose what model and reasoning effort to use',
      '› /mention   mention a file',
      ...composer('/m')
    ]
    expect(isCodexWorking(arrowedDown)).toBe(true)
  })

  it('still reads the turn as running with the queue and the popup above the composer', () => {
    expect(
      isCodexWorking([...BUSY, ...QUEUED, '› /resume  resume a saved chat', ...composer('/res')])
    ).toBe(true)
  })

  it('reads no running turn when the popup opens over an idle transcript', () => {
    const idle = [
      '• • README.md — contains the heading “scratch.”',
      '  • notes.txt — contains the text “hello.”',
      '',
      '› /model  choose what model and reasoning effort to use',
      '',
      '› /mo',
      '',
      '  GPT-6-Sol medium · ~/orca-lanes/sta8834/corpus/scratch'
    ]
    expect(isCodexWorking(idle)).toBe(false)
  })
})

describe('a popup below the composer', () => {
  it('reads the queue with the popup the reviewer drew below the composer, › on its selected row', () => {
    const screen = [
      '• Working (12s • esc to interrupt)',
      '',
      '• Queued follow-up inputs',
      '  ↳ run the tests again',
      '    ⌥ + ↑ edit last queued message',
      '',
      '› /mo',
      '',
      '  /model   choose what model and reasoning effort to use',
      '› /mention  mention a file'
    ]
    expect(codexQueuedMessagesFromScreen(screen)).toEqual(['run the tests again'])
    expect(isCodexWorking(screen)).toBe(true)
  })

  it('reads the queue with the 0.153.4 popup below the composer, no › on its rows', () => {
    // rust-v0.153.4 slash_popup_mo.snap: '', '› /mo', '', '', '  /model  choose what model …', under
    // the 0.153.4 status_and_queued_messages_snapshot.snap preview ('    ⌥ + ↑ edit last queued message').
    const screen = [
      '• Working (0s • esc to interrupt)',
      '',
      '• Queued follow-up inputs',
      '  ↳ run the tests again',
      '    ⌥ + ↑ edit last queued message',
      '',
      '› /mo',
      '',
      '',
      '  /model  choose what model and reasoning effort to use'
    ]
    expect(codexQueuedMessagesFromScreen(screen)).toEqual(['run the tests again'])
    expect(isCodexWorking(screen)).toBe(true)
  })
})
