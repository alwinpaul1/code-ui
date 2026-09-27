import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'
import { codexQueuedMessagesFromScreen } from './codex-terminal-queued-messages'
import {
  ABSORBED_PROMPT,
  BELOW_QUEUE,
  COLUMNS,
  HINT_ROWS,
  LEAKED_BUBBLE_TEXT,
  PROMPT_ROW,
  QUEUE_DRAFT,
  QUEUED_PHOTO_SEND,
  QUEUED_ROWS,
  REPLY_ABOVE,
  SEPARATOR,
  TOOL_DESCRIPTION,
  runningToolFrame
} from './fixtures/claude-running-tool-under-absorbed-prompt-2.1.283'
import { readingGluesToolRowsOnto } from './mobile-native-chat-witness-dedupe'
import { peerNoticesFromScreen } from './mobile-terminal-peer-notices'
import { claudeQueueViewFromScreen, queueBlockLineIndices } from './mobile-terminal-queued-messages'
import { recallNativeQueue, type QueueScreen } from './native-queue-editor'
import { useAbsorbedQueueEchoes } from './use-absorbed-queue-echoes'
import { useMobileTerminalHudObservation } from './use-mobile-terminal-hud-observation'
import { useQueuedOwnSends } from './use-queued-own-sends'

// 2026-09-27, Claude Code 2.1.283, a tab driven from the phone: a running
// tool's description and its `⎿ $ …` row showed up in a user bubble, under a
// copy of the message they followed, which the chat had already drawn once.
// The fixture says where every row comes from.
//
// The queue reader must stop at the transcript's own rows above the queue,
// and must still read every older queued message whole: every consumer takes
// an entry that leaves the list for one the agent absorbed, so a reading that
// drops a message still waiting draws it as sent. Three reviews of stricter
// readers (2026-09-27) proved that, and the guards for it are below.

const queueOf = (screen: readonly string[]) => claudeQueueViewFromScreen(screen, QUEUE_DRAFT).entries

/** A queue block at the fixture's 98 columns: `above`, then the queued rows,
 *  then the send-now row and everything under the queue. */
const withQueue = (above: readonly string[], queued: readonly string[]) => [
  ...above,
  ...queued,
  '  ctrl+enter to send now',
  ...BELOW_QUEUE
]

const OLDER = ['❯ first line of the older one', '  second line, typed after shift+enter'] as const
const OLDER_TEXT = 'first line of the older one\nsecond line, typed after shift+enter'
const RUNNING = '⏺ Running 1 shell command…'

describe('a running tool under a prompt Claude took, with a message queued (Claude Code 2.1.283)', () => {
  it("reads only the queued message on the dot's ON frame", () => {
    expect(queueOf(runningToolFrame('on'))).toEqual([QUEUED_PHOTO_SEND])
  })

  it("does not read the prompt above, and the running tool's rows, as a queued message on the dot's OFF frame", () => {
    // On main before this fix the OFF frame read
    // [LEAKED_BUBBLE_TEXT, QUEUED_PHOTO_SEND]: the blinked-off description row
    // sat at two spaces like a wrapped line, so the scan walked up through it
    // and the `⎿` rows to the prompt row above.
    const entries = queueOf(runningToolFrame('off'))
    expect(entries).not.toContain(LEAKED_BUBBLE_TEXT)
    expect(entries).toEqual([QUEUED_PHOTO_SEND])
  })

  it('reads the same queue on both frames, so nothing leaves the list between polls', () => {
    expect(queueOf(runningToolFrame('off'))).toEqual(queueOf(runningToolFrame('on')))
  })


  it("does not take a prompt Claude took with photos, and its `⎿ [Image #N]` rows, for a queued message", () => {
    // The terminal screenshot of this report shows the photo prompt painted
    // with these rows under it once Claude took it.
    const taken = [
      '❯ [Image #111] [Image #112] Also why like there are responses below this prompt in terminal mode',
      "  but chatui doesn't show that",
      '  ⎿  [Image #111]',
      '  ⎿  [Image #112]'
    ]
    expect(queueOf(withQueue([...REPLY_ABOVE, ...taken], ['❯ queued after it']))).toEqual(['queued after it'])
  })

  it('marks only the queued message as the queue box on the OFF frame', () => {
    const screen = runningToolFrame('off')
    const first = screen.indexOf(QUEUED_ROWS[0])
    expect([...queueBlockLineIndices(screen, QUEUE_DRAFT)]).toEqual([first, first + 1])
  })

  it('reads no queue from an empty screen', () => {
    expect(queueOf([])).toEqual([])
    expect([...queueBlockLineIndices([], QUEUE_DRAFT)]).toEqual([])
  })

  it('reads no queue when the prompt is the last row on the screen', () => {
    expect(queueOf([...REPLY_ABOVE, PROMPT_ROW])).toEqual([])
    expect(queueOf([PROMPT_ROW])).toEqual([])
  })

  it('reads no queue from a send-now row with nothing above it', () => {
    expect(queueOf(['  ctrl+enter to send now', ...BELOW_QUEUE])).toEqual([])
  })
})

