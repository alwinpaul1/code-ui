import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'
import { MobileNativeChatToolSegment } from './MobileNativeChatToolSegment'
import { NativeChatAgentRunsContext, type NativeChatAgentRuns } from './native-chat-tasks-context'
import {
  RUNNING_ROWS_AGENT_DESCRIPTION,
  RUNNING_ROWS_AGENT_ID,
  RUNNING_ROWS_SHELL_DESCRIPTION,
  RUNNING_ROWS_SHELL_ID,
  agentRun,
  bashRunMovedToBackground,
  bashRunUnanswered
} from './fixtures/claude-running-rows-2.1.296'

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
  SquareCode: 'SquareCode',
  SquareTerminal: 'SquareTerminal',
  Wrench: 'Wrench'
}))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({
  MobileNativeChatToolDetailSheet: 'MobileNativeChatToolDetailSheet'
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => false }))

// The 2026-10-11 recording of one session in the Claude app and in Code UI, at
// 15:57:41, Claude Code 2.1.296 (fixtures/claude-running-rows-2.1.296.ts). While
// the lead's background agent worked and its foreground gate ran, the Claude app
// drew "Running agent: Fix status line usage figures ›" and "Running ›", both
// shimmering; Code UI drew "Ran 1 agent ›" and "Ran Run the full gate on main ›",
// still and in the past tense.

const IDLE: NativeChatAgentRuns = {
  runningIds: new Set(),
  liveTaskIds: new Set(),
  confirmed: new Map(),
  agentWorking: false
}

function Harness({
  blocks,
  agentRuns,
  inNewestReply
}: {
  blocks: NativeChatBlock[]
  agentRuns: NativeChatAgentRuns
  inNewestReply: boolean
}) {
  const styles = useChatMessageStyles()
  return (
    <NativeChatAgentRunsContext.Provider value={agentRuns}>
      <MobileNativeChatToolSegment blocks={blocks} defaultExpanded={false} inNewestReply={inNewestReply} styles={styles} />
    </NativeChatAgentRunsContext.Provider>
  )
}

function textOf(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map((child) => textOf(child)).join('')
}

const LABEL_IDS = ['agent-run-label', 'tool-run-active-label', 'tool-run-agent-label']

