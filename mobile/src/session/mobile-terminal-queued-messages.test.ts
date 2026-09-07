import { describe, expect, it } from 'vitest'
import {
  claudeQueueViewFromScreen,
  queuedMessagesFromScreen,
  pendingOutsideVisibleQueue,
  projectMobileChatQueue
} from './mobile-terminal-queued-messages'
import { claudePermissionFromScreen } from './claude-terminal-permission'

describe('visible agent queue', () => {
  it.each([
    ['❯ Press up to select a queued message, then Enter to edit it'],
    ['❯ Press up to select a queued message to edit, or Enter to send them now'],
    ['❯ Press up to select a queued message, then Enter', '  to edit it']
  ])('reads the newer Claude queue selector hint: %s', (...footer) => {
    expect(
      queuedMessagesFromScreen([
        '⏺ Earlier response',
        '',
        '✻ Working…',
        '',
        '  ❯ desktop follow-up',
        '    with wrapped text',
        '────────',
        ...footer
      ])
    ).toEqual(['desktop follow-up\nwith wrapped text'])
  })
  it('reads the explicit queue and wrapped text without importing history', () => {
    expect(
      queuedMessagesFromScreen([
        '❯ old prompt',
        '',
        '✻ Calculating…',
        '',
        '  ❯ run on Willi',
        '    and test and confirm',
        '  ❯ another task',
        '────────',
        '❯ Press up to edit queued messages'
      ])
    ).toEqual(['run on Willi\nand test and confirm', 'another task'])
  })
  it('ignores normal composer drafts and removes entries when the footer disappears', () => {
    expect(queuedMessagesFromScreen(['❯ unsent draft'])).toEqual([])
    expect(queuedMessagesFromScreen(['Running queued task'])).toEqual([])
  })
  it('deduplicates by occurrence without dropping repeated or unconfirmed mobile messages', () => {
    const pending = [
      { text: 'hello', id: 1 },
      { text: 'hello', id: 2 },
      { text: 'new', id: 3 }
    ]
    expect(pendingOutsideVisibleQueue(pending, ['hello'])).toEqual(pending.slice(1))
  })
})

describe('Claude live approval', () => {
  const screen = [
    'Bash command',
    '  echo hello',
    'Do you want to proceed?',
    '❯ 1. Yes',
    '  2. Yes, and don’t ask again for: echo hello',
    '  3. No',
    'Esc to cancel · Tab to amend'
  ]
  it('retains the complete command and exact choices', () => {
    expect(claudePermissionFromScreen(screen)).toMatchObject({
      title: 'Allow Bash?',
      options: [
        { label: 'Yes', send: '1' },
        { label: 'Yes, and don’t ask again for: echo hello', send: '2' },
        { label: 'No', send: '3' }
      ]
    })
    expect(claudePermissionFromScreen(screen)?.detail).toContain('echo hello')
  })
  it('rejects unselected history and incomplete dialogs', () => {
    expect(claudePermissionFromScreen(screen.map((x) => x.replace('❯ ', '')))).toBeNull()
    expect(claudePermissionFromScreen(screen.slice(0, -1))).toBeNull()
  })
})

it('renders a queued image and caption once with its local thumbnail instead of path text', () => {
  const image = { text: 'See this', images: ['file:///a.jpg'], id: 1 }
  const path =
    '/var/folders/0y/session/T/orca-paste-1788707946740-fd6147a9-5b2d-4051-8a87-dbd45992c21e.png'
  expect(projectMobileChatQueue([image], [path + ' See this', 'unrelated'])).toEqual({
    pending: [],
    queue: [{ text: image.text, images: image.images, caption: path + ' See this' }, 'unrelated']
  })
  expect(
    projectMobileChatQueue([image], [path + ' See this', path + ' See this']).queue
  ).toHaveLength(2)
})

it('keeps both queue entries when a photo and another message repeat a caption', () => {
  const image = { text: 'See this', images: ['file:///a.jpg'], id: 1 }
  expect(projectMobileChatQueue([image], ['[Image #1] See this', 'See this'])).toEqual({
    pending: [],
    queue: [{ text: image.text, images: image.images, caption: '[Image #1] See this' }, 'See this']
  })
})

it('excludes Claude’s right-aligned yank hint between the queue and composer', () => {
  expect(
    queuedMessagesFromScreen(
      [
        '✳ Spinning…',
        '  ❯ queue verification alpha',
        '                                      Ctrl+Y to paste deleted text',
        '──────────────────',
        '❯',
        '──────────────────'
      ],
      'Press up to edit queued messages'
    )
  ).toEqual(['queue verification alpha'])
})

