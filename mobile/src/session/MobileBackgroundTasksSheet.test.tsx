import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionBackgroundTaskState } from '../../../src/shared/agent-session-wire'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileBackgroundTasksSheetBody } from './MobileBackgroundTasksSheet'
import { MobileBackgroundTasksRow } from './MobileBackgroundTasksRow'
import { peekSubagentTranscript, resetSubagentTranscriptForTests } from './subagent-transcript-store'

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
// The drawer shell pulls in gesture-handler's Flow-typed RN internals, which
// Node cannot parse; the body under test never touches it.
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))
vi.mock('lucide-react-native', () => ({
  Activity: 'Activity',
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  Diamond: 'Diamond',
  ListTree: 'ListTree',
  Sparkles: 'Sparkles',
  Square: 'Square',
  Terminal: 'Terminal'
}))

const T0 = Date.UTC(2026, 8, 9, 12, 0, 0)
const NOW = T0 + 19 * 60_000 + 8_000

const backgroundStartOutput = (id: string) =>
  `Command running in background with ID: ${id}. Output is being written to: /private/tmp/claude-501/tasks/${id}.output. You will be notified when it completes. To check interim output, use Read on that file path.`

function messages(): NativeChatMessage[] {
  return [
    {
      id: 'a1',
      role: 'assistant',
      timestamp: T0,
      source: 'transcript',
      blocks: [
        {
          type: 'tool-call',
          name: 'Bash',
          input: { command: 'pnpm build', description: 'Build 0.2.60 locally for the phone', run_in_background: true }
        }
      ]
    },
    {
      id: 'r1',
      role: 'user',
      timestamp: T0 + 10,
      source: 'transcript',
      blocks: [{ type: 'tool-result', output: backgroundStartOutput('bpz1skord') }]
    },
    {
      id: 'a2',
      role: 'assistant',
      timestamp: T0 + 20,
      source: 'transcript',
      blocks: [
        { type: 'tool-call', name: 'Bash', input: { command: './scripts/deploy.sh', description: 'Deploy to staging' } }
      ]
    },
    {
      id: 'r2',
      role: 'user',
      timestamp: T0 + 30,
      source: 'transcript',
      blocks: [{ type: 'tool-result', output: backgroundStartOutput('bhlua4cdn') }]
    },
    {
      id: 'n1',
      role: 'user',
      timestamp: T0 + 40,
      source: 'transcript',
      blocks: [
        {
          type: 'text',
          text: `<task-notification>
<task-id>bhlua4cdn</task-id>
<tool-use-id>d9a2b920-342f-45a2-9470-49db0c1cb343:inner</tool-use-id>
<output-file>/private/tmp/claude-501/tasks/bhlua4cdn.output</output-file>
<status>failed</status>
<summary>Background command "./scripts/deploy.sh" failed with exit code 1</summary>
</task-notification>`
        }
      ]
    }
  ]
}

/** `count` shells, every one of them already reported back as completed. */
function manyFinished(count: number): NativeChatMessage[] {
  const out: NativeChatMessage[] = []
  for (let index = 0; index < count; index += 1) {
    const id = `bfin${String(index).padStart(5, '0')}`
    out.push(
      {
        id: `a-${id}`,
        role: 'assistant',
        timestamp: T0 + index,
        source: 'transcript',
        blocks: [
          {
            type: 'tool-call',
            name: 'Bash',
            input: { command: `job-${index}.sh`, run_in_background: true }
          }
        ]
      },
      {
        id: `r-${id}`,
        role: 'user',
        timestamp: T0 + index,
        source: 'transcript',
        blocks: [{ type: 'tool-result', output: backgroundStartOutput(id) }]
      },
      {
        id: `n-${id}`,
        role: 'user',
        timestamp: T0 + index,
        source: 'transcript',
        blocks: [
          {
            type: 'text',
            text: `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n<summary>Background command "job-${index}.sh" completed (exit code 0)</summary>\n</task-notification>`
          }
        ]
      }
    )
  }
  return out
}

type Rendered = { texts: string[]; colors: string[] }

async function press(renderer: ReactTestRenderer, accessibilityLabel: string): Promise<void> {
  const target = renderer.root
    .findAllByType('Pressable')
    .find((node) => node.props.accessibilityLabel === accessibilityLabel)
  if (!target) {
    throw new Error(`no pressable labelled "${accessibilityLabel}"`)
  }
  await act(async () => {
    target.props.onPress()
  })
}

