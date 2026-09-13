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

// 2026-09-13: a prompt taken between two tool calls never renders as queued,
// so the queue witness misses it entirely. The agent prints it into its
// scrollback instead, and that row is the only thing left to read.
it('holds a prompt the agent already printed, without it ever being queued', () => {
  const folded = [row('a1', 'assistant', 'working')]
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(createElement(ProbeSent, { sent: ['bump the version'], folded }))
  })
  expect(latest).toMatchObject([{ text: 'bump the version' }])

  // And it goes when the transcript finally carries it.
  act(() => {
    renderer!.update(
      createElement(ProbeSent, {
        sent: ['bump the version'],
        folded: [...folded, row('u2', 'user', 'bump the version')]
      })
    )
  })
  expect(latest).toEqual([])
  act(() => renderer!.unmount())
})

function ProbeSent({ sent, folded }: { sent: string[]; folded: NativeChatMessage[] }): null {
  latest = useAbsorbedQueueEchoes([], sent, folded, 'tab-a', folded)
  return null
}

// 2026-09-13: the same message showed twice — the queue box and the scrollback
// wrapped it differently, and only the transcript carried its image markers.
it('shows one bubble however the same message was wrapped or marked', () => {
  const folded = [row('a1', 'assistant', 'working')]
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(
      createElement(ProbeBoth, {
        queued: ['fix the duplicate\n\nplease'],
        sent: ['fix the duplicate please'],
        folded
      })
    )
  })
  act(() => {
    renderer!.update(
      createElement(ProbeBoth, { queued: [], sent: ['fix the duplicate please'], folded })
    )
  })
  expect(latest).toHaveLength(1)

  // The transcript row carries the marker; it still retires the echo.
  act(() => {
    renderer!.update(
      createElement(ProbeBoth, {
        queued: [],
        sent: ['fix the duplicate please'],
        folded: [...folded, row('u2', 'user', '[Image #1] fix the duplicate please')]
      })
    )
  })
  expect(latest).toEqual([])
  act(() => renderer!.unmount())
})

function ProbeBoth({
  queued,
  sent,
  folded
}: {
  queued: string[]
  sent: string[]
  folded: NativeChatMessage[]
}): null {
  latest = useAbsorbedQueueEchoes(queued, sent, folded, 'tab-a', folded)
  return null
}

// 2026-09-13: a prompt sent from the phone is painted into the scrollback like
// any other, and came back as a second bubble under the phone's own echo. The
// same for a desktop prompt the hook had already delivered.
it('skips a prompt the phone itself sent or the hook already delivered', () => {
  const folded = [row('a1', 'assistant', 'working')]
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(
      createElement(ProbeOwn, {
        sent: ['[Image #85] See this', 'a desktop prompt', 'a real absorbed one'],
        own: ['See this', 'a desktop\nprompt'],
        folded
      })
    )
  })
  expect(latest).toMatchObject([{ text: 'a real absorbed one' }])
  act(() => renderer!.unmount())
})

function ProbeOwn({
  sent,
  own,
  folded
}: {
  sent: string[]
  own: string[]
  folded: NativeChatMessage[]
}): null {
  latest = useAbsorbedQueueEchoes([], sent, folded, 'tab-a', folded, own)
  return null
}

// 2026-09-13: a desktop message with pasted screenshots was drawn as
// "[Image #96] [Image #97] See this tooo"; the phone has no bytes for those.
it('draws a desktop message without the image markers the phone cannot show', () => {
  const folded = [row('a1', 'assistant', 'working')]
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(
      createElement(ProbeOwn, { sent: ['[Image #96] [Image #97] See this tooo'], own: [], folded })
    )
  })
  expect(latest).toMatchObject([{ text: 'See this tooo' }])
  act(() => renderer!.unmount())
})

// 2026-09-13: Claude's queue box cuts a long entry short with an ellipsis, so
// the phone drew "…see this and…" and never matched it to the full message
// the scrollback and the transcript carried.
it('grows a truncated queue entry into the full message and retires it once landed', () => {
  const folded = [row('a1', 'assistant', 'working')]
  const full = 'Too much rubbish and jargon happening in chatui of code ui see this and some times chat ui flashes'
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(
      createElement(ProbeBoth, {
        queued: ['Too much rubbish and jargon happening in chatui of code ui see this and…'],
        sent: [],
        folded
      })
    )
  })
  act(() => {
    renderer!.update(createElement(ProbeBoth, { queued: [], sent: [full], folded }))
  })
  expect(latest).toMatchObject([{ text: full }])
  act(() => {
    renderer!.update(
      createElement(ProbeBoth, {
        queued: [],
        sent: [full],
        folded: [...folded, row('u2', 'user', `[Image #90] ${full}`)]
      })
    )
  })
  expect(latest).toEqual([])
  act(() => renderer!.unmount())
})
