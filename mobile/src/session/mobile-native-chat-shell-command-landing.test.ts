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
import type {
  NativeChatToolCallBlock,
  NativeChatToolResultBlock
} from '../../../src/shared/native-chat-types'
import { CREATED_A_FILE_RUN } from './fixtures/claude-edit-runs-2.1.282'
import { cutCreateOf, cutCreateStandings } from './mobile-native-chat-created-file-count'
import { findLandedUnconfirmedSends } from './mobile-native-chat-draft-reconcile'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import type { MobileNativeChatPendingMessage } from './mobile-native-chat-pending-echo'
import { surfaceShellCommandTurns } from './mobile-native-chat-shell-command-turns'
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

// The created-file count marks a create "touched" when a later command may have changed its file,
// and it reads the user's own `!` commands from the SAME list (CreatedFileCountProvider is fed
// the lane's messages). The lane hands out the surfaced `!cmd`, so the count must read that shape
// as well as the raw envelope, or the agent's create is counted as untouched after the user ran
// `!echo x >> file`, and the chat shows a wrong `+N`.
const WRITE = CREATED_A_FILE_RUN[0] as NativeChatToolCallBlock
const WRITE_RESULT = CREATED_A_FILE_RUN[1] as NativeChatToolResultBlock
const CREATE_KEY = cutCreateOf(WRITE, WRITE_RESULT)!.key
const CREATED_PATH = 'hybrid-model/scripts/cluster/jobs/queue-sweep-k-one.sh'
const CREATE_ROWS: NativeChatMessage[] = [
  { id: 'c1', role: 'assistant', blocks: [WRITE], timestamp: 1, source: 'transcript' },
  { id: 'c2', role: 'user', blocks: [WRITE_RESULT], timestamp: 1, source: 'transcript' }
]

describe('the created-file count, through the lane', () => {
  let renderer: ReactTestRenderer | null = null
  let lane: ReturnType<typeof useMobileNativeChatSessionLane> | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    lane = null
  })
  function Harness(): null {
    lane = useMobileNativeChatSessionLane({
      client: null,
      structured: false,
      agent: null,
      resolvedAgent: 'claude',
      transcriptPath: null,
      sessionId: 'session-1',
      sourceIdentity: 'host-1',
      enabled: true,
      connState: 'connected',
      onSendError: vi.fn()
    })
    return null
  }
  const touchedAfter = (command: string): boolean | undefined => {
    mocks.bridge = [...CREATE_ROWS, row('u', 'user', `<bash-input>${command}</bash-input>`)]
    act(() => {
      renderer = create(createElement(Harness))
    })
    return cutCreateStandings(lane!.session.messages).get(CREATE_KEY)?.touched
  }

  it.each([
    ['appends to the file', `echo '# tuned' >> ${CREATED_PATH}`],
    ['edits it in place by its name', "sed -i '' 's/a/b/' queue-sweep-k-one.sh"]
  ])('is told the create was touched by a `!` command that %s', (_name, command) => {
    expect(touchedAfter(command)).toBe(true)
  })

  it('still counts a create after a `!` command that names another file', () => {
    expect(touchedAfter('npm test -- sweep.test.ts')).toBe(false)
  })

  // The desktop's own `!cmd` (a turn typed on the desk) is the same envelope, surfaced the same way.
  it('reads the surfaced turn the same whether the phone or the desk ran it', () => {
    const surfaced = surfaceShellCommandTurns([row('d', 'user', `<bash-input>echo x >> ${CREATED_PATH}</bash-input>`)])
    expect(cutCreateStandings([...CREATE_ROWS, ...surfaced]).get(CREATE_KEY)?.touched).toBe(true)
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