describe('queued messages read whole, under a running tool', () => {
  it('reads the newest message whole, whatever its own lines hold', () => {
    const screen = withQueue(
      [...REPLY_ABOVE, PROMPT_ROW, `  ${TOOL_DESCRIPTION}`, ...HINT_ROWS],
      [
        '❯ first line of the message',
        '  second line, typed after shift+enter',
        '    and an indented third',
        '  ⎿ a line pasted without its indent',
        '  Ran 2 shell commands, said the agent'
      ]
    )
    expect(queueOf(screen)).toEqual([
      'first line of the message\nsecond line, typed after shift+enter\nand an indented third\n⎿ a line pasted without its indent\nRan 2 shell commands, said the agent'
    ])
  })

  it('reads an older message with a line break of its own whole, and the one behind it', () => {
    expect(queueOf(withQueue([RUNNING], [...OLDER, '❯ newest one']))).toEqual([OLDER_TEXT, 'newest one'])
  })

  it('reads an older message whole when its rows wrap exactly as Claude wraps a prompt', () => {
    // A prompt painted by Claude Code 2.1.282 at 120 columns, verbatim from a
    // tmux capture. Queued prompts are painted by the same box.
    const capture = readFileSync(
      fileURLToPath(new URL('./fixtures/claude-screen-ask-two-questions-2.1.282.txt', import.meta.url)),
      'utf8'
    ).split('\n')
    const first = capture.findIndex((line) => line.startsWith('❯ UI test 5.'))
    const rows = capture.slice(first, first + 5)
    expect(rows.at(-1)).toBe('  "done" after the answer.')
    const rule = '─'.repeat(120)
    const screen = [RUNNING, ...rows, '❯ newest one', '  ctrl+enter to send now', '✻ Proofing… (1m 33s)', rule, '❯', rule]
    expect(queueOf(screen)).toEqual([rows.map((row) => row.replace(/^❯ /, '').trim()).join('\n'), 'newest one'])
  })

  it("reads an older message whole when a wrapped line of it starts with Claude's tool words", () => {
    // 92 characters of text in a 95-column text column (98 less the "❯ "
    // gutter and one column of padding): " Ran" would need 96, so Claude wraps
    // there, and the row reads like a finished fold.
    const said = 'I asked it to rebuild the APK and then check the logcat for the crash, and the tool row said'
    expect(said.length).toBe(92)
    const older = [`❯ ${said}`, '  Ran 6 shell commands and then it stopped, so did the build run at all?']
    expect(queueOf(withQueue([RUNNING], [...older, '❯ newest one']))).toEqual([
      `${said}\nRan 6 shell commands and then it stopped, so did the build run at all?`,
      'newest one'
    ])
  })

  it('reads an older message whole when a line of it is an instruction like "Read 3 files"', () => {
    const older = ['❯ fix the build', '  Read 3 files in src/session first']
    expect(queueOf(withQueue([RUNNING], [...older, '❯ newest one']))).toEqual([
      'fix the build\nRead 3 files in src/session first',
      'newest one'
    ])
  })

  it("reads an older message whole when it holds rows pasted from Claude's terminal", () => {
    // Pasted rows keep their indent, so they sit deeper than Claude's own.
    const older = ['❯ why does this fail?', '  ⏺ Bash(npx vitest run)', '    ⎿  Error: expected 2 to be 3']
    expect(queueOf(withQueue([RUNNING], [...older, '❯ newest one']))).toEqual([
      'why does this fail?\n⏺ Bash(npx vitest run)\n⎿  Error: expected 2 to be 3',
      'newest one'
    ])
  })

  it('keeps a peer message waiting above an older message in the queue box, not in the turn', () => {
    const screen = withQueue([RUNNING, '› Message from @probe (ctrl+o to expand)', ...OLDER], ['❯ newest one'])
    expect(peerNoticesFromScreen(screen, QUEUE_DRAFT)).toEqual([])
  })
})

