import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileNativeChatView } from './MobileNativeChatView'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'

vi.mock('../components/ImagePreviewModal', () => ({ ImagePreviewModal: () => null }))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path', Defs: 'Defs', LinearGradient: 'LinearGradient', Rect: 'Rect', Stop: 'Stop' }))
vi.mock('../hooks/use-now', () => ({ useNow: () => 0 }))
// The system interrupting a touch is not what these tests are about; see
// use-mobile-native-chat-tail-follow.settle.test.ts for that.
vi.mock('./use-app-interruptions', () => ({ useAppInterruptions: () => undefined }))
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Animated: {
    View: 'AnimatedView',
    createAnimatedComponent: (c: unknown) => c,
    Value: class {
      interpolate() {
        return 0
      }
    },
    loop: () => ({ start: () => {}, stop: () => {} }),
    timing: () => ({}),
    sequence: () => ({})
  },
  Easing: { linear: 0, quad: 0, inOut: () => 0, out: () => 0 },
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  // The list sizes its render-ahead window from the screen, so the stub has to
  // report one — a Galaxy S23's 2316px at density 2.8125.
  useWindowDimensions: () => ({ height: 823, width: 384, scale: 2.8125, fontScale: 1 }),
  View: 'View'
}))

vi.mock('@shopify/flash-list', () => ({ FlashList: 'FlashList' }))

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}))

vi.mock('react-native-gesture-handler', () => {
  const chain = {
    runOnJS: () => chain,
    onStart: () => chain,
    onUpdate: () => chain
  }
  return {
    Gesture: { Simultaneous: () => ({}), Native: () => ({}), Pinch: () => chain },
    GestureDetector: 'GestureDetector',
    GestureHandlerRootView: 'GestureHandlerRootView'
  }
})

vi.mock('lucide-react-native', () => ({
  ArrowDown: 'ArrowDown',
  ChevronsDownUp: 'ChevronsDownUp',
  ChevronsUpDown: 'ChevronsUpDown',
  Sparkles: 'Sparkles',
  Square: 'Square'
}))

// The sheet reaches BottomDrawer, whose styles call Platform.select — absent
// from this file's react-native mock, and irrelevant to the banner tests.
vi.mock('./MobileBackgroundTasksSheet', () => ({
  MobileBackgroundTasksSheet: 'BackgroundTasksSheet'
}))
vi.mock('./MobileNativeChatRunSheet', () => ({ MobileNativeChatRunSheet: 'RunSheet' }))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({ MobileNativeChatToolDetailSheet: 'ToolDetailSheet' }))
// The Rewind confirm sheet reaches the same drawer; its rows are covered in
// MobileNativeChatView-rewind.test.ts.
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))

vi.mock('./MobileNativeChatMessage', () => ({ MobileNativeChatMessage: 'ChatMessage' }))
vi.mock('../components/MobileAgentIcon', () => ({ MobileAgentIcon: 'MobileAgentIcon' }))
vi.mock('./MobileNativeChatAsk', () => ({ MobileNativeChatAsk: 'ChatAsk' }))
vi.mock('./MobileNativeChatPermission', () => ({ MobileNativeChatPermission: 'ChatPermission' }))
vi.mock('./MobileNativeChatQuestion', () => ({ MobileNativeChatQuestion: 'ChatQuestion' }))

// Stand-in composer: exposes the view's `handleSend` through a pressable, which is
// the only composer behaviour these banner tests exercise.
// The inline-visual provider imports a WebView; this view's rows draw no visuals here (#26071).
vi.mock('./MobileNativeChatVisual', () => ({
  MobileNativeChatVisualProvider: ({ children }: { children?: unknown }) => children
}))
vi.mock('./MobileNativeChatComposer', async () => {
  const React = await import('react')
  return {
    MobileNativeChatComposer: (props: {
      onSend: (text: string) => Promise<boolean>
      disabled?: boolean
      placeholder?: string
    }) =>
      React.createElement('Composer', {
        ...props,
        accessibilityLabel: 'Send message',
        onPress: () => props.onSend('hi')
      })
  }
})

// 2026-10-09: the Claude app draws a reply's actions once, under the turn's
// last message, and ours drew them under every one. The list tells each row
// whether it is the message that ends its turn.

const turn = (id: string, role: NativeChatMessage['role']): NativeChatMessage => ({
  id,
  role,
  blocks: [{ type: 'text', text: id }],
  timestamp: 0,
  source: 'transcript'
})

