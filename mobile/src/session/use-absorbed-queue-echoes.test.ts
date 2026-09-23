import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { useAbsorbedQueueEchoes } from './use-absorbed-queue-echoes'

function row(id: string, role: 'user' | 'assistant', text: string): NativeChatMessage {
  return { id, role, blocks: [{ type: 'text', text }], timestamp: 0, source: 'transcript' }
}

let latest: ReturnType<typeof useAbsorbedQueueEchoes> | null = null

function Probe({
  queued,
  folded,
  scopeKey = 'tab-a'
}: {
  queued: string[]
  folded: NativeChatMessage[]
  scopeKey?: string
}): null {
  latest = useAbsorbedQueueEchoes(queued, [], folded, scopeKey)
  return null
}

// 2026-09-13: a message typed on the desktop mid-turn vanished from the phone
// the moment Claude took it off its queue — the record it writes is one Orca's
// reader drops. The agent's own on-screen queue is the only witness a session
// already running has.
describe('messages absorbed off the agent queue', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    latest = null
  })

  it('keeps a queued message on screen once the agent takes it', () => {
    const folded = [row('u1', 'user', 'go'), row('a1', 'assistant', 'working')]
    act(() => {
      renderer = create(createElement(Probe, { queued: ['check the dock'], folded }))
    })
    expect(latest).toEqual([])

    act(() => {
      renderer!.update(createElement(Probe, { queued: [], folded }))
    })
    expect(latest).toMatchObject([{ text: 'check the dock', baselineTailMessageId: 'a1' }])

    // It stays put as the turn goes on.
    act(() => {
      renderer!.update(
        createElement(Probe, { queued: [], folded: [...folded, row('a2', 'assistant', 'more')] })
      )
    })
    expect(latest).toHaveLength(1)
  })

  it('drops it once the transcript shows it as a real user turn', () => {
    const folded = [row('a1', 'assistant', 'working')]
    act(() => {
      renderer = create(createElement(Probe, { queued: ['hello there'], folded }))
    })
    act(() => {
      renderer!.update(createElement(Probe, { queued: [], folded }))
    })
    expect(latest).toHaveLength(1)

    act(() => {
      renderer!.update(
        createElement(Probe, { queued: [], folded: [...folded, row('u2', 'user', 'hello there')] })
      )
    })
    expect(latest).toEqual([])
  })

  it('forgets everything when the tab changes', () => {
    const folded = [row('a1', 'assistant', 'working')]
    act(() => {
      renderer = create(createElement(Probe, { queued: ['one'], folded }))
    })
    act(() => {
      renderer!.update(createElement(Probe, { queued: [], folded }))
    })
    expect(latest).toHaveLength(1)
    act(() => {
      renderer!.update(createElement(Probe, { queued: [], folded, scopeKey: 'tab-b' }))
    })
    expect(latest).toEqual([])
  })
})

// 2026-09-13: three prompts sent one after another stacked with nothing
// between them, because a folded run is a single row and every echo anchored
// to it. The raw tail moves with each tool result, so each echo gets its own
// fold boundary and the work between them shows.
it('anchors each absorbed message to the raw record, not the folded run', () => {
  const folded = [row('a1', 'assistant', 'working')]
  const raw = [row('a1', 'assistant', 'working'), row('a2', 'assistant', 'tool')]
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(
      createElement(ProbeRaw, { queued: ['first'], folded, raw })
    )
  })
  act(() => {
    renderer!.update(createElement(ProbeRaw, { queued: [], folded, raw }))
  })
  expect(latest).toMatchObject([{ baselineTailMessageId: 'a2' }])
  act(() => renderer!.unmount())
})

function ProbeRaw({
  queued,
  folded,
  raw
}: {
  queued: string[]
  folded: NativeChatMessage[]
  raw: NativeChatMessage[]
}): null {
  latest = useAbsorbedQueueEchoes(queued, [], folded, 'tab-a', raw)
  return null
}

// The same array back while nothing changed: this runs on every status-line
// repaint, and a fresh copy each time refolded the whole chat downstream
// (2026-09-13). Driven by the queue box now that the scrollback witness is gone.
it('returns the same array while nothing changed', () => {
  const folded = [row('a1', 'assistant', 'working')]
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(createElement(Probe, { queued: ['hold this'], folded }))
  })
  const first = latest
  act(() => {
    renderer!.update(createElement(Probe, { queued: ['hold this'], folded }))
  })
  expect(latest).toBe(first)
  act(() => renderer!.unmount())
})


// REMOVED 2026-09-15, with the scrollback witness they exercised:
//
//   holds a prompt the agent already printed, without it ever being queued
//   shows one bubble however the same message was wrapped or marked
//   skips a prompt the phone itself sent or the hook already delivered
//   draws a desktop message without the image markers the phone cannot show
//   grows a truncated queue entry into the full message and retires it once landed
//   retires a reading that stopped short of the row that landed
//   waits for a transcript row before holding anything, so nothing pins to the bottom
//   does not stack the scrollback backlog as bubbles when the chat opens
//   keeps a held message when a later prompt merely starts with the same words
//   holds the newest unlanded prompt from the first reading, but never the backlog behind it
//   skips a reading that only glues rows onto one of the phone's own sends
//   retires a held reading once the row it was read from lands, even shortened
//   retires a reading that is LONGER than the row it landed as
//   keeps a held reading that a later, longer message merely extends
//
// They drove prompts read out of the agent's SCROLLBACK, which is gone: a queued
// prompt lands as a real user row now, so the witness was inventing a second
// copy of a message the phone already had. Evidence and the new contract are in
// mobile-scrollback-prompt-witness.test.ts.
//
// The RULES they carried are not lost. Retirement against a row that extends a
// reading is pinned in mobile-native-chat-stub-retirement.test.ts; retirement of
// a reading longer than its row, in mobile-native-chat-glued-echo-retirement.ts;
// image markers, in mobile-terminal-prompt-images.test.ts and
// mobile-desktop-image-placeholders.test.ts; anchoring and tab scoping, by the
// queue-box tests still in this file.