describe('editing the queue from the phone under a running tool', () => {
  it("recalls the queued message on the dot's OFF frame", async () => {
    // On main this read the glued entry first, and the tap was refused as
    // "the queue moved on".
    const lines = withQueue([...REPLY_ABOVE, PROMPT_ROW, `  ${TOOL_DESCRIPTION}`, ...HINT_ROWS], ['❯ queued plain message'])
    const before: QueueScreen = { source: 'screen', draft: QUEUE_DRAFT, lines }
    const after: QueueScreen = { source: 'screen', draft: 'queued plain message', lines: [RUNNING, ...BELOW_QUEUE] }
    const read = vi.fn().mockResolvedValueOnce(before).mockResolvedValue(after)
    const recall = await recallNativeQueue({ read, write: vi.fn(async () => {}), pause: async () => {} }, 'claude', 0, 'queued plain message')
    expect(recall.segments).toEqual(['queued plain message'])
  })

  it('recalls the whole queue when an older message has a line break of its own', async () => {
    const before: QueueScreen = { source: 'screen', draft: QUEUE_DRAFT, lines: withQueue([RUNNING], [...OLDER, '❯ newest one']) }
    const after: QueueScreen = { source: 'screen', draft: `${OLDER_TEXT}\nnewest one`, lines: [RUNNING, ...BELOW_QUEUE] }
    const read = vi.fn().mockResolvedValueOnce(before).mockResolvedValue(after)
    const recall = await recallNativeQueue({ read, write: vi.fn(async () => {}), pause: async () => {} }, 'claude', 1, 'newest one')
    expect(recall.segments).toEqual([OLDER_TEXT, 'newest one'])
    expect(recall.text).toBe('newest one')
  })
})

// Codex paints its pending input under its own header, with `↳` entries, and
// has its own reader. The rows are from codex-terminal-queued-messages.test.ts
// with a running command above them.
describe("Codex's pending-input preview under a running command", () => {
  const codexScreen = [
    '• Running cargo test -p codex-tui',
    '  └ running 212 tests',
    '• Queued follow-up inputs',
    '  ↳ fix the build',
    '    then run the tests',
    '  ↳ mobile task',
    '    alt + ↑ edit last queued message',
    '› unsent composer draft'
  ]

  it('reads the same entries as before', () => {
    expect(codexQueuedMessagesFromScreen(codexScreen)).toEqual(['fix the build\nthen run the tests', 'mobile task'])
  })

  it("is not read by Claude's queue reader, and Claude's frames are not read by Codex's", () => {
    expect(claudeQueueViewFromScreen(codexScreen).entries).toEqual([])
    expect(codexQueuedMessagesFromScreen(runningToolFrame('off'))).toEqual([])
    expect(codexQueuedMessagesFromScreen(runningToolFrame('on'))).toEqual([])
  })
})

function row(id: string, role: 'user' | 'assistant', text: string): NativeChatMessage {
  return { id, role, blocks: [{ type: 'text', text }], timestamp: 0, source: 'transcript' }
}

let latest: ReturnType<typeof useAbsorbedQueueEchoes> | null = null

