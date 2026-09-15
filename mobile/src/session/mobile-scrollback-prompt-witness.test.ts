import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { useAbsorbedQueueEchoes } from './use-absorbed-queue-echoes'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'

/**
 * Why the scrollback witness is gone.
 *
 * It existed because "a prompt submitted while a turn is running is written to
 * the transcript as an `attachment`/`queued_command` record, and Orca's reader
 * has no code for that type at all, so the phone never receives it" — verified
 * against Claude Code on 2026-09-13.
 *
 * That is no longer true. On 2.1.272 a queued prompt lands as an ordinary `user`
 * row carrying `promptSource: "queued"`, which the phone already reads. The
 * witness was then inventing a SECOND copy of a message the phone already had,
 * built by guessing which two-space rows belonged to the prompt — and the
 * agent's own prose sits on rows of exactly that shape. Hence a bubble ending in
 * the agent's "session:ok" (2026-09-15, reported as a leak), prompts glued to
 * replies, paragraphs lost, and image markers stripped.
 */
const LIVE_TRANSCRIPT =
  '/Users/alwinpaul/.claude-work/projects/-Users-alwinpaul-Desktop-NexDash-NexOS/63b835a8-569c-4711-938d-7871059b4698.jsonl'

describe('the evidence that a queued prompt reaches the phone on its own', () => {
  it('records every queued prompt as a plain user row', () => {
    let raw: string
    try {
      raw = readFileSync(LIVE_TRANSCRIPT, 'utf8')
    } catch {
      // The capture belongs to one machine; the shape it proved is pinned by the
      // behaviour tests below, which need no file.
      return
    }
    const queued = raw
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>
        } catch {
          return null
        }
      })
      .filter((row): row is Record<string, unknown> => row?.type === 'user')
      .filter((row) => row.promptSource === 'queued')
    expect(queued.length).toBeGreaterThan(0)
    for (const row of queued) {
      // A real row, with the user's text on it — not an attachment the phone
      // cannot read. Content is a bare string, or blocks when the prompt
      // carried an image.
      const content = (row.message as { content?: unknown })?.content
      const text =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content
                .map((block) =>
                  typeof (block as { text?: unknown })?.text === 'string'
                    ? (block as { text: string }).text
                    : ''
                )
                .join('')
            : ''
      expect(text.length).toBeGreaterThan(0)
      expect(row.uuid).toBeTruthy()
    }
  })
})

function user(id: string, text: string): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }], timestamp: 0, source: 'transcript' } as NativeChatMessage
}

let latest: MobileNativeChatPendingMessage[] = []
function Probe({
  queued,
  sent,
  messages,
  scopeKey = 'scope'
}: {
  queued: string[]
  sent: string[]
  messages: NativeChatMessage[]
  // Distinct per test: the hook holds echoes per scope, and a shared key let one
  // test's entry show up in the next.
  scopeKey?: string
}) {
  latest = useAbsorbedQueueEchoes(queued, sent, messages, scopeKey, messages, [])
  return null
}

describe('what the phone draws from the agent’s screen', () => {
  let renderer: ReactTestRenderer | null = null
  function render(queued: string[], sent: string[], messages: NativeChatMessage[]) {
    act(() => {
      // update, not create: the hook holds its state in refs, and remounting
      // would throw away the very thing under test.
      if (renderer) {
        renderer.update(createElement(Probe, { queued, sent, messages }))
      } else {
        renderer = create(createElement(Probe, { queued, sent, messages }))
      }
    })
  }
  function unmount() {
    act(() => renderer?.unmount())
    renderer = null
  }

  it('draws nothing from the scrollback, however it reads', () => {
    // The exact shape that leaked: a prompt with the agent's reply glued on.
    render(
      [],
      ["1050 is daimler thingy I can't confirm it from here: the raw series. session:ok"],
      [user('m1', 'earlier')]
    )
    expect(latest).toEqual([])
    unmount()
  })

  it('draws nothing from the scrollback even for a clean reading', () => {
    render([], ['a perfectly ordinary prompt'], [user('m1', 'earlier')])
    expect(latest).toEqual([])
    unmount()
  })

  it('still holds an entry that left the agent’s own queue box', () => {
    // The queue box is a different witness: short entries the agent lists for
    // itself, not prose guessed out of the scrollback. It is kept.
    render(['queued one'], [], [user('m1', 'earlier')])
    render([], [], [user('m1', 'earlier')])
    expect(latest.map((echo) => echo.text)).toEqual(['queued one'])
    unmount()
  })

  it('lets that entry go when its transcript row lands', () => {
    render(['queued one'], [], [user('m1', 'earlier')])
    render([], [], [user('m1', 'earlier')])
    expect(latest).toHaveLength(1)
    render([], [], [user('m1', 'earlier'), user('m2', 'queued one')])
    expect(latest).toEqual([])
    unmount()
  })
})

// Reported 2026-09-15: a queued prompt carrying two desktop images showed
// neither picture nor the "Image on Desktop" placeholder. The transcript row for
// it (uuid 1ee16007, promptSource "queued") holds text WITH the markers plus two
// inline image blocks the phone has no bytes for, and the renderer turns those
// markers into the placeholder correctly — but while the prompt is still in the
// agent's queue box the phone draws THIS echo instead, and it stripped them.
//
// Third place this same strip has been found: the screen reader, the landed
// transcript row, and now here.
describe('a queued entry that carried images', () => {
  let renderer: ReactTestRenderer | null = null
  let scope = 0
  function fresh() {
    scope += 1
  }
  function render(queued: string[], messages: NativeChatMessage[]) {
    const scopeKey = `queued-scope-${scope}`
    act(() => {
      if (renderer) {
        renderer.update(createElement(Probe, { queued, sent: [], messages, scopeKey }))
      } else {
        renderer = create(createElement(Probe, { queued, sent: [], messages, scopeKey }))
      }
    })
  }

  it('keeps the markers so the bubble can say an image was sent', () => {
    fresh()
    const messages = [user('m1', 'earlier')]
    render(['pull from main [Image #196] still charging [Image #197]'], messages)
    render([], messages)
    expect(latest).toHaveLength(1)
    expect(latest[0]!.text).toContain('[Image #196]')
    expect(latest[0]!.text).toContain('[Image #197]')
    act(() => renderer?.unmount())
    renderer = null
  })

  it('still retires against the row that lands, markers and all', () => {
    fresh()
    const messages = [user('m1', 'earlier')]
    render(['look at this [Image #5]'], messages)
    render([], messages)
    expect(latest).toHaveLength(1)
    render([], [...messages, user('m2', 'look at this [Image #5]')])
    expect(latest).toEqual([])
    act(() => renderer?.unmount())
    renderer = null
  })

  it('leaves an entry with no image exactly as it was', () => {
    fresh()
    const messages = [user('m1', 'earlier')]
    render(['just words'], messages)
    render([], messages)
    expect(latest[0]!.text).toBe('just words')
    act(() => renderer?.unmount())
    renderer = null
  })
})
