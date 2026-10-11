import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isToolCallBlock, isToolResultBlock, type NativeChatBlock, type NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import { NativeChatAgentRunsContext, type NativeChatAgentRuns } from './native-chat-tasks-context'
import { MIXED_RUN_AGENT_ID, mixedRunWithBackgroundAgent } from './fixtures/claude-mixed-tool-run-agent-2026-10-01'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'

// 2026-10-11, the user's screenshot, mid-turn: the reply's words ("The agent
// has already committed…"), a shimmering "Running ›" shell row, and only then
// the Copy, with "Working · 5 running tasks" under it. The Claude app keeps a
// reply's actions under the last words of the turn while work after them is
// still going: its action row (l330.a, "Copy message" / "Read aloud" / thumbs)
// hangs off the turn's last assistant message with text, and tool rows after
// that message never move it (rs8.w6, n030.k). Only the turn's end record
// (the `result`, pcl.e) moves it to the bottom, and that arrives once the
// turn is over.

vi.mock('../components/DraggableDetailSheet', async () => {
  const React = await import('react')
  return {
    DraggableDetailSheet: ({ visible, children }: { visible: boolean; children?: ReactNode }) =>
      visible ? React.createElement('DraggableDetailSheet', null, children) : null
  }
})
vi.mock('react-native', async () => {
  const React = await import('react')
  const Text = ({ children, ...props }: { children?: ReactNode }): unknown =>
    React.createElement('Text', props, children)
  return {
    Animated: {
      View: 'View',
      Text,
      Value: class {
        constructor(private value: number) {}
        setValue(next: number): void {
          this.value = next
        }
      },
      loop: (animation: unknown) => animation,
      sequence: () => ({ start: vi.fn(), stop: vi.fn() }),
      timing: () => ({ start: vi.fn(), stop: vi.fn() })
    },
    Image: 'Image',
    Platform: { OS: 'android', Version: 34 },
    Pressable: 'Pressable',
    ScrollView: ({ children, ...props }: { children?: ReactNode }) =>
      React.createElement('ScrollView', props, children),
    Text,
    View: ({ children, ...props }: { children?: ReactNode }) => React.createElement('View', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 })
  }
})
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
vi.mock('../platform/haptics', () => ({
  triggerSuccess: vi.fn(),
  triggerError: vi.fn(),
  triggerSelection: vi.fn(),
  triggerMediumImpact: vi.fn()
}))
vi.mock('lucide-react-native', () => {
  const icons: Record<string, string> = {}
  return new Proxy(icons, {
    get: (_target, name) => (typeof name === 'string' ? name : undefined),
    has: () => true
  })
})
// Counts its draws, so a test can tell whether a row re-rendered.
const markdown = vi.hoisted(() => ({ draws: 0 }))
vi.mock('../components/MobileMarkdown', async () => {
  const React = await import('react')
  return {
    MobileMarkdown: (props: Record<string, unknown>) => {
      markdown.draws += 1
      return React.createElement('MobileMarkdown', props)
    }
  }
})
vi.mock('./MobileNativeChatToolDetailSheet', () => ({
  MobileNativeChatToolDetailSheet: 'MobileNativeChatToolDetailSheet'
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => true }))

const WORDS = 'The agent has already committed the fix.'
const runningShell: NativeChatBlock = {
  type: 'tool-call',
  name: 'Bash',
  input: { command: 'pnpm test', description: 'Run the suite' },
  state: 'running'
}
const finishedShell: NativeChatBlock[] = [
  { type: 'tool-call', name: 'Bash', input: { command: 'pnpm test' }, state: 'completed' },
  { type: 'tool-result', output: 'ok' }
]
const assistant = (id: string, blocks: NativeChatBlock[]): NativeChatMessage => ({
  id,
  role: 'assistant',
  blocks,
  timestamp: null,
  source: 'transcript'
})
/** The work the list hands a row: the turn's tool blocks after its last words. */
const work = (blocks: NativeChatBlock[]): NativeChatBlock[] =>
  blocks.filter((block) => isToolCallBlock(block) || isToolResultBlock(block))

