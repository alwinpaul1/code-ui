import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { useAbsorbedQueueEchoes } from './use-absorbed-queue-echoes'
import { queuedMessagesFromScreen } from './mobile-terminal-queued-messages'
import { codexQueuedMessagesFromScreen } from './codex-terminal-queued-messages'

// A message queued at the desk is held as an echo once the agent's queue box
// lets it go. Claude Code writes no transcript row for a message it takes
// mid-turn, so on a tab without Orca's prompt hook that echo is the only copy.
// The echo was retired by ANY user row of its words, however far back: a
// mid-turn "keep going with the task" that repeated an earlier turn was
// dropped the moment the box let it go and was drawn nowhere (review of the
// chat-echo batch, 2026-09-30: `expected [] to deeply equal [ 'keep going
// with the task' ]`). A row can be the message's own only if it comes after
// the row that was last when the box first listed it, where it is drawn.

const WORDS = 'keep going with the task'

function user(id: string, text: string): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }], timestamp: 0, source: 'transcript' }
}

function reply(id: string): NativeChatMessage {
  return { id, role: 'assistant', blocks: [{ type: 'text', text: 'ok' }], timestamp: 0, source: 'transcript' }
}

/** Claude Code's queue block above its spinner as 2.1.281 paints it (the
 *  fixture pinned in mobile-chat-absorbed-phone-send.test.ts), holding the
 *  given entries, read by the phone's own parser. */
function claudeBox(entries: readonly string[]): string[] {
  return queuedMessagesFromScreen([
    '● Running 1 shell command · 14s…',
    "  ⎿  $ python3 - <<'EOF'",
    '     (ctrl+b to run in background)',
    '',
    ...entries.flatMap((entry) => entry.split('\n').map((line, index) => (index === 0 ? `❯ ${line}` : `  ${line}`))),
    ...(entries.length ? ['  ctrl+x ctrl+s to send now'] : []),
    '',
    '✻ Incubating… (31m 27s · ↓ 67.8k tokens)',
    '',
    '────────────────────────────────────────────────────────────────────────────────',
    `❯ ${entries.length ? 'Press up to edit queued messages' : ''}`,
    '────────────────────────────────────────────────────────────────────────────────'
  ])
}

/** Codex's pending-input preview (openai/codex, bottom_pane/pending_input_preview.rs),
 *  read by the phone's own parser. */
function codexBox(entries: readonly string[]): string[] {
  return codexQueuedMessagesFromScreen(
    entries.length === 0
      ? ['› ']
      : [
          '• Queued follow-up inputs',
          ...entries.flatMap((entry) => entry.split('\n').map((line, index) => (index === 0 ? `  ↳ ${line}` : `    ${line}`))),
          '    alt + ↑ edit last queued message',
          '› '
        ]
  )
}

let latest: ReturnType<typeof useAbsorbedQueueEchoes> = []

function Probe({ queued, raw }: { queued: string[]; raw: NativeChatMessage[] }): null {
  latest = useAbsorbedQueueEchoes(queued, [], raw, 'tab-a', raw, [])
  return null
}

let renderer: ReactTestRenderer | null = null
function show(queued: string[], raw: NativeChatMessage[]): void {
  act(() => {
    if (renderer === null) {
      renderer = create(createElement(Probe, { queued, raw }))
    } else {
      renderer.update(createElement(Probe, { queued, raw }))
    }
  })
}
const drawn = (): { text: string; after: string | null }[] =>
  latest.map((echo) => ({ text: echo.text, after: echo.baselineTailMessageId }))

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  latest = []
})

