import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSubagentSnapshot } from '../../../src/shared/agent-status-types'
import {
  claudeRosterToSnapshots,
  upsertWorkingClaudeSubagent,
  type ClaudeSubagentRoster
} from '../../../src/shared/claude-subagent-roster'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileBackgroundTasksSheetBody } from './MobileBackgroundTasksSheet'
import {
  WORKFLOW_LAUNCHED_AT,
  WORKFLOW_TASK_ID,
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
  SquareTerminal: 'SquareTerminal',
  Terminal: 'Terminal',
  X: 'X'
}))

// One workflow drawn as one card, after the Claude app's (reference frames of
// 2026-09-30), holding only what the phone knows. Transcript records are Claude
// Code 2.1.284's; the lanes are built through the vendored roster the way Orca
// builds a workflow lane in production: an agent_type and nothing else.
const NOW = WORKFLOW_LAUNCHED_AT + 61 * 60_000 + 44_000
const LANE_STARTED = WORKFLOW_LAUNCHED_AT + 5_000
/** The Stop hook's beacon naming the workflow as the one thing running. */
const REPORT = {
  finishedTaskIds: [],
  runningTaskIds: null,
  runningTaskIdsAt: null,
  launchedTaskIds: [],
  stopRunningTaskIds: [WORKFLOW_TASK_ID],
  stopRunningTaskIdsAt: WORKFLOW_LAUNCHED_AT + 60_000
}