const WORKING: NativeChatAgentRuns = { runningIds: new Set(), confirmed: new Map(), agentWorking: true }
const IDLE: NativeChatAgentRuns = { runningIds: new Set(), confirmed: new Map(), agentWorking: false }
const AGENT_RUNNING: NativeChatAgentRuns = { ...IDLE, liveTaskIds: new Set([MIXED_RUN_AGENT_ID]) }
const OTHER_AGENT_RUNNING: NativeChatAgentRuns = { ...IDLE, liveTaskIds: new Set(['other']) }

let renderer: ReactTestRenderer | null = null

function render(
  message: NativeChatMessage,
  scheme: 'light' | 'dark',
  runs: NativeChatAgentRuns,
  props: Partial<Parameters<typeof MobileNativeChatMessage>[0]> = {}
): ReactTestInstance {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <NativeChatAgentRunsContext.Provider value={runs}>
          <MobileNativeChatMessage
            message={message}
            structuredActivityUi
            activeTurnIsWorking={runs.agentWorking}
            {...props}
          />
        </NativeChatAgentRunsContext.Provider>
      </ThemeProvider>
    )
  })
  return renderer!.root
}

const isCopy = (node: ReactTestInstance) =>
  String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Copy message'
const isRun = (node: ReactTestInstance) =>
  node.props.testID === 'tool-run-header' || node.props.testID === 'tool-run-active-header'
// The host element the counting mock draws, not the mock component itself.
const isWords = (node: ReactTestInstance) => (node.type as unknown) === 'MobileMarkdown'

/** The row as read top to bottom: words, the actions and the work, in the
 *  order findAll walks the tree (document order). */
function order(root: ReactTestInstance): string[] {
  const seen = root.findAll((node) => isWords(node) || isCopy(node) || isRun(node))
  const out: string[] = []
  for (const node of seen) {
    const label = isCopy(node) ? 'copy' : isRun(node) ? 'run' : 'words'
    if (out.at(-1) !== label) {
      out.push(label)
    }
  }
  return out
}

const flatStyle = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...([] as unknown[]).concat(style).flat(Infinity).filter(Boolean))

