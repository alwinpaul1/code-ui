import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { clearNativeChatDraftStores } from './native-chat-draft-store.test-support'
import { rebaseMobileNativeChatPendingBaselines } from './mobile-native-chat-pending-baseline'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import { retireLandedMobileNativeChatPending } from './mobile-native-chat-pending-retirement'
import {
  buildMobileNativeChatTransientData,
  foldMobileNativeChatMessages,
  pendingFoldBoundaries
} from './mobile-native-chat-render-data'
import { useMobileNativeChatDrafts } from './use-mobile-native-chat-drafts'

// Real transcript row shapes, as Orca's reader hands them to the phone: a text
// turn is one text block, and Claude records an attached image as its own
// `[Image: source: /path]` user turn (see `native-chat-image-transcript-markers`,
// and the same fixtures in `use-mobile-native-chat-drafts-glued-pending.test.ts`).
function row(id: string, role: 'user' | 'assistant', text: string): NativeChatMessage {
  return { id, role, blocks: [{ type: 'text', text }], timestamp: 1, source: 'transcript' }
}

function imageTurn(id: string, path: string): NativeChatMessage {
  return {
    id,
    role: 'user',
    blocks: [{ type: 'text', text: `[Image: source: ${path}]` }],
    timestamp: 1,
    source: 'transcript'
  }
}

/** What `captureSendOrigin` produces for a send made while the first read is
 *  still in flight: the phone holds no rows, so it captures no tail, and it
 *  knows the list it is looking at is not this session's settled history. */
function sentWhileLoading(
  id: string,
  text: string,
  images?: string[]
): MobileNativeChatPendingMessage {
  return {
    id,
    text,
    expectedOccurrence: 1,
    baselineTailMessageId: null,
    baselineResolved: false,
    ...(images ? { images } : {})
  }
}

// The transcript the first settled read returns. The agent is mid-turn, so the
// phone's send rode in as a `queued_command` and has no row of its own.
const settledRead = [
  row('m1', 'user', 'refactor the parser'),
  row('m2', 'assistant', 'starting on it'),
  row('m3', 'assistant', 'renamed two helpers')
]
const laterTurns = [
  ...settledRead,
  row('m4', 'assistant', 'tests green'),
  row('m5', 'assistant', 'anything else?')
]

function render(messages: NativeChatMessage[], pending: MobileNativeChatPendingMessage[]): string[] {
  const folded = foldMobileNativeChatMessages(messages, pendingFoldBoundaries(pending))
  const { data } = buildMobileNativeChatTransientData({
    messages,
    folded,
    streaming: null,
    pending
  })
  return data.map((message) => message.id)
}

describe('a photo sent before the transcript had loaded', () => {
  it('stays where it was sent instead of sinking below every later reply', () => {
    const rebased = rebaseMobileNativeChatPendingBaselines(settledRead, [
      sentWhileLoading('p1', '', ['file:///data/photo.jpg'])
    ])
    expect(render(settledRead, rebased)).toEqual(['m1', 'm2', 'm3', 'p1'])
    expect(render(laterTurns, rebased)).toEqual(['m1', 'm2', 'm3', 'p1', 'm4', 'm5'])
  })

  it('keeps a captioned photo above the replies that answered it', () => {
    const rebased = rebaseMobileNativeChatPendingBaselines(settledRead, [
      sentWhileLoading('p1', 'what is wrong with this screen?', ['file:///data/photo.jpg'])
    ])
    expect(render(laterTurns, rebased)).toEqual(['m1', 'm2', 'm3', 'p1', 'm4', 'm5'])
  })

  it('does not stack a text send and a photo together at the bottom', () => {
    const rebased = rebaseMobileNativeChatPendingBaselines(settledRead, [
      sentWhileLoading('p1', 'also check the wrap column'),
      sentWhileLoading('p2', '', ['file:///data/photo.jpg'])
    ])
    expect(render(laterTurns, rebased)).toEqual(['m1', 'm2', 'm3', 'p1', 'p2', 'm4', 'm5'])
  })

  it('still retires once its image turn lands, rather than trading one bug for another', () => {
    const rebased = rebaseMobileNativeChatPendingBaselines(settledRead, [
      sentWhileLoading('p1', 'what is wrong with this screen?', ['file:///data/photo.jpg'])
    ])
    // Placement must not become a reconcile boundary: the drawn anchor is set,
    // the counted one is still withheld.
    expect(rebased[0]?.placementAnchorId).toBe('m3')
    expect(rebased[0]?.baselineTailMessageId).toBeNull()

    const landed = [
      ...settledRead,
      imageTurn('m4', '/var/tmp/photo.jpg'),
      row('m5', 'user', '[Image #1] what is wrong with this screen?')
    ]
    expect(retireLandedMobileNativeChatPending(landed, rebased, new Set())).toEqual([])
  })
})

describe('a message sent into a conversation that really was empty', () => {
  it('stays above the reply it asked for instead of below it', () => {
    // Captured against a SETTLED empty read: nothing came before it, so
    // everything that has landed since came after it.
    const pending: MobileNativeChatPendingMessage[] = [
      {
        id: 'p1',
        text: 'read the crash log',
        expectedOccurrence: 1,
        baselineTailMessageId: null,
        baselineResolved: true
      }
    ]
    expect(render([row('a1', 'assistant', 'on it')], pending)).toEqual(['p1', 'a1'])
  })
})

describe('a send whose position is still unknown', () => {
  it('waits at the tail rather than jumping to the top of the conversation', () => {
    // One frame sits between the settled read committing and the rebase effect
    // running. Moving the bubble to the top for it would shove the whole list.
    expect(render(settledRead, [sentWhileLoading('p1', 'hold on')])).toEqual([
      'm1',
      'm2',
      'm3',
      'p1'
    ])
  })
})

type DraftState = ReturnType<typeof useMobileNativeChatDrafts>
type TestRenderer = { unmount(): void; update(element: ReturnType<typeof createElement>): void }

describe('the app opened, a photo sent straight away, then the transcript arrived', () => {
  let renderer: TestRenderer | null = null
  let state: DraftState | null = null

  afterEach(async () => {
    act(() => renderer?.unmount())
    renderer = null
    state = null
    await clearNativeChatDraftStores()
  })

  function Harness({
    messages,
    transcriptLoading
  }: {
    messages: NativeChatMessage[]
    transcriptLoading: boolean
  }): null {
    state = useMobileNativeChatDrafts({
      hostId: 'host',
      worktreeId: 'worktree',
      tabId: 'tab',
      sessionId: 'session',
      messages,
      transcriptLoading,
      transcriptSettled: !transcriptLoading
    })
    return null
  }

  it('draws the photo where it was sent once the replies start landing', async () => {
    await act(async () => {
      renderer = create(createElement(Harness, { messages: [], transcriptLoading: true }))
    })
    act(() => {
      const origin = state?.captureSendOrigin('')
      if (origin) {
        state?.acceptSend(origin, '', ['file:///data/photo.jpg'])
      }
    })
    await act(async () =>
      renderer?.update(createElement(Harness, { messages: settledRead, transcriptLoading: false }))
    )
    await act(async () =>
      renderer?.update(createElement(Harness, { messages: laterTurns, transcriptLoading: false }))
    )
    const pending = state?.pending ?? []
    expect(pending).toHaveLength(1)
    expect(render(laterTurns, pending)).toEqual(['m1', 'm2', 'm3', pending[0]!.id, 'm4', 'm5'])
  })
})