describe('a tool row still running', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(
    blocks: NativeChatBlock[],
    agentRuns: NativeChatAgentRuns,
    scheme: 'light' | 'dark' = 'light',
    inNewestReply = true
  ) {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <Harness blocks={blocks} agentRuns={agentRuns} inNewestReply={inNewestReply} />
        </ThemeProvider>
      )
    })
    return renderer!
  }

  /** The row's words, a shimmering label read whole. */
  function rowText(tree: ReactTestRenderer): string {
    return textOf(tree.root.findByType('Pressable' as never)).trim()
  }

  /** The shimmering label, if the row draws one: a label of one span per
   *  glyph. A still label is one plain Text. */
  function shimmer(tree: ReactTestRenderer): ReactTestInstance | undefined {
    return tree.root
      .findAll((node) => LABEL_IDS.includes(node.props?.testID) && String(node.type) === 'Text')
      .find((label) => label.findAll((node) => String(node.type) === 'Text' && node !== label).length > 1)
  }

  describe('the background agent "Fix status line usage figures"', () => {
    it('reads "Running agent: <description>" with the shimmer while the host roster says it runs', () => {
      const tree = render(agentRun(), { ...IDLE, agentWorking: true, liveTaskIds: new Set([RUNNING_ROWS_AGENT_ID]) })
      expect(rowText(tree)).toBe(`Running agent: ${RUNNING_ROWS_AGENT_DESCRIPTION}`)
      expect(shimmer(tree)).toBeDefined()
    })

    it('keeps running after the lead turn ends, while the roster still lists the agent', () => {
      const tree = render(agentRun(), { ...IDLE, liveTaskIds: new Set([RUNNING_ROWS_AGENT_ID]) })
      expect(rowText(tree)).toBe(`Running agent: ${RUNNING_ROWS_AGENT_DESCRIPTION}`)
    })

    it('settles to "Ran 1 agent", still, once nothing vouches that it runs', () => {
      const tree = render(agentRun(), { ...IDLE, agentWorking: true, runningIds: new Set([RUNNING_ROWS_AGENT_ID]) })
      expect(rowText(tree)).toBe('Ran 1 agent')
      expect(shimmer(tree)).toBeUndefined()
    })
  })

  describe('the gate "Run the full gate on main"', () => {
    it('reads "Running" with the shimmer while its call has no result and the turn works', () => {
      const tree = render(bashRunUnanswered(), { ...IDLE, agentWorking: true })
      expect(rowText(tree)).toBe('Running')
      expect(shimmer(tree)).toBeDefined()
      expect(tree.root.findAllByType('SquareTerminal' as never)).toHaveLength(1)
    })

    it('reads "Running" once moved to the background, while that shell still runs', () => {
      const tree = render(bashRunMovedToBackground(), { ...IDLE, agentWorking: true, liveTaskIds: new Set([RUNNING_ROWS_SHELL_ID]) })
      expect(rowText(tree)).toBe('Running')
      expect(shimmer(tree)).toBeDefined()
    })

    it('never glues "Ran" onto the description while it runs', () => {
      for (const tree of [
        render(bashRunUnanswered(), { ...IDLE, agentWorking: true }),
        render(bashRunMovedToBackground(), { ...IDLE, liveTaskIds: new Set([RUNNING_ROWS_SHELL_ID]) })
      ]) {
        expect(rowText(tree)).not.toContain(`Ran ${RUNNING_ROWS_SHELL_DESCRIPTION}`)
      }
    })

    it('stops the shimmer once the background shell has finished', () => {
      const tree = render(bashRunMovedToBackground(), { ...IDLE, agentWorking: true })
      expect(shimmer(tree)).toBeUndefined()
      expect(rowText(tree)).not.toBe('Running')
    })

    it('stops the shimmer once the turn ends with the call never answered', () => {
      const tree = render(bashRunUnanswered(), IDLE)
      expect(shimmer(tree)).toBeUndefined()
      expect(rowText(tree)).not.toBe('Running')
    })
  })

  /** The colours the row draws its words and glyphs in. */
  function colorsOf(tree: ReactTestRenderer): string[] {
    return tree.root.findAll((node) => typeof node.props.color === 'string').map((node) => String(node.props.color))
  }

  for (const scheme of ['light', 'dark'] as const) {
    const colors = scheme === 'light' ? lightColors : darkColors
    const other = scheme === 'light' ? darkColors : lightColors

    it(`keeps an earlier reply's unanswered call still while a later turn works (${scheme})`, () => {
      // An interrupted turn leaves its call with no answer for good.
      const tree = render(bashRunUnanswered(), { ...IDLE, agentWorking: true }, scheme, false)
      expect(shimmer(tree)).toBeUndefined()
      expect(rowText(tree)).not.toBe('Running')
    })

    it(`draws the running rows from the theme that is on (${scheme})`, () => {
      const running: [NativeChatBlock[], NativeChatAgentRuns][] = [
        [bashRunUnanswered(), { ...IDLE, agentWorking: true }],
        [agentRun(), { ...IDLE, liveTaskIds: new Set([RUNNING_ROWS_AGENT_ID]) }]
      ]
      for (const [blocks, runs] of running) {
        const tree = render(blocks, runs, scheme)
        expect(shimmer(tree)).toBeDefined()
        const drawn = colorsOf(tree)
        expect(drawn).toContain(colors.textSecondary)
        expect(drawn).toContain(colors.textMuted)
        if (other.textSecondary !== colors.textSecondary) {
          expect(drawn).not.toContain(other.textSecondary)
        }
      }
    })
  }
})