function lanes(count: number): AgentSubagentSnapshot[] {
  const roster: ClaudeSubagentRoster = new Map()
  for (let index = 0; index < count; index += 1) {
    upsertWorkingClaudeSubagent(roster, `a${index.toString(16).padStart(16, '0')}`, { agentType: 'workflow-subagent' }, LANE_STARTED + index)
  }
  return claudeRosterToSnapshots(roster) ?? []
}

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
          <MobileBackgroundTasksSheetBody
            messages={messages}
            agentStatus={{ state: 'working', subagents }}
            backgroundTaskReport={REPORT}
          />
        </ThemeProvider>
      )
    })
    return readTree(renderer!)
  }

  it('is one card: its name, "Workflow", the time since launch and the description', async () => {
    const { texts } = await render('light', workflowLaunchMessages(), lanes(3))
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

  it('names the phases from the meta as plain titles: no counts, no squares, no agent rows, no chevrons', async () => {
    for (const [scheme, palette] of [
      ['light', lightColors],
      ['dark', darkColors]
    ] as const) {
      const { texts, backgrounds } = await render(scheme, workflowLaunchMessages(), lanes(3))
      expect(texts).toContain('Phases')
      for (const title of ['Review', 'Triage', 'Fix', 'Integrate', 'Re-review']) {
        expect(texts).toContain(title)
      }
      expect(texts.some((text) => /^\d+\/\d+$/.test(text))).toBe(false)
      expect(texts.some((text) => text.endsWith(' running') && !/agents? running$/.test(text))).toBe(false)
      expect(texts.some((text) => /token/i.test(text))).toBe(false)
      expect(texts).not.toContain('Unnamed agent')
      // Only the status dot is the info colour; there is a square for no agent.
      expect(backgrounds.filter((color) => color === palette.info)).toHaveLength(1)
      const labels = renderer!.root.findAll((node) => String(node.type) === 'Pressable').map((node) => String(node.props.accessibilityLabel ?? ''))
      expect(labels.some((label) => /collapse|expand/.test(label) && !label.startsWith('Running') && !label.startsWith('Finished'))).toBe(false)
      const other = scheme === 'light' ? darkColors : lightColors
      expect(backgrounds).not.toContain(other.bgRaised)
      act(() => renderer?.unmount())
      renderer = null
    }
  })

  it('counts the lanes running: "3 agents running", "1 agent running"', async () => {
    expect((await render('light', workflowLaunchMessages(), lanes(3))).texts).toContain('3 agents running')
    act(() => renderer?.unmount())
    expect((await render('light', workflowLaunchMessages(), lanes(1))).texts).toContain('1 agent running')
  })

  it('at the roster cap says "32+ agents running"', async () => {
    expect((await render('light', workflowLaunchMessages(), lanes(40))).texts).toContain('32+ agents running')
  })

  it('with no lanes on the roster (a lead Stop just cleared it) says nothing of agents, never "0 agents"', async () => {
    const { texts } = await render('light', workflowLaunchMessages(), [])
    expect(texts).toContain('pre-release-review-sweep')
    expect(texts).toContain('Phases')
    expect(texts.some((text) => /agents?( running)?$/.test(text))).toBe(false)
    expect(texts.some((text) => text.startsWith('0 '))).toBe(false)
  })

  it('an unreadable script still draws the workflow named by its Script file, without a Phases section', async () => {
    const { texts } = await render('light', workflowLaunchMessages('export const meta = compute()'), lanes(2))
    expect(texts).toContain('pre-release-review-sweep')
    expect(texts).toContain('Workflow')
    expect(texts).not.toContain('Phases')
    expect(texts).toContain('2 agents running')
  })

  it('two phases that share a title are both drawn', async () => {
    const script = "export const meta = { name: 'twice', phases: [{ title: 'Review' }, { title: 'Review' }] }"
    const { texts } = await render('light', workflowLaunchMessages(script))
    expect(texts.filter((text) => text === 'Review')).toHaveLength(2)
  })

  it('a finished workflow sits under Finished with the totals Claude reported and its phase titles, in both themes', async () => {
    for (const scheme of ['light', 'dark'] as const) {
      const { texts } = await render(scheme, [...workflowLaunchMessages(), workflowFinishedMessage()])
      expect(texts).toContain('Finished 1')
      expect(texts).toContain('pre-release-review-sweep')
      expect(texts).toContain('37 agents')
      expect(texts).toContain('4.9M tokens')
      expect(texts).toContain('1h 24m')
      expect(texts).toContain('Completed')
      expect(texts).toContain('Phases')
      expect(texts).toContain('Re-review')
      expect(texts.some((text) => /failed$|skipped$/.test(text))).toBe(false)
      act(() => renderer?.unmount())
      renderer = null
    }
  })

  it('a finished workflow with failed agents says so, in the danger tone', async () => {
    const notification = workflowFinishedMessage()
    const block = notification.blocks[0]
    const text = block?.type === 'text' ? block.text : ''
    const failed = { ...notification, blocks: [{ type: 'text' as const, text: text.replace('<agents_error>0</agents_error>', '<agents_error>3</agents_error>').replace('<agents_skipped>0</agents_skipped>', '<agents_skipped>2</agents_skipped>') }] }
    for (const [scheme, palette] of [
      ['light', lightColors],
      ['dark', darkColors]
    ] as const) {
      const { texts, colors } = await render(scheme, [...workflowLaunchMessages(), failed])
      expect(texts).toContain('3 failed')
      expect(texts).toContain('2 skipped')
      expect(colors).toContain(palette.danger)
      act(() => renderer?.unmount())
      renderer = null
    }
  })

  it('two workflows at once are two cards and the lane stays an ordinary agent row', async () => {
    const second = workflowLaunchMessages("export const meta = { name: 'docs-pass', description: 'Rewrite the docs', phases: [{ title: 'Draft' }] }").map((message, index) => ({
      ...message,
      id: `second-${index}`,
      blocks: message.blocks.map((block) =>
        block.type === 'tool-result' ? { ...block, output: block.output.replace(WORKFLOW_TASK_ID, 'wdocs0001') } : block
      )
    }))
    await act(async () => {
      renderer = create(
        <ThemeProvider initialPreference="light">
          <MobileBackgroundTasksSheetBody
            messages={[...workflowLaunchMessages(), ...second]}
            agentStatus={{ state: 'working', subagents: lanes(1) }}
            backgroundTaskReport={{ ...REPORT, stopRunningTaskIds: [WORKFLOW_TASK_ID, 'wdocs0001'] }}
          />
        </ThemeProvider>
      )
    })
    const { texts } = readTree(renderer!)
    expect(texts).toContain('pre-release-review-sweep')
    expect(texts).toContain('docs-pass')
    expect(texts.some((text) => text.endsWith(' running'))).toBe(false)
    expect(texts.filter((text) => text === 'Agent')).toHaveLength(1)
  })

  // A finished card can carry four captions (agents, tokens, failed, skipped)
  // and the row above them "Workflow · Completed · 1h 24m"; at a large font
  // scale on a 360dp phone they must wrap, not run past the card.
  it('lets its caption rows wrap, so four captions at a large font scale stay inside the card', async () => {
    const notification = workflowFinishedMessage()
    const block = notification.blocks[0]
    const text = block?.type === 'text' ? block.text : ''
    const failed = { ...notification, blocks: [{ type: 'text' as const, text: text.replace('<agents_error>0</agents_error>', '<agents_error>3</agents_error>').replace('<agents_skipped>0</agents_skipped>', '<agents_skipped>2</agents_skipped>') }] }
    await render('light', [...workflowLaunchMessages(), failed])
    const captionRows = renderer!.root.findAll((node) => {
      if (String(node.type) !== 'View') {
        return false
      }
      const style = Array.isArray(node.props.style) ? node.props.style : [node.props.style]
      return style.some((entry: unknown) => typeof entry === 'object' && entry !== null && Reflect.get(entry, 'flexDirection') === 'row') &&
        node.findAll((inner) => String(inner.type) === 'Text' && typeof inner.props.children === 'string' && /agents$|tokens$|failed$|skipped$|^Workflow$|^Completed$/.test(inner.props.children)).length > 0
    })
    expect(captionRows.length).toBeGreaterThanOrEqual(2)
    for (const row of captionRows) {
      const style = Array.isArray(row.props.style) ? row.props.style : [row.props.style]
      expect(style.some((entry: unknown) => typeof entry === 'object' && entry !== null && Reflect.get(entry, 'flexWrap') === 'wrap')).toBe(true)
    }
  })
})
