import { createElement, memo } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import * as fold from '../../../src/shared/native-chat-tool-fold'
import { ThemeProvider } from '../theme/theme-context'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'
import { ToolRun } from './MobileNativeChatToolRun'
import { NativeChatAgentRunsContext, type NativeChatAgentRuns } from './native-chat-tasks-context'

vi.mock('../../../src/shared/native-chat-tool-fold', async (importOriginal) => {
  const original = await importOriginal<typeof fold>()
  return { ...original, pairToolBlocks: vi.fn(original.pairToolBlocks) }
})
vi.mock('react-native', () => ({
  Animated: {
    View: 'View',
    Text: 'Text',
    Value: class {
      setValue(): void {}
    },
    loop: (animation: unknown) => animation,
    sequence: () => ({ start: vi.fn(), stop: vi.fn() }),
    timing: () => ({ start: vi.fn(), stop: vi.fn() })
  },
  Platform: { OS: 'android', Version: 34 },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('lucide-react-native', () => ({
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  SquareTerminal: 'SquareTerminal',
  Wrench: 'Wrench'
}))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({
  MobileNativeChatToolDetailSheet: 'MobileNativeChatToolDetailSheet'
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => false }))


// Review of feat/tool-run-sheet: every run read the chat's agent-runs context,
// whose value changes with messages, status and running tasks, so each chat
// update re-rendered every run under the memoised message (a Bash-only run
// re-paired its calls 15 times over 5 updates; 0 on main).
const BASH_ONLY: NativeChatBlock[] = [
  { type: 'tool-call', name: 'Bash', input: { command: 'ls' } },
  { type: 'tool-result', output: 'a.ts' },
  { type: 'tool-call', name: 'Read', input: { file_path: 'a.ts' } },
  { type: 'tool-result', output: 'x' }
]
const WITH_AGENT: NativeChatBlock[] = [
  ...BASH_ONLY,
  { type: 'tool-call', name: 'Agent', input: { description: 'Look into it' } },
  { type: 'tool-result', output: 'done' }
]

function Row({ blocks }: { blocks: NativeChatBlock[] }) {
  const styles = useChatMessageStyles()
  return createElement(ToolRun, { blocks, defaultExpanded: false, activeCall: null, styles })
}
// The chat's message row is memoised on its props, as here: only a context can re-render it.
const MemoRow = memo(Row)

describe('a run under chat updates that are not about it', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  const RUNS: NativeChatAgentRuns[] = Array.from({ length: 6 }, (_, n) => ({
    runningIds: new Set([`id-${n}`]),
    confirmed: new Map(),
    agentWorking: n % 2 === 0
  }))

  function updates(blocks: NativeChatBlock[]): number {
    const pair = vi.mocked(fold.pairToolBlocks)
    const tree = (n: number) => (
      <ThemeProvider initialPreference="light">
        <NativeChatAgentRunsContext.Provider value={RUNS[n]!}>
          <MemoRow blocks={blocks} />
        </NativeChatAgentRunsContext.Provider>
      </ThemeProvider>
    )
    act(() => {
      renderer = create(tree(0))
    })
    pair.mockClear()
    for (let n = 1; n <= 5; n++) {
      act(() => renderer!.update(tree(n)))
    }
    return pair.mock.calls.length
  }

  it('does not re-render a Bash-only run when the chat\'s agent state changes', () => {
    expect(updates(BASH_ONLY)).toBe(0)
  })

  it('still re-renders a run that holds an agent call, which reads that state', () => {
    expect(updates(WITH_AGENT)).toBeGreaterThan(0)
  })
})