function readTree(renderer: ReactTestRenderer): Rendered {
  const texts: string[] = []
  const colors: string[] = []
  for (const node of renderer.root.findAllByType('Text')) {
    const children = node.props.children
    if (typeof children === 'string') {
      texts.push(children)
    }
    const style = node.props.style
    const flat = Array.isArray(style) ? style : [style]
    for (const entry of flat) {
      if (entry && typeof entry === 'object' && typeof entry.color === 'string') {
        colors.push(entry.color)
      }
    }
  }
  return { texts, colors }
}

describe('the background tasks sheet', () => {
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

  async function renderSheet(scheme: 'light' | 'dark'): Promise<Rendered> {
    await act(async () => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: scheme },
          createElement(MobileBackgroundTasksSheetBody, { messages: messages() })
        )
      )
    })
    return readTree(renderer!)
  }

  it('shows a running shell with its live elapsed time and no stop control', async () => {
    const { texts } = await renderSheet('light')
    expect(texts).toContain('Background tasks')
    expect(texts).toContain('Running')
    expect(texts).toContain('Build 0.2.60 locally for the phone')
    expect(texts).toContain('Shell')
    expect(texts).toContain('19m 8s')
    expect(texts.some((text) => /stop/i.test(text))).toBe(false)
  })

  it('counts the finished section and shows a failure in the danger tone', async () => {
    const { texts, colors } = await renderSheet('light')
    expect(texts).toContain('Finished 1')
    expect(texts).toContain('Deploy to staging')
    expect(texts).toContain('Failed')
    expect(colors).toContain(lightColors.danger)
  })

  it('shows finished tasks ten at a time behind a Load more button', async () => {
    await act(async () => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: 'light' },
          createElement(MobileBackgroundTasksSheetBody, { messages: manyFinished(12) })
        )
      )
    })
    const first = readTree(renderer!)
    expect(first.texts).toContain('Finished 12')
    expect(first.texts.filter((text) => text === 'Completed')).toHaveLength(10)
    expect(first.texts).toContain('Load more')
    await press(renderer!, 'Load more finished tasks')
    const second = readTree(renderer!)
    expect(second.texts.filter((text) => text === 'Completed')).toHaveLength(12)
    expect(second.texts).not.toContain('Load more')
  })

  it('folds a section away when its chevron is tapped', async () => {
    await renderSheet('light')
    await press(renderer!, 'Running, collapse')
    const collapsed = readTree(renderer!)
    expect(collapsed.texts).toContain('Running')
    expect(collapsed.texts).not.toContain('Build 0.2.60 locally for the phone')
    await press(renderer!, 'Running, expand')
    expect(readTree(renderer!).texts).toContain('Build 0.2.60 locally for the phone')
  })

  it('paints from the theme in dark mode too, not a hardcoded palette', async () => {
    const light = await renderSheet('light')
    act(() => renderer?.unmount())
    renderer = null
    const dark = await renderSheet('dark')
    expect(dark.texts).toEqual(light.texts)
    expect(dark.colors).toContain(darkColors.danger)
    expect(dark.colors).not.toContain(lightColors.text)
    expect(light.colors).not.toContain(darkColors.text)
  })
})

describe('the running tasks row', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  async function renderRow(runningCount: number, scheme: 'light' | 'dark'): Promise<Rendered> {
    await act(async () => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: scheme },
          createElement(MobileBackgroundTasksRow, { runningCount, onPress: () => {} })
        )
      )
    })
    return readTree(renderer!)
  }

  it('says "1 running task" for one and "2 running tasks" for two', async () => {
    expect((await renderRow(1, 'light')).texts).toContain('1 running task')
    act(() => renderer?.unmount())
    renderer = null
    expect((await renderRow(2, 'light')).texts).toContain('2 running tasks')
  })

  it('stays away entirely when nothing is running, as on a Codex tab', async () => {
    expect((await renderRow(0, 'light')).texts).toEqual([])
  })

  it('uses the accent of whichever theme is on', async () => {
    expect((await renderRow(1, 'light')).colors).toContain(lightColors.accentText)
    act(() => renderer?.unmount())
    renderer = null
    expect((await renderRow(1, 'dark')).colors).toContain(darkColors.accentText)
  })
})

// ─── The structured lane, where the host publishes the provider's roster ─────

const HOST_ROSTER: AgentSessionBackgroundTaskState = {
  state: 'monitoring',
  supportsTaskStop: true,
  tasks: [
    {
      id: 'task-live',
      kind: 'agent',
      description: 'Audit the release notes',
      state: 'working',
      startedAt: NOW - (19 * 60_000 + 8_000)
    },
    { id: 'task-watch', kind: 'monitor', description: 'Watch the build log', state: 'monitoring' }
  ],
  settledTasks: [{ id: 'task-gone', kind: 'command', description: 'pnpm test', state: 'blocked' }]
}

