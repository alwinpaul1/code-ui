import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSubagentSnapshot } from '../../../src/shared/agent-status-types'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileBackgroundTasksSheetBody } from './MobileBackgroundTasksSheet'
import {
  WORKFLOW_LAUNCHED_AT,
  workflowFinishedMessage,
  workflowLaunchMessages
} from './fixtures/claude-workflow-2.1.284'

vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('react-native', () => ({
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
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))
vi.mock('lucide-react-native', () => ({
  Activity: 'Activity',
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  CircleStop: 'CircleStop',
  Diamond: 'Diamond',
  ListTree: 'ListTree',
  Sparkles: 'Sparkles',
  Square: 'Square',
  Terminal: 'Terminal',
  X: 'X'
}))

// One workflow drawn as one card, the way the Claude app draws it (reference
// frames of 2026-09-30). The records are Claude Code 2.1.284's.
const NOW = WORKFLOW_LAUNCHED_AT + 61 * 60_000 + 44_000

function lane(id: string, description: string | undefined): AgentSubagentSnapshot {
  return { id, agentType: 'workflow-subagent', ...(description === undefined ? {} : { description }), state: 'working', startedAt: WORKFLOW_LAUNCHED_AT }
}

const SWEEP_LANES = [
  lane('a1', 'review:markdown'),
  lane('a2', 'review:chat-ui'),
  lane('a3', 'fix:r1:b3-terminal-screen-and-parsers'),
  lane('a4', undefined)
]

type Rendered = { texts: string[]; colors: string[]; backgrounds: string[] }

function readTree(renderer: ReactTestRenderer): Rendered {
  const texts: string[] = []
  const colors: string[] = []
  const backgrounds: string[] = []
  const styles = (node: { props: { style?: unknown } }): Record<string, unknown>[] => {
    const style = node.props.style
    return (Array.isArray(style) ? style : [style]).filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
  }
  for (const node of renderer.root.findAll((node) => String(node.type) === 'Text')) {
    if (typeof node.props.children === 'string') {
      texts.push(node.props.children)
    }
    for (const entry of styles(node)) {
      if (typeof entry.color === 'string') {
        colors.push(entry.color)
      }
    }
  }
  for (const node of renderer.root.findAll((node) => String(node.type) === 'View')) {
    for (const entry of styles(node)) {
      if (typeof entry.backgroundColor === 'string') {
        backgrounds.push(entry.backgroundColor)
      }
    }
  }
  return { texts, colors, backgrounds }
}

describe('a running workflow in the background tasks sheet', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
  })

  async function render(
    scheme: 'light' | 'dark',
    messages: NativeChatMessage[],
    subagents: AgentSubagentSnapshot[] = []
  ): Promise<Rendered> {
    await act(async () => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileBackgroundTasksSheetBody messages={messages} agent="claude" agentStatus={{ state: 'working', subagents }} />
        </ThemeProvider>
      )
    })
    return readTree(renderer!)
  }

  async function press(accessibilityLabel: string): Promise<void> {
    const target = renderer!.root.findAll((node) => String(node.type) === 'Pressable').find((node) => node.props.accessibilityLabel === accessibilityLabel)
    if (!target) {
      throw new Error(`no pressable labelled "${accessibilityLabel}"`)
    }
    await act(async () => {
      target.props.onPress()
    })
  }

  it('is one card: its name, "Workflow", the time since launch and the description', async () => {
    const { texts } = await render('light', workflowLaunchMessages(), SWEEP_LANES)
    expect(texts).toContain('pre-release-review-sweep')
    expect(texts).toContain('Workflow')
    expect(texts).toContain('1h 1m')
    expect(texts).toContain(
      'Parallel Sonnet reviewers find proven bugs across Code UI; Opus triages, fixes in worktrees, integrates; Sonnet re-reviews'
    )
    // The lane's raw agent type never becomes a row of its own.
    expect(texts).not.toContain('workflow-subagent')
    expect(texts.filter((text) => text === 'Agent')).toHaveLength(0)
  })

  it('lists one section per meta phase, with the running agents of each under it', async () => {
    const { texts } = await render('light', workflowLaunchMessages(), SWEEP_LANES)
    expect(texts).toContain('Phases')
    for (const title of ['Review', 'Triage', 'Fix', 'Integrate', 'Re-review']) {
      expect(texts).toContain(title)
    }
    expect(texts).toContain('review:markdown')
    expect(texts).toContain('review:chat-ui')
    expect(texts).toContain('fix:r1:b3-terminal-screen-and-parsers')
    expect(texts).toContain('2 running')
    expect(texts).toContain('1 running')
  })

  it('says only what it knows: no done/total, no zero counts, no tokens, no per-agent time', async () => {
    const { texts } = await render('light', workflowLaunchMessages(), SWEEP_LANES)
    expect(texts.some((text) => /^\d+\/\d+$/.test(text))).toBe(false)
    expect(texts.some((text) => /token/i.test(text))).toBe(false)
    expect(texts.some((text) => text.startsWith('0 '))).toBe(false)
    // The header counts the agents it can see running, and the unplaced one too.
    expect(texts).toContain('4 agents running')
  })

  it('draws one square per running agent in the info colour, in both themes', async () => {
    for (const [scheme, palette] of [
      ['light', lightColors],
      ['dark', darkColors]
    ] as const) {
      const { backgrounds, colors } = await render(scheme, workflowLaunchMessages(), SWEEP_LANES)
      // The status dot, then the three squares (two Review agents, one Fix).
      expect(backgrounds.filter((color) => color === palette.info)).toHaveLength(4)
      // Ink comes from the theme: no other scheme's text colour leaks in.
      const other = scheme === 'light' ? darkColors : lightColors
      expect(colors).not.toContain(other.text)
      expect(backgrounds).not.toContain(other.bgRaised)
      act(() => renderer?.unmount())
      renderer = null
    }
  })

  it('folds a phase away when its chevron is tapped, and back', async () => {
    await render('light', workflowLaunchMessages(), SWEEP_LANES)
    await press('Review, collapse')
    expect(readTree(renderer!).texts).not.toContain('review:markdown')
    expect(readTree(renderer!).texts).toContain('fix:r1:b3-terminal-screen-and-parsers')
    await press('Review, expand')
    expect(readTree(renderer!).texts).toContain('review:markdown')
  })

  it('a phase with nothing running is a bare title: no count, no chevron to open nothing', async () => {
    await render('light', workflowLaunchMessages(), SWEEP_LANES)
    const labels = renderer!.root.findAll((node) => String(node.type) === 'Pressable').map((node) => String(node.props.accessibilityLabel ?? ''))
    expect(labels).not.toContain('Triage, expand')
    expect(labels).not.toContain('Triage, collapse')
    expect(labels).toContain('Review, collapse')
  })

  it('no agents yet: header and phases only', async () => {
    const { texts } = await render('light', workflowLaunchMessages(), [])
    expect(texts).toContain('pre-release-review-sweep')
    expect(texts).toContain('Phases')
    expect(texts.some((text) => /agents? running/.test(text))).toBe(false)
  })

  it('one agent reads "1 agent running", not "1 agents"', async () => {
    const { texts } = await render('light', workflowLaunchMessages(), [lane('a1', 'triage:round-1')])
    expect(texts).toContain('1 agent running')
    expect(texts).toContain('triage:round-1')
  })

  it('an unreadable script still draws the workflow, without a Phases section', async () => {
    const { texts } = await render('light', workflowLaunchMessages('export const meta = compute()'), [lane('a1', 'review:markdown')])
    expect(texts).toContain('Workflow')
    expect(texts).not.toContain('Phases')
    expect(texts).toContain('review:markdown')
    expect(texts).toContain('Parallel Sonnet reviewers find proven bugs across Code UI; Opus triages, fixes in worktrees, integrates; Sonnet re-reviews')
  })

  it('a finished workflow sits under Finished with the totals Claude reported, and no phase table', async () => {
    for (const scheme of ['light', 'dark'] as const) {
      const { texts } = await render(scheme, [...workflowLaunchMessages(), workflowFinishedMessage()])
      expect(texts).toContain('Finished 1')
      expect(texts).toContain('pre-release-review-sweep')
      expect(texts).toContain('37 agents')
      expect(texts).toContain('4.9M tokens')
      expect(texts).toContain('1h 24m')
      expect(texts).toContain('Completed')
      expect(texts).not.toContain('Phases')
      act(() => renderer?.unmount())
      renderer = null
    }
  })

  it('two workflows at once are two cards, and the shared lanes stay ordinary agent rows', async () => {
    const second = workflowLaunchMessages(
      "export const meta = { name: 'docs-pass', description: 'Rewrite the docs', phases: [{ title: 'Draft' }, { title: 'Review' }] }"
    ).map((message, index) => ({
      ...message,
      id: `second-${index}`,
      blocks: message.blocks.map((block) =>
        block.type === 'tool-result' ? { ...block, output: block.output.replace('whnsp6sli', 'wdocs0001') } : block
      )
    }))
    const { texts } = await render('light', [...workflowLaunchMessages(), ...second], [lane('a1', 'draft:intro'), lane('a2', 'review:markdown')])
    expect(texts).toContain('pre-release-review-sweep')
    expect(texts).toContain('docs-pass')
    expect(texts).toContain('draft:intro')
    // `review:` belongs to both, so nothing says whose: it is a plain agent row.
    expect(texts).toContain('review:markdown')
    expect(texts.filter((text) => text === 'Agent')).toHaveLength(1)
  })
})
