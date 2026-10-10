import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { parseClaudeRunningShellCount } from './claude-footer-shell-count'
import { MobileBackgroundTasksSheetBody } from './MobileBackgroundTasksSheet'
import type { ActiveTabBackgroundTaskReport } from './use-active-tab-finished-task-ids'
import {
  PROBE_A,
  PROBE_B,
  TWO_SUBAGENT_SHELLS_SCREEN,
  screenRows,
  twoAgentLaunches,
  workingRow
} from './fixtures/claude-subagent-shells-2.1.296'

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

// Claude Code 2.1.296, 2026-10-10: two background agents each running a
// background `sleep 150`, the lead with no shell of its own, and the footer
// reading "· 2 shells" (fixtures/claude-subagent-shells-2.1.296.ts).
const NOW = Date.parse('2026-10-10T16:24:07.000Z')

function report(onScreenShellCount: number | null): ActiveTabBackgroundTaskReport {
  return { finishedTaskIds: [], runningTaskIds: null, runningTaskIdsAt: null, launchedTaskIds: [], onScreenShellCount }
}

type Rendered = { texts: string[]; colorsByText: Map<string, string | undefined> }

function readTree(renderer: ReactTestRenderer): Rendered {
  const texts: string[] = []
  const colorsByText = new Map<string, string | undefined>()
  for (const node of renderer.root.findAllByType('Text' as never)) {
    const children: unknown = node.props.children
    if (typeof children !== 'string') {
      continue
    }
    texts.push(children)
    const style: unknown = node.props.style
    const flat = (Array.isArray(style) ? style : [style]) as unknown[]
    // The last colour wins, as React Native flattens a style array.
    const colors = flat
      .map((entry) => (entry && typeof entry === 'object' && 'color' in entry ? (entry as { color: unknown }).color : undefined))
      .filter((value): value is string => typeof value === 'string')
    colorsByText.set(children, colors.at(-1))
  }
  return { texts, colorsByText }
}

describe("the sheet's line for shells running inside subagents", () => {
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

  async function renderSheet(scheme: 'light' | 'dark', footerCount: number | null): Promise<Rendered> {
    const agentStatus = {
      state: 'working' as const,
      subagents: [workingRow(PROBE_A, '2026-10-10T16:23:43.000Z'), workingRow(PROBE_B, '2026-10-10T16:23:43.000Z')]
    }
    await act(async () => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileBackgroundTasksSheetBody
            messages={twoAgentLaunches()}
            agent="claude"
            agentStatus={agentStatus}
            backgroundTaskReport={report(footerCount)}
          />
        </ThemeProvider>
      )
    })
    return readTree(renderer!)
  }

  it('shows "+2 shells in subagents" under the two agents, read from the real footer', async () => {
    const { texts } = await renderSheet('light', parseClaudeRunningShellCount(screenRows(TWO_SUBAGENT_SHELLS_SCREEN)))
    expect(texts).toContain('Sleep probe A')
    expect(texts).toContain('Sleep probe B')
    expect(texts).toContain('+2 shells in subagents')
    expect(texts.indexOf('+2 shells in subagents')).toBeGreaterThan(texts.indexOf('Sleep probe B'))
  })

  it('shows no such line when the footer is not on screen', async () => {
    const { texts } = await renderSheet('light', null)
    expect(texts.some((text) => text.includes('in subagents'))).toBe(false)
  })

  it('paints the line in the muted tone of the active theme, light and dark', async () => {
    const light = await renderSheet('light', 2)
    expect(light.colorsByText.get('+2 shells in subagents')).toBe(lightColors.textMuted)
    act(() => renderer?.unmount())
    renderer = null
    const dark = await renderSheet('dark', 2)
    expect(dark.colorsByText.get('+2 shells in subagents')).toBe(darkColors.textMuted)
  })
})