for (const [agent, box] of [
  ['Claude Code', claudeBox],
  ['Codex', codexBox]
] as const) {
  describe(`a desk message with the words of an earlier turn, on ${agent}`, () => {
    const u1 = user('u1', WORDS)
    const a1 = reply('a1')
    const a2 = reply('a2')

    it('reads the box it is fed', () => {
      expect(box([WORDS])).toEqual([WORDS])
      expect(box([])).toEqual([])
    })

    it('stays in the chat once the agent takes it, though an earlier turn had the same words', () => {
      show(box([WORDS]), [u1, a1])
      show(box([]), [u1, a1, a2])
      expect(drawn()).toEqual([{ text: WORDS, after: 'a1' }])
    })

    // The failure path: a message still queued when the turn ends is written
    // as a user row, after where it was sent. That row retires the echo, once.
    it('is retired by its own row once that lands after where it was sent, and drawn once', () => {
      show(box([WORDS]), [u1, a1])
      show(box([]), [u1, a1, a2])
      show(box([]), [u1, a1, a2, user('u3', WORDS)])
      expect(latest).toEqual([])
      show(box([]), [u1, a1, a2, user('u3', WORDS), reply('a4')])
      expect(latest).toEqual([])
    })

    it('draws no echo when the box lets it go in the same read its own row lands', () => {
      show(box([WORDS]), [u1, a1])
      show(box([]), [u1, a1, user('u2', WORDS)])
      expect(latest).toEqual([])
    })

    // The neighbouring checks: a reading cut short of a longer row, and a
    // reading that is several rows end to end, each met by earlier turns.
    it('stays when an earlier turn only begins with its words, and goes when a later row does', () => {
      const longer = user('u0', `${WORDS}\n\nthen run the tests`)
      show(box([WORDS]), [longer, a1])
      show(box([]), [longer, a1, a2])
      expect(drawn()).toEqual([{ text: WORDS, after: 'a1' }])
      show(box([]), [longer, a1, a2, user('u3', `${WORDS}\n\nthen run the tests`)])
      expect(latest).toEqual([])
    })

    it('stays when an earlier turn goes on from its words, and goes when a later row does', () => {
      const shorter = 'keep going with the task, please'
      const longer = user('u0', 'keep going with the task, please, and push it')
      show(box([shorter]), [longer, a1])
      show(box([]), [longer, a1, a2])
      expect(drawn()).toEqual([{ text: shorter, after: 'a1' }])
      show(box([]), [longer, a1, a2, user('u3', 'keep going with the task, please, and push it')])
      expect(latest).toEqual([])
    })

    it('stays when earlier turns end to end spell its words, and goes when later rows do', () => {
      const both = 'run the tests then fix what fails'
      const earlier = [user('u0', 'run the tests'), reply('a0'), user('u1', 'then fix what fails'), a1]
      show(box([both]), earlier)
      show(box([]), [...earlier, a2])
      expect(drawn()).toEqual([{ text: both, after: 'a1' }])
      show(box([]), [...earlier, a2, user('u3', 'run the tests'), user('u4', 'then fix what fails')])
      expect(latest).toEqual([])
    })
  })
}

describe('where the row it was sent after sits', () => {
  it('is the last row: drawn after it, then retired by a row of its words below it', () => {
    const rows = [user('u1', WORDS), reply('a1')]
    show(claudeBox([WORDS]), rows)
    show(claudeBox([]), rows)
    expect(drawn()).toEqual([{ text: WORDS, after: 'a1' }])
    show(claudeBox([]), [...rows, user('u2', WORDS)])
    expect(latest).toEqual([])
  })

  it('is the first row: drawn after it, then retired by a row of its words below it', () => {
    const rows = [reply('a1')]
    show(claudeBox([WORDS]), rows)
    show(claudeBox([]), [...rows, reply('a2')])
    expect(drawn()).toEqual([{ text: WORDS, after: 'a1' }])
    show(claudeBox([]), [...rows, reply('a2'), user('u3', WORDS)])
    expect(latest).toEqual([])
  })

  // A box read behind the transcript: the chat opened as Claude dequeued the
  // message at a turn's end, and the row it was dequeued as was already the
  // last row (mobile-chat-midturn-queue-box.test.ts has the overlay's side).
  // That row is its landing, first row or not. The same reads are two
  // messages of the same words sent with no row between, the second taken
  // mid-turn, and that one is not drawn: the words cannot tell them apart.
  it('is a row of its words: that row lands it, so it is drawn once, first row or not', () => {
    for (const rows of [[user('u1', WORDS)], [user('u0', WORDS), reply('a0'), user('u1', WORDS)]]) {
      show(claudeBox([WORDS]), rows)
      show(claudeBox([]), rows)
      expect(latest).toEqual([])
      show(claudeBox([]), [...rows, reply('a2')])
      expect(latest).toEqual([])
      act(() => renderer?.unmount())
      renderer = null
    }
  })

  // Paged out above the loaded window: every row held is after it, so a row
  // of its words there is its landing, as before this rule.
  it('is paged out: a row of its words in the window retires it, and none keeps it', () => {
    show(claudeBox([WORDS]), [user('u1', WORDS), reply('a1')])
    show(claudeBox([]), [user('u1', WORDS), reply('a1'), reply('a2')])
    show(claudeBox([]), [reply('a5'), reply('a6')])
    expect(drawn()).toEqual([{ text: WORDS, after: 'a1' }])
    show(claudeBox([]), [reply('a5'), reply('a6'), user('u7', WORDS)])
    expect(latest).toEqual([])
  })

  it('does not exist: an empty transcript holds nothing', () => {
    show(claudeBox([WORDS]), [])
    show(claudeBox([]), [])
    expect(latest).toEqual([])
  })
})