describe('MobileNativeChatView, where a turn ends', () => {
  let renderer: ReturnType<typeof create> | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  type Pending = Parameters<typeof MobileNativeChatView>[0]['pending']

  async function render(messages: NativeChatMessage[], pending: Pending = []): Promise<void> {
    await renderFolded(messages, messages, pending)
  }

  async function renderFolded(messages: NativeChatMessage[], folded: NativeChatMessage[], pending: Pending = []): Promise<void> {
    await act(async () => {
      renderer = create(
        createElement(MobileNativeChatView, {
          messages,
          folded,
          status: 'ready',
          streaming: null,
          onSend: vi.fn().mockResolvedValue(true),
          sendSurfaceId: 'tab-a',
          getSendCompletionGeneration: () => 0,
          getComposerEditGeneration: () => 0,
          pending,
          composerText: '',
          onComposerTextChange: vi.fn()
        })
      )
    })
  }

  type RowProps = {
    endsTurn: unknown
    turnHasProse?: unknown
    copyTurnText?: (id: string) => string
  }

  /** What the list hands the row for one message, and that row's list index. */
  function rowOf(id: string): { props: RowProps; index: number } {
    const list = renderer!.root.find((node) => String(node.type) === 'FlashList')
    const data = list.props.data as NativeChatMessage[]
    const index = data.findIndex((row) => row.id === id)
    const row = list.props.renderItem({ item: data[index], index }) as {
      props: { children: [unknown, { props: { children: { props: RowProps } } }] } // inside the pending dim (S2)
    }
    return { props: row.props.children[1].props.children.props, index }
  }

  function endsTurn(id: string): unknown {
    return rowOf(id).props.endsTurn
  }

  it('flags only the last assistant message of each turn', async () => {
    await render([turn('u1', 'user'), turn('a1', 'assistant'), turn('a2', 'assistant'), turn('u2', 'user'), turn('a3', 'assistant')])
    expect(['a1', 'a2', 'a3'].map(endsTurn)).toEqual([false, true, true])
  })

  it('flags the one message of a single-message turn, and a list of one', async () => {
    await render([turn('u1', 'user'), turn('a1', 'assistant')])
    expect(endsTurn('a1')).toBe(true)
    await render([turn('a9', 'assistant')])
    expect(endsTurn('a9')).toBe(true)
  })

  it('moves the flag to the newer message once the turn grows', async () => {
    const first = [turn('u1', 'user'), turn('a1', 'assistant')]
    await render(first)
    expect(endsTurn('a1')).toBe(true)
    await act(async () => {
      renderer!.update(
        createElement(MobileNativeChatView, {
          ...(renderer!.root.findByType(MobileNativeChatView).props as Parameters<typeof MobileNativeChatView>[0]),
          messages: [...first, turn('a2', 'assistant')],
          folded: [...first, turn('a2', 'assistant')]
        })
      )
    })
    expect(endsTurn('a1')).toBe(false)
    expect(endsTurn('a2')).toBe(true)
  })

  // Review, 2026-10-09: the turn's one Copy copied only its last row, and a turn
  // whose newest row was a thought lost its actions.
  const said = (id: string, role: NativeChatMessage['role'], blocks: NativeChatMessage['blocks']): NativeChatMessage => ({
    id,
    role,
    blocks,
    timestamp: 0,
    source: 'transcript'
  })
  const textThenTool = said('a1', 'assistant', [
    { type: 'text', text: 'Looking.' },
    { type: 'tool-call', name: 'Bash', input: { command: 'ls' } },
    { type: 'tool-result', output: 'ok' }
  ])

  it('hands the turn end a Copy of every row of the reply, a blank line apart', async () => {
    await render([turn('u1', 'user'), textThenTool, said('a2', 'assistant', [{ type: 'text', text: 'Done.' }])])
    const end = rowOf('a2').props
    expect(end.turnHasProse).toBe(true)
    expect(end.copyTurnText?.('a2')).toBe('Looking.\n\nDone.')
  })

  it('keeps the actions on the reply while a thought is its newest row', async () => {
    await render([turn('u1', 'user'), turn('a1', 'assistant'), turn('r1', 'reasoning')])
    expect(endsTurn('a1')).toBe(true)
    expect(endsTurn('r1')).toBe(false)
  })

  // 2026-10-11: the Claude app has no arrow to the start of a reply (the user's screenshot of it:
  // copy and read-aloud only), and ours, tapped, blinked the jump control and landed several
  // replies up. No row is handed a scroll target or a jump handler any more.
  it('hands no row a scroll target or a jump to the start of its reply', async () => {
    await render([turn('u1', 'user'), turn('a1', 'assistant'), turn('a2', 'assistant'), turn('a3', 'assistant')])
    for (const id of ['a1', 'a2', 'a3']) {
      const props = rowOf(id).props as Record<string, unknown>
      expect(props.onScrollToMessage).toBeUndefined()
      expect(props.turnStartIndex).toBeUndefined()
    }
  })

  // The same recording: every reply Claude wrote because a background task finished came after a
  // `<task-notification>` user turn the chat hides, so the replies read as ONE turn: only the
  // newest drew actions, and its Copy took every reply since the user last wrote. Rows are the
  // codeui session's own shape (transcript 0954729d, 2026-10-11, Claude Code 2.1.296): a reply
  // ending "session:ok", the hidden notification of a background command, then the next reply.
  it('ends a reply where a hidden background-task turn begins, so each reply has its own actions', async () => {
    const notification = said('u-note', 'user', [
      {
        type: 'text',
        text:
          '<task-notification>\n<task-id>bq251ftrg</task-id>\n<tool-use-id>toolu_01LQmrF8EBooBaepp6DkbrU</tool-use-id>\n' +
          '<output-file>/private/tmp/claude-501/tasks/bq251ftrg.output</output-file>\n<status>completed</status>\n' +
          '<summary>Background command "Build the release APK" completed (exit code 0)</summary>\n</task-notification>'
      }
    ])
    const rows = [
      turn('u1', 'user'),
      said('a1', 'assistant', [{ type: 'text', text: "It's building now.\n\nsession:ok" }]),
      notification,
      said('a2', 'assistant', [{ type: 'text', text: 'The build is ready (0.9.128 version number).\n\nsession:ok' }])
    ]
    const folded = foldMobileNativeChatMessages(rows)
    expect(folded.map((row) => row.id)).toEqual(['u1', 'a1', 'a2'])
    await renderFolded(rows, folded)

    expect(endsTurn('a1')).toBe(true)
    expect(endsTurn('a2')).toBe(true)
    expect(rowOf('a2').props.copyTurnText?.('a2')).toBe('The build is ready (0.9.128 version number).\n\nsession:ok')
  })

  it('degenerate: a hidden turn with no reply after it yet ends nothing, and a reply of one row is its own turn', async () => {
    const note = said('u-note', 'user', [{ type: 'text', text: '<task-notification>\n<task-id>x</task-id>\n<status>completed</status>\n</task-notification>' }])
    const rows = [turn('u1', 'user'), said('a1', 'assistant', [{ type: 'text', text: 'Only row.' }]), note]
    await renderFolded(rows, foldMobileNativeChatMessages(rows))
    expect(endsTurn('a1')).toBe(true)
    expect(rowOf('a1').props.copyTurnText?.('a1')).toBe('Only row.')
  })

  // 2026-10-11: mid-turn the Copy sat under a running shell row, below the
  // words it copies. The Claude app keeps a turn's actions under its last
  // words while work after them still runs, so the row with those words has
  // to be told, and both rows told what work follows and whether the turn is
  // the newest one.
  const runningShell = { type: 'tool-call', name: 'Bash', input: { command: 'pnpm test' }, state: 'running' } as const

  it('tells the row with the last words that it holds the actions, and both rows the work after them', async () => {
    await render([
      turn('u0', 'user'),
      turn('a0', 'assistant'),
      turn('u1', 'user'),
      said('a1', 'assistant', [{ type: 'text', text: 'Committed.' }]),
      said('a2', 'assistant', [runningShell])
    ])
    expect(rowOf('a1').props).toMatchObject({ anchorsTurnActions: true, turnIsNewest: true, turnTrailingWork: [runningShell] })
    expect(rowOf('a2').props).toMatchObject({ endsTurn: true, anchorsTurnActions: false, turnIsNewest: true, turnTrailingWork: [runningShell] })
    expect(rowOf('a0').props).toMatchObject({ endsTurn: true, anchorsTurnActions: true, turnIsNewest: false, turnTrailingWork: [] })
    expect(rowOf('u1').props).toMatchObject({ anchorsTurnActions: false })
  })

  // Review of b935e72a7: a message sent mid-turn draws its echo after the
  // running turn, and the turn then read as old, so its Copy fell back under
  // the running shell.
  it('keeps the running turn the newest while a message sent from the phone waits after it', async () => {
    await render(
      [turn('u1', 'user'), said('a1', 'assistant', [{ type: 'text', text: 'Running tests.' }, runningShell])],
      [{ id: 'pending-1', text: 'also lint', baselineTailMessageId: 'a1' }]
    )
    expect(rowOf('a1').props).toMatchObject({ endsTurn: true, turnIsNewest: true })
  })
})