/** Every ancestor of a node up to the bubble's content, nearest first. */
function ancestorsOf(node: ReactTestInstance): ReactTestInstance[] {
  const out: ReactTestInstance[] = []
  for (let up = node.parent; up; up = up.parent) {
    if (String(up.type) === 'View') {
      out.push(up)
    }
  }
  return out
}

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as ['light' | 'dark', ThemeColors][])('a reply whose work is still running, in a %s session', (scheme, palette) => {
  it('keeps Copy under the words and above a shell that is still running at the end of the reply', () => {
    const message = assistant('a1', [{ type: 'text', text: WORDS }, runningShell])
    const root = render(message, scheme, WORKING, {
      endsTurn: true,
      anchorsTurnActions: true,
      turnTrailingWork: work(message.blocks),
      turnIsNewest: true
    })
    expect(root.findAll((node) => node.props.testID === 'tool-run-active-header')).toHaveLength(1)
    expect(order(root)).toEqual(['words', 'copy', 'run'])
    expect(root.findAll(isCopy)).toHaveLength(1)
    expect(root.findAll(isCopy)[0]!.find((node) => String(node.type) === 'Copy').props.color).toBe(palette.textMuted)
  })

  it('keeps Copy under the words and above an agent that is still running at the end of a settled reply', () => {
    const blocks = [{ type: 'text', text: WORDS } as NativeChatBlock, ...mixedRunWithBackgroundAgent()]
    const message = assistant('a1', blocks)
    const root = render(message, scheme, AGENT_RUNNING, {
      // The terminal tab's lane: a settled turn keeps its runs in view.
      structuredActivityUi: false,
      endsTurn: true,
      anchorsTurnActions: true,
      turnTrailingWork: work(blocks),
      turnIsNewest: true
    })
    expect(order(root)).toEqual(['words', 'copy', 'run'])
  })

  it('puts Copy back at the bottom of the turn once the work has finished', () => {
    const message = assistant('a1', [{ type: 'text', text: WORDS }, ...finishedShell])
    const root = render(message, scheme, IDLE, {
      endsTurn: true,
      anchorsTurnActions: true,
      turnTrailingWork: work(message.blocks),
      turnIsNewest: true,
      // The settled run folds behind the turn caret unless the reader opened it.
      toolsExpanded: true
    })
    expect(order(root)).toEqual(['words', 'run', 'copy'])
  })

  it('draws no actions under a turn whose only row is a running tool row', () => {
    const message = assistant('a1', [runningShell])
    const root = render(message, scheme, WORKING, {
      endsTurn: true,
      anchorsTurnActions: false,
      turnHasProse: false,
      turnTrailingWork: work(message.blocks),
      turnIsNewest: true
    })
    expect(root.findAll(isCopy)).toHaveLength(0)
  })

  it('treats an empty text after the running work as no words: Copy stays above the run', () => {
    const message = assistant('a1', [{ type: 'text', text: WORDS }, runningShell, { type: 'text', text: '  ' }])
    const root = render(message, scheme, WORKING, {
      endsTurn: true,
      anchorsTurnActions: true,
      turnTrailingWork: work(message.blocks),
      turnIsNewest: true
    })
    expect(order(root).filter((label) => label !== 'words')).toEqual(['copy', 'run'])
    expect(root.findAll(isCopy)).toHaveLength(1)
  })

  it('draws nothing at the end of a later row while the row with the words holds the actions', () => {
    // A two-row turn: the words in one row, the running shell in the next.
    const end = assistant('a2', [runningShell])
    const root = render(end, scheme, WORKING, {
      endsTurn: true,
      anchorsTurnActions: false,
      turnHasProse: true,
      copyTurnText: () => WORDS,
      turnTrailingWork: [runningShell],
      turnIsNewest: true
    })
    expect(root.findAll(isCopy)).toHaveLength(0)
  })

  // 2026-10-11: Claude's larger buttons (bf4 "Small": a 20 icon in a 36 box,
  // the row pulled left 8) were tried and the user asked for the old size
  // back. Moving the actions above running work must not resize them.
  it('keeps the action buttons their old size: a 14 icon in a padding of 4, 4 apart, pulled left 4', () => {
    const root = render(assistant('a1', [{ type: 'text', text: WORDS }]), scheme, IDLE, { endsTurn: true })
    const copy = root.findAll(isCopy)[0]!
    expect(copy.find((node) => String(node.type) === 'Copy').props.size).toBe(14)
    const box = flatStyle(copy.props.style({ pressed: false }))
    expect(box.padding).toBe(4)
    const row = copy.parent!
    expect(flatStyle(row.props.style).gap).toBe(4)
    const margins = [row, ...ancestorsOf(row)].map((node) => flatStyle(node.props.style).marginLeft ?? 0)
    expect(margins.reduce((sum: number, value) => sum + Number(value), 0)).toBe(-4)
  })

  // Review of b935e72a7: every row read the background-work context, which
  // changes on each transcript update, so every mounted row re-rendered on
  // every tick, memo or not. Only the rows that place a turn's actions need it.
  it('does not re-render a row that places no turn actions when the background work changes', () => {
    const message = assistant('a1', [{ type: 'text', text: WORDS }])
    const props = { endsTurn: false, anchorsTurnActions: false }
    const root = render(message, scheme, IDLE, props)
    expect(root.findAll(isWords).length).toBeGreaterThan(0)
    const before = markdown.draws
    act(() => {
      renderer!.update(
        <ThemeProvider initialPreference={scheme}>
          <NativeChatAgentRunsContext.Provider value={OTHER_AGENT_RUNNING}>
            <MobileNativeChatMessage
              message={message}
              structuredActivityUi
              activeTurnIsWorking={false}
              {...props}
            />
          </NativeChatAgentRunsContext.Provider>
        </ThemeProvider>
      )
    })
    expect(markdown.draws).toBe(before)
  })

  it('draws the actions on the row with the words, though another row ends the turn', () => {
    const words = assistant('a1', [{ type: 'text', text: WORDS }])
    const root = render(words, scheme, WORKING, {
      endsTurn: false,
      anchorsTurnActions: true,
      turnHasProse: true,
      copyTurnText: () => WORDS,
      turnTrailingWork: [runningShell],
      turnIsNewest: true
    })
    expect(root.findAll(isCopy)).toHaveLength(1)
  })
})