describe('a structured tab reading its background tasks from the host', () => {
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

  async function renderHosted(
    scheme: 'light' | 'dark',
    props: {
      hostBackgroundTasks?: AgentSessionBackgroundTaskState | null
      onStopTask?: (taskId: string) => void
    } = {}
  ): Promise<Rendered> {
    await act(async () => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: scheme },
          createElement(MobileBackgroundTasksSheetBody, {
            messages: messages(),
            hostBackgroundTasks: HOST_ROSTER,
            ...props
          })
        )
      )
    })
    return readTree(renderer!)
  }

  // 2026-09-15, user's instruction: "remove that header like agents 2". The
  // per-kind labels ("Shells · 4", "Agents · 2") are gone and every running
  // task is listed straight through — the row's own count already says how
  // many. This supersedes the 2026-09-14 ask to group the two kinds.
  it('lists running work straight through, with no per-kind headings', async () => {
    const { texts } = await renderHosted('light')
    expect(texts).toContain('Audit the release notes')
    expect(texts).toContain('Watch the build log')
    expect(texts.some((line) => /^(Shell|Agent|Monitor)s? · \d+$/.test(line))).toBe(false)
  })

  it("shows the host's roster instead of what the transcript guessed", async () => {
    const { texts } = await renderHosted('light')
    expect(texts).toContain('Audit the release notes')
    expect(texts).toContain('Watch the build log')
    expect(texts).toContain('Monitor')
    expect(texts).toContain('19m 8s')
    // The transcript's own reading of this same message list must not leak in.
    expect(texts).not.toContain('Build 0.2.60 locally for the phone')
  })

  it('reads a settled task the host blocked as a failure', async () => {
    const { texts, colors } = await renderHosted('light')
    expect(texts).toContain('Finished 1')
    expect(texts).toContain('pnpm test')
    expect(texts).toContain('Failed')
    expect(colors).toContain(lightColors.danger)
  })

  it('stops one named task when its stop is pressed', async () => {
    const stopped: string[] = []
    await renderHosted('light', { onStopTask: (taskId) => stopped.push(taskId) })
    await press(renderer!, 'Stop Audit the release notes')
    expect(stopped).toEqual(['task-live'])
  })

  it('offers no stop at all when the caller passes no handler', async () => {
    await renderHosted('light')
    const stops = renderer!.root
      .findAllByType('Pressable')
      .filter((node) => String(node.props.accessibilityLabel ?? '').startsWith('Stop '))
    expect(stops).toHaveLength(0)
  })

  it('says nothing is running once the host clears the roster', async () => {
    // Not the same as a host that never reported: the transcript reader must
    // not take the tab back and re-list work the host has said is gone.
    await act(async () => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: 'light' },
          createElement(MobileBackgroundTasksSheetBody, {
            messages: messages(),
            hostBackgroundTasks: null
          })
        )
      )
    })
    const { texts } = readTree(renderer!)
    expect(texts).toContain('Nothing running.')
    expect(texts).not.toContain('Build 0.2.60 locally for the phone')
  })

  it('paints the host roster from the theme in dark mode too', async () => {
    const light = await renderHosted('light')
    act(() => renderer?.unmount())
    renderer = null
    const dark = await renderHosted('dark')
    expect(dark.texts).toEqual(light.texts)
    expect(dark.colors).toContain(darkColors.danger)
    expect(dark.colors).not.toContain(lightColors.text)
    expect(light.colors).not.toContain(darkColors.text)
  })
})

// ─── Tapping a subagent opens what it did ────────────────────────────────────
// The Agent tool's result carries `agentId: <id>`, and Claude Code writes that
// subagent's transcript as `<parent dir>/<parentSessionId>/subagents/agent-<id>.jsonl`
// (verified on this machine 2026-09-18, Claude Code 2.1.275). The row hands the
// viewer that file plus the one session key the host can match to it alone.

const PARENT_TRANSCRIPT =
  '/Users/me/.claude/projects/-Users-me-Desktop-Project/5d877e39-1867-424f-86b5-c080713c1563.jsonl'

/** A transcript with one running subagent (from a real Agent launch record). */
function withSubagent(): NativeChatMessage[] {
  return [
    {
      id: 'a9',
      role: 'assistant',
      timestamp: T0,
      source: 'transcript',
      blocks: [
        {
          type: 'tool-call',
          name: 'Agent',
          input: { description: 'Audit the release notes', subagent_type: 'Explore', prompt: '…' }
        }
      ]
    },
    {
      id: 'r9',
      role: 'user',
      timestamp: T0 + 10,
      source: 'transcript',
      blocks: [
        {
          type: 'tool-result',
          output:
            'Async agent launched successfully.\nagentId: a7139263d97426e10 (internal ID - do not mention to user. Only use for AgentOutputTool calls)\noutput_file: /private/tmp/claude-501/tasks/a7139263d97426e10.output'
        }
      ]
    }
  ]
}