// Captured with `tmux capture-pane -p` from Claude Code 2.1.263 at 80 columns,
// three queued messages, two of them long enough to wrap.
const QUEUE_ROWS = [
  '  ❯ alpha this is a deliberately long first queued message that must wrap',
  '    across at least two rendered terminal lines to reveal the continuation',
  '    indent',
  '  ❯ bravo short second',
  '  ❯ charlie another very long third queued message written so that it also',
  '    wraps onto a second line inside the queue block for comparison purposes',
  '',
  '────────────────────────────────────────',
  '❯',
  '────────────────────────────────────────',
  '  [Haiku 4.5 | Team] ░░░░░░ 0% (0/200k) | qtest'
]
const ALPHA =
  'alpha this is a deliberately long first queued message that must wrap\nacross at least two rendered terminal lines to reveal the continuation\nindent'
const CHARLIE =
  'charlie another very long third queued message written so that it also\nwraps onto a second line inside the queue block for comparison purposes'
const dropMarker = (rows: readonly string[], keep: number) => {
  const entryRows = [0, 3, 4]
  return rows.map((line, index) => {
    const entry = entryRows.indexOf(index)
    return entry === -1 || entry === keep ? line : line.replace('  ❯ ', '    ')
  })
}

describe('Claude queue selection', () => {
  it('reads every wrapped entry while nothing is selected', () => {
    const view = claudeQueueViewFromScreen(
      QUEUE_ROWS,
      'Press up to select a queued message, then Enter to edit it'
    )
    expect(view.entries).toEqual([ALPHA, 'bravo short second', CHARLIE])
    expect(view.selectable).toBe(true)
    expect(view.selecting).toBe(false)
  })

  it('keeps the queue readable while an entry is selected', () => {
    // Claude drops the marker from the unselected rows, leaving them at the
    // same indent as a wrapped line. Splitting the block then invents entries.
    const view = claudeQueueViewFromScreen(
      dropMarker(QUEUE_ROWS, 1),
      'Press Enter to edit the selected message, or up again for an older one'
    )
    expect(view.entries).toEqual([])
    expect(view.selecting).toBe(true)
    expect(view.selected).toBe('bravo short second')
    expect(view.selectedOldest).toBe(false)
  })

  it('reports when the marker has reached the oldest entry', () => {
    const view = claudeQueueViewFromScreen(
      dropMarker(QUEUE_ROWS, 0),
      'Press Enter to edit the selected message, or up again for history'
    )
    expect(view.selected).toBe(
      'alpha this is a deliberately long first queued message that must wrap'
    )
    expect(view.selectedOldest).toBe(true)
  })

  it('does not claim the selector on the legacy whole-queue footer', () => {
    const view = claudeQueueViewFromScreen(
      ['  ❯ alpha first', '  ❯ bravo second', '────────', '❯', '────────'],
      'Press up to edit queued messages'
    )
    expect(view.entries).toEqual(['alpha first', 'bravo second'])
    expect(view.selectable).toBe(false)
  })
})

describe('Claude transcript echoes', () => {
  // Captured from Claude Code 2.1.263: a message the running turn has already
  // taken is redrawn in the transcript with the same marker as a queue row, but
  // at column zero, and its own wrapped lines carry a queue-row indent.
  const DELIVERED = [
    '⏺ Running ping -c 8 127.0.0.1 · 2s',
    '  ⎿  $ ping -c 8 127.0.0.1',
    '❯ queued test two',
    '  queued test one',
    '  ❯ queued test three',
    '────────────────────────────────────────',
    '❯ Press up to edit queued messages',
    '────────────────────────────────────────'
  ]

  it('does not glue a delivered message onto the queue entry above it', () => {
    // On a real phone this drew "queued test two queued test one" as entry one.
    expect(queuedMessagesFromScreen(DELIVERED, '')).toEqual(['queued test three'])
  })

  it('stops at the transcript instead of walking up into older turns', () => {
    expect(
      queuedMessagesFromScreen(
        [
          '❯ an older prompt that the agent already answered',
          '  wrapped across a second line',
          '  ❯ still queued',
          '────────',
          '❯ Press up to edit queued messages'
        ],
        ''
      )
    ).toEqual(['still queued'])
  })
})