function Probe({ queued, folded, own }: { queued: string[]; folded: NativeChatMessage[]; own: string[] }): null {
  latest = useAbsorbedQueueEchoes(queued, [], folded, 'tab-a', folded, own)
  return null
}

/** Feed the hook one queue reading per poll, as the phone does. */
function readings(folded: NativeChatMessage[], own: string[], polls: string[][]): ReturnType<typeof useAbsorbedQueueEchoes> {
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(createElement(Probe, { queued: polls[0]!, folded, own }))
  })
  for (const queued of polls.slice(1)) {
    act(() => renderer!.update(createElement(Probe, { queued, folded, own })))
  }
  const result = latest!
  act(() => renderer!.unmount())
  return result
}

// What the chat does with the readings, through the hook that polls the screen.
describe('the queue as the chat sees it', () => {
  let observer: ReactTestRenderer | null = null
  // One object for the whole test: a new one each render re-runs the hook's
  // read effect, which clears the queue.
  const handleRef = { current: 'terminal' }
  afterEach(async () => {
    await act(async () => observer?.unmount())
    observer = null
    latest = null
    vi.useRealTimers()
  })

  /** The queue the chat is given after each screen read, one frame a poll. */
  async function observed(frames: readonly (readonly string[])[]): Promise<string[][]> {
    vi.useFakeTimers()
    let read = 0
    const sendRequest = vi.fn(async () => ({
      ok: true,
      result: { terminal: { lines: [...frames[Math.min(read++, frames.length - 1)]!], draft: QUEUE_DRAFT } }
    }))
    const client = { sendRequest } as unknown as RpcClient
    let queue: string[] = []
    function Harness(): null {
      queue = useMobileTerminalHudObservation({
        client,
        enabled: true,
        active: true,
        handleRef,
        handleKey: 'terminal',
        agent: 'claude'
      }).queuedMessages
      return null
    }
    const seen: string[][] = []
    await act(async () => {
      observer = create(createElement(Harness))
    })
    seen.push(queue)
    for (let poll = 1; poll < frames.length; poll += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      seen.push(queue)
    }
    expect(sendRequest).toHaveBeenCalledTimes(frames.length)
    return seen
  }

  it("draws no second bubble for the phone's own send while the tool's dot blinks", async () => {
    const queues = await observed([
      runningToolFrame('on'),
      runningToolFrame('off'),
      runningToolFrame('on'),
      runningToolFrame('off'),
      runningToolFrame('on')
    ])
    expect(queues).toEqual(Array.from({ length: 5 }, () => [QUEUED_PHOTO_SEND]))
    expect(readings([row('a1', 'assistant', 'working')], [ABSORBED_PROMPT], queues)).toEqual([])
  })

  const alone = withQueue([RUNNING], OLDER)
  const behind = withQueue([RUNNING], [...OLDER, '❯ newest one'])

  it('does not draw a desktop message with a line break as taken while another waits behind it', async () => {
    const queues = await observed([alone, behind, behind])
    expect(queues.at(-1)).toEqual([OLDER_TEXT, 'newest one'])
    expect(readings([row('a1', 'assistant', 'working')], [], queues)).toEqual([])
  })

  it("does not mark the phone's own send with a line break as taken while another waits behind it", async () => {
    const queues = await observed([alone, behind])
    const now = Date.now()
    const a = { id: 'a', text: OLDER_TEXT, sentAt: now }
    const b = { id: 'b', text: 'newest one', sentAt: now }
    const onTaken = vi.fn()
    let result: ReturnType<typeof useQueuedOwnSends<typeof a>> | null = null
    function Own({ pending, queue }: { pending: (typeof a)[]; queue: string[] }): null {
      result = useQueuedOwnSends(pending, queue, true, { scopeKey: 's', readsQueueBox: true, readBeat: null, onTaken })
      return null
    }
    let own: ReactTestRenderer | null = null
    act(() => {
      own = create(createElement(Own, { pending: [a], queue: queues[0]! }))
    })
    act(() => own!.update(createElement(Own, { pending: [a, b], queue: queues[1]! })))
    expect(result!.pending.map((send) => send.id)).toEqual([])
    expect(result!.unlisted.map((send) => send.id)).toEqual([])
    expect(onTaken).not.toHaveBeenCalled()
    act(() => own!.unmount())
  })
})