describe('tapping a subagent on the roster', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    resetSubagentTranscriptForTests()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.useRealTimers()
    resetSubagentTranscriptForTests()
  })

  async function renderWith(
    props: Partial<Parameters<typeof MobileBackgroundTasksSheetBody>[0]>
  ): Promise<Rendered> {
    await act(async () => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: 'light' },
          createElement(MobileBackgroundTasksSheetBody, { messages: withSubagent(), ...props })
        )
      )
    })
    return readTree(renderer!)
  }

  function openLabels(): string[] {
    return renderer!.root
      .findAllByType('Pressable')
      .map((node) => String(node.props.accessibilityLabel ?? ''))
      .filter((label) => label.startsWith('Open '))
  }

  it("opens the subagent's own transcript, beside the parent's, when its row is tapped", async () => {
    await renderWith({
      agent: 'claude',
      agentStatus: {
        state: 'working',
        // The host still tracks it, so the row is a running one.
        subagents: [{ id: 'a7139263d97426e10', state: 'working', startedAt: T0 }],
        providerSession: {
          key: 'claude',
          id: '5d877e39-1867-424f-86b5-c080713c1563',
          transcriptPath: PARENT_TRANSCRIPT
        }
      }
    })
    await press(renderer!, 'Open Audit the release notes')
    expect(peekSubagentTranscript()).toEqual({
      running: true,
      target: {
        agent: 'claude',
        agentId: 'a7139263d97426e10',
        sessionId: 'agent-a7139263d97426e10',
        transcriptPath:
          '/Users/me/.claude/projects/-Users-me-Desktop-Project/5d877e39-1867-424f-86b5-c080713c1563/subagents/agent-a7139263d97426e10.jsonl',
        title: 'Audit the release notes'
      }
    })
  })

  it('still opens it by session key alone when the desktop has not said where the parent transcript is', async () => {
    await renderWith({ agent: 'claude', agentStatus: { state: 'working' } })
    await press(renderer!, 'Open Audit the release notes')
    expect(peekSubagentTranscript()?.target).toMatchObject({
      sessionId: 'agent-a7139263d97426e10',
      transcriptPath: null
    })
  })

  it('draws the tappable card from whichever theme is on, pressed or not', async () => {
    const cardStyle = (pressed: boolean) => {
      const card = renderer!.root
        .findAllByType('Pressable')
        .find((node) => node.props.accessibilityLabel === 'Open Audit the release notes')
      return card!.props.style({ pressed })
    }
    await renderWith({ agent: 'claude' })
    expect(cardStyle(false).backgroundColor).toBe(lightColors.bgRaised)
    expect(cardStyle(true).backgroundColor).toBe(lightColors.bgSunken)
    expect(cardStyle(false).borderColor).toBe(lightColors.border)
    act(() => renderer?.unmount())
    renderer = null
    await act(async () => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: 'dark' },
          createElement(MobileBackgroundTasksSheetBody, { messages: withSubagent(), agent: 'claude' })
        )
      )
    })
    expect(cardStyle(false).backgroundColor).toBe(darkColors.bgRaised)
    expect(cardStyle(true).backgroundColor).toBe(darkColors.bgSunken)
    expect(cardStyle(false).borderColor).toBe(darkColors.border)
  })

  it('gives a Codex tab no tap target: Codex has no subagents', async () => {
    await renderWith({ agent: 'codex' })
    expect(openLabels()).toEqual([])
    expect(peekSubagentTranscript()).toBeNull()
  })

  it('gives a tab whose agent is unknown no tap target either', async () => {
    await renderWith({})
    expect(openLabels()).toEqual([])
  })

  it('gives shells no tap target, only agents', async () => {
    await renderWith({ agent: 'claude', messages: messages() })
    expect(openLabels()).toEqual([])
  })

  it("opens a subagent from the host's own roster on the structured lane too, and a finished one as finished", async () => {
    await renderWith({
      agent: 'claude',
      hostBackgroundTasks: {
        state: 'monitoring',
        tasks: [
          { id: 'a7139263d97426e10', kind: 'agent', description: 'Audit the release notes', state: 'working' }
        ],
        settledTasks: [
          { id: 'b8240374e08537f21', kind: 'agent', description: 'Sweep the tests', state: 'done' }
        ]
      }
    })
    expect(openLabels()).toEqual(['Open Audit the release notes', 'Open Sweep the tests'])
    await press(renderer!, 'Open Sweep the tests')
    expect(peekSubagentTranscript()).toMatchObject({
      running: false,
      target: { sessionId: 'agent-b8240374e08537f21', transcriptPath: null }
    })
  })
})
