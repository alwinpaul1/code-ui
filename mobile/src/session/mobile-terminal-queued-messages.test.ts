import { describe, expect, it } from 'vitest'
import {
  claudeQueueViewFromScreen,
  queuedMessagesFromScreen,
  pendingOutsideVisibleQueue,
  queueRowIsPendingSend,
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
  // 2026-09-14, from the phone with a screenshot: Claude draws its context
  // warning inside the same composer block as the queue, so the scan glued it
  // onto the last queued entry. The phone then printed "1% until auto-compact"
  // inside the user's own bubble, and — because the contaminated text no longer
  // equalled the message the agent had been told about — the echo never retired
  // and the one message stood three times over.
  it("keeps Claude's context warning out of the queued message", () => {
    expect(
      queuedMessagesFromScreen([
        '⏺ Earlier response',
        '',
        '✻ Working…',
        '',
        '  ❯ Always check the difference against current code',
        '    and confirm if confirmed fix that save this to project claude.md',
        '  1% until auto-compact',
        '────────',
        '❯ Press up to edit queued messages'
      ])
    ).toEqual([
      'Always check the difference against current code\nand confirm if confirmed fix that save this to project claude.md'
    ])
  })

  it('keeps a message that merely mentions auto-compact in its own words', () => {
    expect(
      queuedMessagesFromScreen([
        '✻ Working…',
        '',
        '  ❯ what happens at 1% until auto-compact exactly',
        '────────',
        '❯ Press up to edit queued messages'
      ])
    ).toEqual(['what happens at 1% until auto-compact exactly'])
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

  it('shows a long queued message once, even though Claude draws it shortened', () => {
    // Reported twice from the phone with screenshots (2026-09-14): a long
    // prompt stood as a sent bubble AND as queue entry 1 at the same time. The
    // queue box only ever holds what fits, so the row Claude drew is a shortened
    // form of what was sent, and an exact compare never matched it.
    const sent =
      'Did you do all the changes i told in this session reead thr session transcript deeply\n\n' +
      '1. Check all the messages or user prompts i asked to you where done and confirm it, if not ' +
      'work on it and finish the work and confirm\n\n' +
      ' 2. send opus and Sonnet agents to see if you caused any regression and if yes check if its ' +
      'a real regression or bug and fix'
    const drawn =
      'Did you do all the changes i told in this session reead thr session transcript deeply\n' +
      '1. Check all the messages or user prompts i asked to you where done and confirm it, if not ' +
      'work on it and finish the work and\u2026'
    expect(pendingOutsideVisibleQueue([{ text: sent }], [drawn])).toEqual([])
  })

  it('still keeps a pending send the queue does not hold', () => {
    expect(
      pendingOutsideVisibleQueue([{ text: 'a message that was never queued' }], ['something else'])
    ).toEqual([{ text: 'a message that was never queued' }])
  })

  it('does not let a short send be swallowed by an unrelated longer row', () => {
    // "ok" is a prefix of almost anything; matching on prefix alone would drop
    // a real pending bubble whenever the queue held a longer message.
    expect(pendingOutsideVisibleQueue([{ text: 'ok' }], ['okay, run the deploy now'])).toEqual([
      { text: 'ok' }
    ])
  })
})

it('does not let a short send claim a longer message\'s queue row', () => {
  // 2026-09-14 review: the match was accepted in BOTH directions, so a pending
  // whose text merely STARTS another one matched the longer one's drawn row.
  // Its own bubble vanished while it was still queued, and the longer message
  // showed twice — the duplicate the user reported, reached the other way.
  const a = 'run the whole regression gate now'
  const b = `${a} and then tag the release`
  expect(pendingOutsideVisibleQueue([{ text: a }, { text: b }], [b])).toEqual([{ text: a }])
})

it('gives a drawn row to the longest send that starts with it', () => {
  const a = 'run the whole regression gate now'
  const b = `${a} and then tag the release`
  // The row is a shortened form of B; A must not take it first.
  expect(
    pendingOutsideVisibleQueue([{ text: a }, { text: b }], [a, `${a} and then tag the rel…`])
  ).toEqual([])
})

describe('Claude Code 2.1.277 queue', () => {
  // Captured live on 2026-09-19 (`orca terminal read --screen`, Claude Code
  // 2.1.277). This build moved the queue: the entry sits at COLUMN ZERO right
  // under the spinner, its wrapped lines are indented two spaces, and a new
  // "ctrl+x ctrl+s to send now" row closes the block. The composer placeholder
  // is still "Press up to edit queued messages", which Orca publishes as the
  // draft. Every row here is verbatim from that frame.
  const CAPTURED_2_1_277 = [
    '⏺ Running 5 shell commands…',
    '  ⎿  $ cd "/Users/alwinpaul/Desktop/Project/Code UI/mobile" && grep -n',
    '     "clipboardImage" src/session/MobileNativeChatOverlay.tsx | head; echo "==',
    '     "MobileNativeCha…',
    '✻ Frolicking… (15m 36s · ↓ 56.6k tokens)',
    "❯ [Image #4] [Image #5] Also see a message i send from claude mobile app isn't",
    '  still here on our codeui app',
    '  ctrl+x ctrl+s to send now',
    '                                                  Ctrl+Y to paste deleted text',
    '────────────────────────────────────────────────────────────────────────────────',
    '❯',
    '────────────────────────────────────────────────────────────────────────────────',
    '  [Opus 5 (1M context) xhigh | Max 20x] ██░░░░ 28% (275k/1.0M)',
    '  Usage ░░░░░░ 7% (resets 1:20 AM) | Weekly ██░░░░ 38% (resets Wed 7:00 PM)',
    '  ─────────────────────────────────────────────────────────────────────────',
    '  ✓ Bash ×19 | ✓ Skill ×1',
    '  ⏵⏵ auto mode on · 1 shell · ← for agents'
  ]

  it('shows the message the phone just queued instead of nothing', () => {
    // On the phone this read as an empty queue: the row was walked past as a
    // transcript echo and the "send now" hint was taken for a wrapped line.
    expect(queuedMessagesFromScreen(CAPTURED_2_1_277, 'Press up to edit queued messages')).toEqual([
      "[Image #4] [Image #5] Also see a message i send from claude mobile app isn't\nstill here on our codeui app"
    ])
  })

  it('reads several entries, each at column zero', () => {
    expect(
      queuedMessagesFromScreen(
        [
          '✻ Frolicking… (1s)',
          '❯ first queued',
          '  wrapped',
          '❯ second queued',
          '  ctrl+x ctrl+s to send now',
          '────────',
          '❯'
        ],
        'Press up to edit queued messages'
      )
    ).toEqual(['first queued\nwrapped', 'second queued'])
  })

  it('does not take a delivered message above the spinner for a queued one', () => {
    expect(
      queuedMessagesFromScreen(
        [
          '❯ already delivered',
          '  and answered',
          '⏺ Running a command…',
          '✻ Frolicking… (1s)',
          '❯ still queued',
          '  ctrl+x ctrl+s to send now',
          '────────',
          '❯'
        ],
        'Press up to edit queued messages'
      )
    ).toEqual(['still queued'])
  })

  it('reads the queue under a spinner that hard-wrapped on a phone-width terminal', () => {
    // Shape from the wrap rule, not a capture: at ~40 columns the spinner
    // line "✻ Frolicking… (15m 36s · ↓ 56.6k tokens)" breaks and its tail
    // lands at column zero with no marker.
    expect(
      queuedMessagesFromScreen(
        [
          '✻ Frolicking… (15m 36s · ↓ 56.6k',
          'tokens)',
          '❯ still queued',
          '  ctrl+x ctrl+s to send now',
          '────────',
          '❯'
        ],
        'Press up to edit queued messages'
      )
    ).toEqual(['still queued'])
  })

  it('does not take the todo list under the spinner for a message', () => {
    // Shape from Claude Code 2.1.277's todo rendering, not a capture.
    expect(
      queuedMessagesFromScreen(
        [
          '✻ Frolicking… (1m 2s · ctrl+t to hide todos)',
          '  ⎿  ☐ Write the failing test',
          '     ☐ Fix the parser',
          '❯ still queued',
          '  ctrl+x ctrl+s to send now',
          '────────',
          '❯'
        ],
        'Press up to edit queued messages'
      )
    ).toEqual(['still queued'])
  })

  it('refuses when nothing bounds the block above', () => {
    // A column-zero marker with no spinner, blank or tool row above it could
    // as easily be the transcript; a wrong queue rewrite loses messages, an
    // empty one only hides a pencil.
    expect(
      queuedMessagesFromScreen(
        [
          '❯ maybe delivered, maybe queued',
          '  ctrl+x ctrl+s to send now',
          '────────',
          '❯'
        ],
        'Press up to edit queued messages'
      )
    ).toEqual([])
  })

  it('still reads the 2.1.263 indented rows when the send-now hint is absent', () => {
    expect(
      queuedMessagesFromScreen(
        ['✻ Working…', '', '  ❯ indented entry', '    wrapped', '────────', '❯'],
        'Press up to edit queued messages'
      )
    ).toEqual(['indented entry\nwrapped'])
  })
})

// Claude Code paints a queued prompt as rendered markdown, so inline code
// loses its backticks on screen (queue box captured on 2.1.278 at 46 columns:
// typed "written as a `user` row" is painted "written as a user row"). The
// phone compares the row against what it sent, and a send with backticks was
// never recognised as its own row: it stood as a bubble AND a queue row, the
// 2026-09-14 shape back for any message with inline code (2026-09-19).
it('recognises its own queued row when the box paints inline code without the backticks', () => {
  const typed =
    'Left as is. For the record only: the fired wakeup is written as a `user` row with `turnOrigin: "scheduled"` (a human message carries `turnOrigin: "human"`), so that field is the switch. The loop still fires at 23:57.'
  const painted = [
    'Left as is. For the record only: the fired',
    'wakeup is written as a user row with',
    'turnOrigin: "scheduled" (a human message',
    'carries turnOrigin: "human"), so that field',
    'is the switch. The loop still fires at',
    '23:57.'
  ].join('\n')
  expect(queueRowIsPendingSend(typed, painted)).toBe(true)
  expect(pendingOutsideVisibleQueue([{ text: typed }], [painted])).toEqual([])
})

it('pairs a photo send with its painted row when the caption has inline code', () => {
  const typed = 'See `foo()` here'
  const image = { text: typed, images: ['file:///a.jpg'] }
  expect(projectMobileChatQueue([image], ['[Image #1] See foo() here'])).toEqual({
    pending: [],
    queue: [{ text: typed, images: ['file:///a.jpg'], caption: '[Image #1] See foo() here' }]
  })
})

// 2026-09-20, phone: the queue box read "…confirm with jev and / then fixx /
// and again confirm with jev so no bug / exist" — the message the user had
// typed as one line (transcript queue-operation content), broken where the
// agent's screen wrapped it. The row IS the phone's own send; the phone has
// the text as typed and shows that, keeping the painted row for the recall
// to match against, as a photo row already does.
it('shows the phone’s own queued send as typed, not as the screen wrapped it', () => {
  const typed =
    'will this popover thing height change according to phone size or resolution or is it fixed confirm with jev and then fixx and again confirm with jev so no bug exist'
  const painted = [
    'will this popover thing height change',
    'according to phone size or resolution',
    'or is it fixed confirm with jev and',
    'then fixx',
    'and again confirm with jev so no bug',
    'exist'
  ].join('\n')
  expect(projectMobileChatQueue([{ text: typed, id: 1 }], [painted, 'typed on the desk'])).toEqual({
    pending: [],
    queue: [{ text: typed, images: [], caption: painted }, 'typed on the desk']
  })
})

// Claude Code 2.1.280 (this repo's own session, 2026-09-23, transcribed from the
// user's screenshot of the terminal): the send-now row under a queued message
// reads "ctrl+enter to send now", indented with the entry's wrapped lines, where
// 2.1.277 drew "ctrl+x ctrl+s to send now". The parser knew only the older
// chord, found no queue, and the chat drew the queued message as sent.
describe('Claude Code 2.1.280 queue block', () => {
  const screen = [
    '  ⎿  $ cd "/Users/alwinpaul/Desktop/Project/Code UI/mobile" && (npx tsc --noEmit && npx vitest run',
    '     (ctrl+b to run in background)',
    '',
    '✻ Gesticulating… (19m 29s · ↓ 51.3k tokens)',
    '',
    '❯ [Image #4] [Image #5] Also see here all 9 tests  message response sits above the user prompt in',
    '  terminal but chatui shows wrong',
    '  ctrl+enter to send now',
    '───────────────────────────────────────────────────────────────────────────────────────',
    '❯ Press up to edit queued messages',
    '───────────────────────────────────────────────────────────────────────────────────────'
  ]

  it('reads a queued message that ends in the ctrl+enter send-now row', () => {
    expect(claudeQueueViewFromScreen(screen).entries).toEqual([
      '[Image #4] [Image #5] Also see here all 9 tests  message response sits above the user prompt in\nterminal but chatui shows wrong'
    ])
  })

  it('still reads the 2.1.277 chord', () => {
    const older = screen.map((line) => line.replace('ctrl+enter', 'ctrl+x ctrl+s'))
    expect(claudeQueueViewFromScreen(older).entries).toHaveLength(1)
  })

  it('reads no queue when the send-now row is gone', () => {
    const without = screen.filter((line) => !line.includes('to send now'))
    expect(claudeQueueViewFromScreen(without).entries).toEqual([])
  })
})