// 2026-09-19: a message sent from the phone with three photos, while the agent
// was busy, drew TWICE — the phone's own bubble, then a second one with three
// "Image on Desktop" chips, no backticks, no blank lines and hard wraps at the
// terminal's width. Claude Code paints a queued prompt as rendered markdown:
// inline code loses its backticks (queue box captured on Claude Code 2.1.278
// at 46 columns, below, verbatim). The typed text keeps them, so the witness's
// key and the own send's key never met, and the own send came back as a
// "new" absorbed message built from the painted rows.
it('does not redraw a phone send with inline code when the queue box paints it without the backticks', () => {
  const typed =
    'Left as is. For the record only: the fired wakeup is written as a `user` row with `turnOrigin: "scheduled"` (a human message carries `turnOrigin: "human"`), so that field is the switch. The loop still fires at 23:57.'
  // `claudeQueueViewFromScreen` joins the wrapped rows with '\n', markers intact.
  const painted = [
    '[Image #37] [Image #38] [Image #39] Left as is. For the record only: the fired',
    'wakeup is written as a user row with',
    'turnOrigin: "scheduled" (a human message',
    'carries turnOrigin: "human"), so that field',
    'is the switch. The loop still fires at',
    '23:57.'
  ].join('\n')
  const folded = [row('a1', 'assistant', 'working')]
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(createElement(ProbeOwn, { queued: [painted], folded, own: [typed] }))
  })
  act(() => {
    renderer!.update(createElement(ProbeOwn, { queued: [], folded, own: [typed] }))
  })
  expect(latest).toEqual([])
  act(() => renderer!.unmount())
})

function ProbeOwn({
  queued,
  folded,
  own
}: {
  queued: string[]
  folded: NativeChatMessage[]
  own: string[]
}): null {
  latest = useAbsorbedQueueEchoes(queued, [], folded, 'tab-a', folded, own)
  return null
}

// 2026-09-23: a message typed on the desktop mid-turn is drawn where it was
// SENT — the row that was last when it first showed in the agent's queue box —
// not where the agent took it. The Claude app draws it there, with the calls
// that ran while it waited below it, and the user chose that order.
describe('where a queued desktop message is drawn', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    latest = null
  })
  const a1 = row('a1', 'assistant', 'working')
  const a2 = row('a2', 'assistant', 'Created a file')
  const a3 = row('a3', 'assistant', 'ran a command')

  it('sits after the row that was last when it appeared, with the calls that ran while it waited below it', () => {
    act(() => {
      renderer = create(createElement(ProbeRaw, { queued: [], folded: [a1], raw: [a1] }))
    })
    act(() => {
      renderer!.update(createElement(ProbeRaw, { queued: ['check the dock'], folded: [a1], raw: [a1] }))
    })
    act(() => {
      renderer!.update(createElement(ProbeRaw, { queued: ['check the dock'], folded: [a1], raw: [a1, a2, a3] }))
    })
    act(() => {
      renderer!.update(createElement(ProbeRaw, { queued: [], folded: [a1], raw: [a1, a2, a3] }))
    })
    expect(latest).toMatchObject([{ text: 'check the dock', baselineTailMessageId: 'a1' }])
  })

  it('keeps its first sighting while the queue box grows the text from a stub', () => {
    act(() => {
      renderer = create(createElement(ProbeRaw, { queued: [], folded: [a1], raw: [a1] }))
    })
    act(() => {
      renderer!.update(createElement(ProbeRaw, { queued: ['check the…'], folded: [a1], raw: [a1] }))
    })
    act(() => {
      renderer!.update(createElement(ProbeRaw, { queued: ['check the dock please'], folded: [a1], raw: [a1, a2] }))
    })
    act(() => {
      renderer!.update(createElement(ProbeRaw, { queued: [], folded: [a1], raw: [a1, a2, a3] }))
    })
    expect(latest).toMatchObject([{ baselineTailMessageId: 'a1' }])
  })

  it('anchors a message already queued when the phone first looked at the row that was last then', () => {
    act(() => {
      renderer = create(createElement(ProbeRaw, { queued: ['check the dock'], folded: [a1], raw: [a1, a2] }))
    })
    act(() => {
      renderer!.update(createElement(ProbeRaw, { queued: ['check the dock'], folded: [a1], raw: [a1, a2, a3] }))
    })
    act(() => {
      renderer!.update(createElement(ProbeRaw, { queued: [], folded: [a1], raw: [a1, a2, a3] }))
    })
    expect(latest).toMatchObject([{ baselineTailMessageId: 'a2' }])
  })
})
