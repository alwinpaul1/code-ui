// A confirmed `!` message lands in the transcript as `<bash-input>cmd</bash-input>`, which
// the chat draws as the user's turn `!cmd` (mobile-native-chat-shell-command-turns.ts). That was
// done only where the chat is DRAWN. Everything that decides whether the phone's own copy of the
// send has landed (retiring the pending bubble, the unconfirmed-send hold, the glue retirement)
// reads the session's messages, where the turn was still `<bash-input>…`: so the transcript
// row was drawn AND the pending copy never retired (two bubbles), and a send held as
// unconfirmed never saw its own echo. The session now hands out the surfaced turn, once, upstream
// of the render and of every reconciler.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { findLandedUnconfirmedSends } from './mobile-native-chat-draft-reconcile'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import { retireLandedMobileNativeChatPending } from './mobile-native-chat-pending-retirement'

const mocks = vi.hoisted(() => ({ bridge: [] as unknown[], structured: [] as unknown[] }))
vi.mock('../transport/client-context-connection-metrics', () => ({ useLastConnectedAt: () => null }))
vi.mock('./use-mobile-native-chat-session', () => ({
  useMobileNativeChatSession: () => ({ messages: mocks.bridge, status: 'ready' })
}))
vi.mock('./use-mobile-structured-agent-session', () => ({
  useMobileStructuredAgentSession: () => ({ session: { messages: mocks.structured, status: 'ready' } })
}))

const { useMobileNativeChatSessionLane } = await import('./use-mobile-native-chat-session-lane')

const row = (id: string, role: 'user' | 'assistant', text: string): NativeChatMessage => ({
  id,
  role,
  blocks: [{ type: 'text', text }],
  timestamp: 1,
  source: 'transcript'
})
const textOf = (message: NativeChatMessage): string =>
  message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')

const TRANSCRIPT = [
  row('m0', 'assistant', 'Done.'),
  row('m1', 'user', '<bash-input>ls -la</bash-input>'),
  row('m2', 'user', '<bash-stdout>file</bash-stdout><bash-stderr></bash-stderr>')
]

function pendingSend(text: string): MobileNativeChatPendingMessage {
  return {
    id: 'pending-1',
    text,
    draftKey: 'd',
    draftEditGeneration: 0,
    pendingKey: 'k',
    normalizedText: text,
    baselineOccurrences: 0,
    expectedOccurrence: 1,
    baselineTailMessageId: 'm0',
    baselineResolved: true
  } as MobileNativeChatPendingMessage
}

const structuredMessages = [row('s', 'user', '<bash-input>ls</bash-input>')]

describe('the messages the chat lane hands out', () => {
  let renderer: ReactTestRenderer | null = null
  let lane: ReturnType<typeof useMobileNativeChatSessionLane> | null = null
  let transcript: NativeChatMessage[] = TRANSCRIPT
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    lane = null
    transcript = TRANSCRIPT
  })
  function Harness({ structured, tick }: { structured: boolean; tick: number }): null {
    void tick
    lane = useMobileNativeChatSessionLane({
      client: null,
      structured,
      agent: null,
      resolvedAgent: 'claude',
      transcriptPath: null,
      sessionId: 'session-1',
      sourceIdentity: 'host-1',
      callerIdentity: 'device',
      enabled: true,
      connState: 'connected',
      onSendError: vi.fn()
    })
    return null
  }
  const mount = (structured = false): void => {
    mocks.bridge = transcript
    mocks.structured = structuredMessages
    act(() => {
      renderer = create(createElement(Harness, { structured, tick: 0 }))
    })
  }

  it('carry a shell command as the turn the phone sent, `!cmd`, not as its envelope', () => {
    mount()
    expect(lane!.session.messages.map(textOf)).toEqual([
      'Done.',
      '!ls -la',
      '<bash-stdout>file</bash-stdout><bash-stderr></bash-stderr>'
    ])
  })

  it('keep one identity across a re-render, so no effect downstream reruns for nothing', () => {
    mount()
    const first = lane!.session.messages
    act(() => renderer!.update(createElement(Harness, { structured: false, tick: 1 })))
    expect(lane!.session.messages).toBe(first)
  })

  it('are the very list the session gave when nothing in it is a shell command', () => {
    const plain = [row('a', 'assistant', 'hi'), row('b', 'user', 'hello')]
    transcript = plain
    mount()
    expect(lane!.session.messages).toBe(plain)
  })

  it('leave a structured session alone: its sends go to the API, not a terminal', () => {
    mount(true)
    expect(lane!.session.messages).toBe(structuredMessages)
  })
})

describe('the phone’s own copy of a confirmed shell command', () => {
  const surfaced = (): NativeChatMessage[] => [
    TRANSCRIPT[0]!,
    { ...TRANSCRIPT[1]!, blocks: [{ type: 'text', text: '!ls -la' }] },
    TRANSCRIPT[2]!
  ]

  it('retires against the surfaced turn, so the command draws once', () => {
    expect(retireLandedMobileNativeChatPending(surfaced(), [pendingSend('!ls -la')], new Set())).toEqual([])
  })

  it('stays pending against the raw envelope, which is why the session surfaces it', () => {
    expect(retireLandedMobileNativeChatPending(TRANSCRIPT, [pendingSend('!ls -la')], new Set())).toHaveLength(1)
  })

  it('is seen to land by the unconfirmed-send hold', () => {
    const entry = {
      id: 'u',
      text: '!ls -la',
      normalizedText: '!ls -la',
      baselineTailMessageId: 'm0',
      draftKey: 'd',
      pendingKey: 'k',
      deadline: null
    }
    expect(findLandedUnconfirmedSends(surfaced(), [entry as never])).toHaveLength(1)
    expect(findLandedUnconfirmedSends(TRANSCRIPT, [entry as never])).toHaveLength(0)
  })

  it('draws the command once, whether or not the render surfaces it again', () => {
    const drawn = foldMobileNativeChatMessages(surfaced()).filter((message) => message.role === 'user')
    expect(drawn.map(textOf)).toEqual(['!ls -la'])
  })
})