// Before the reader fix, the phone's polls alternated between the ON and OFF
// readings, and every OFF reading that left the list was held as a message the
// agent had taken. The reader no longer produces it, but any reading shaped
// like it must not draw a second bubble either.
describe('a screen reading that glues tool rows onto a message already sent', () => {
  afterEach(() => {
    latest = null
  })
  const onFrame = [QUEUED_PHOTO_SEND]
  const offFrame = [LEAKED_BUBBLE_TEXT, QUEUED_PHOTO_SEND]

  it("draws no second bubble for the phone's own send", () => {
    const folded = [row('a1', 'assistant', 'working')]
    const echoes = readings(folded, [ABSORBED_PROMPT], [onFrame, offFrame, onFrame, offFrame, onFrame])
    expect(echoes.map((echo) => echo.text)).not.toContain(LEAKED_BUBBLE_TEXT)
    expect(echoes).toEqual([])
  })

  it('draws no second bubble for a message that landed as its own row', () => {
    const folded = [row('u1', 'user', ABSORBED_PROMPT), row('a1', 'assistant', 'working')]
    expect(readings(folded, [], [onFrame, offFrame, onFrame])).toEqual([])
  })


  it('draws no second bubble for a message the queue box listed clean before the agent took it', () => {
    const folded = [row('a1', 'assistant', 'working')]
    const echoes = readings(folded, [], [[ABSORBED_PROMPT], [], onFrame, offFrame, onFrame])
    // The clean one is the absorbed message the hook exists to keep.
    expect(echoes.map((echo) => echo.text)).toEqual([ABSORBED_PROMPT])
  })

  it('still draws a longer message that only starts with the words of an earlier send', () => {
    const folded = [row('a1', 'assistant', 'working')]
    const longer = `${ABSORBED_PROMPT}\nand the same for a PDF from the files app`
    expect(readings(folded, [ABSORBED_PROMPT], [[longer], []]).map((echo) => echo.text)).toEqual([longer])
  })

  it('still draws a message that repeats an earlier send and goes on with words shaped like a tool', () => {
    // A person types "QueueEditor()" or "Read 3 files": only the TUI's own
    // glyphs mark a row as the agent's.
    const folded = [row('a1', 'assistant', 'working')]
    const message = 'why did this fail?\nQueueEditor() still hangs after a save\nRead 3 files in src/session first'
    expect(readings(folded, ['why did this fail?'], [[message], []]).map((echo) => echo.text)).toEqual([message])
  })

  it("still draws a Codex follow-up that starts with an earlier send's words and goes on in plain lines", () => {
    const screen = ['• Queued follow-up inputs', '  ↳ fix the build', '    then run the tests', '    alt + ↑ edit last queued message']
    const queued = codexQueuedMessagesFromScreen(screen)
    const folded = [row('a1', 'assistant', 'working')]
    expect(readings(folded, ['fix the build'], [queued, []]).map((echo) => echo.text)).toEqual([
      'fix the build\nthen run the tests'
    ])
  })

  it('never takes a message of photos alone, which has no words to match, as the start of another', () => {
    // A photos-only send normalises to an empty key.
    expect(readingGluesToolRowsOnto(new Set(['']), '[Image #4]\n⎿  [Image #4]')).toBe(false)
    expect(readingGluesToolRowsOnto(new Set([ABSORBED_PROMPT]), LEAKED_BUBBLE_TEXT)).toBe(true)
    expect(readingGluesToolRowsOnto(new Set([ABSORBED_PROMPT]), ABSORBED_PROMPT)).toBe(false)
    expect(readingGluesToolRowsOnto(new Set(), '')).toBe(false)
  })
})

// Kept so the fixture's rule stays the width the tests above assume.
it('frames the fixture at 98 columns', () => {
  expect(SEPARATOR).toHaveLength(COLUMNS)
})
