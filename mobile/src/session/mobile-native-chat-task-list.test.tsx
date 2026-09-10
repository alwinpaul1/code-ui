// Orca #19230 (d15a6df22) on the phone. Before this, an agent's plan reached
// the phone as the raw JSON of its own tool input — `{"todos":[{"content":…` —
// collapsed into one truncated line and pretty-printed underneath. Both agents
// keep a plan and both send it this way: Claude Code as `TodoWrite`, Codex as
// `update_plan`. Upstream shipped the checklist desktop-only.
//
// Fixtures are the tool inputs as the agents actually send them. Claude Code
// carries `todos[].content` plus an `activeForm` it wants shown while a step
// runs; Codex carries `plan[].step` plus a free-text `explanation`.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'
import { ToolRun } from './MobileNativeChatToolRun'
import { MobileNativeChatTaskList } from './MobileNativeChatTaskList'

vi.mock('react-native', () => ({
  Animated: {
    Text: 'Text',
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
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  Circle: 'Circle',
  CircleCheck: 'CircleCheck',
  CircleDot: 'CircleDot',
  FileMinus2: 'FileMinus2',
  FilePen: 'FilePen',
  FilePlus2: 'FilePlus2',
  ListChecks: 'ListChecks',
  SquareChevronRight: 'SquareChevronRight',
  SquareTerminal: 'SquareTerminal',
  Wrench: 'Wrench'
}))

function todoWrite(
  todos: { content: string; status: string; activeForm?: string }[]
): NativeChatBlock[] {
  return [
    { type: 'tool-call', name: 'TodoWrite', input: { todos }, state: 'completed' },
    { type: 'tool-result', output: 'Todos have been modified successfully.' }
  ]
}

const CLAUDE_PLAN = todoWrite([
  { content: 'Read the parser', status: 'completed', activeForm: 'Reading the parser' },
  { content: 'Write the failing test', status: 'in_progress', activeForm: 'Writing the test' },
  { content: 'Run the gate', status: 'pending', activeForm: 'Running the gate' }
])

// Codex names the step `step`, spells its running state `inProgress`, and adds
// a sentence of its own about the revision.
const CODEX_PLAN: NativeChatBlock[] = [
  {
    type: 'tool-call',
    name: 'update_plan',
    input: {
      explanation: 'Splitting the parser work in two.',
      plan: [
        { step: 'Read the parser', status: 'completed' },
        { step: 'Write the failing test', status: 'inProgress' },
        { step: 'Run the gate', status: 'pending' }
      ]
    },
    state: 'completed'
  },
  { type: 'tool-result', output: 'Plan updated' }
]

// The same list twice in one turn, which is how both agents report progress.
const CLAUDE_PLAN_UPDATED: NativeChatBlock[] = [
  ...todoWrite([
    { content: 'Read the parser', status: 'in_progress', activeForm: 'Reading the parser' },
    { content: 'Run the gate', status: 'pending', activeForm: 'Running the gate' }
  ]),
  ...todoWrite([
    { content: 'Read the parser', status: 'completed', activeForm: 'Reading the parser' },
    { content: 'Run the gate', status: 'pending', activeForm: 'Running the gate' },
    { content: 'Tag the release', status: 'pending', activeForm: 'Tagging the release' }
  ])
]

const FAILED_PLAN: NativeChatBlock[] = [
  {
    type: 'tool-call',
    name: 'TodoWrite',
    input: { todos: [{ content: 'Read the parser', status: 'pending' }] },
    state: 'failed'
  },
  { type: 'tool-result', output: 'InputValidationError: todos is required', isError: true }
]

function Harness({
  blocks,
  taskListPredecessors
}: {
  blocks: NativeChatBlock[]
  taskListPredecessors?: Parameters<typeof ToolRun>[0]['taskListPredecessors']
}): React.JSX.Element {
  const styles = useChatMessageStyles()
  return createElement(ToolRun, {
    blocks,
    defaultExpanded: true,
    activeCall: null,
    taskListPredecessors,
    styles
  })
}

function styleValue(style: unknown, key: string): string | undefined {
  const entries = Array.isArray(style) ? style.flat(3) : [style]
  let found: string | undefined
  for (const entry of entries) {
    const value = (entry as Record<string, unknown> | null | undefined)?.[key]
    if (typeof value === 'string') {
      found = value
    }
  }
  return found
}

describe('an agent plan in the chat transcript', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(
    blocks: NativeChatBlock[],
    scheme: 'light' | 'dark' = 'light',
    taskListPredecessors?: Parameters<typeof ToolRun>[0]['taskListPredecessors']
  ) {
    act(() => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: scheme },
          createElement(Harness, { blocks, taskListPredecessors })
        )
      )
    })
    const texts: string[] = []
    for (const node of renderer!.root.findAllByType('Text')) {
      if (typeof node.props.children === 'string') {
        texts.push(node.props.children)
      }
    }
    const tasks = renderer!.root
      .findAll((node) => node.props?.testID === 'task-list-row')
      .map((node) => ({
        text: String(node.props.children ?? ''),
        color: styleValue(node.props.style, 'color')
      }))
    const line = renderer!.root
      .findAll((node) => node.props?.testID === 'tool-line-preview')
      .map((node) => String(node.props.children ?? ''))
    const runArg = renderer!.root
      .findAll((node) => node.props?.testID === 'tool-run-member-arg')
      .map((node) => String(node.props.children ?? '').trim())
    return { texts, tasks, line, runArg }
  }

  function renderComposer(scheme: 'light' | 'dark' = 'light') {
    const list = {
      tasks: [
        { content: 'Read the parser', status: 'completed' as const },
        {
          content: 'Write the failing test',
          status: 'in_progress' as const,
          activeForm: 'Writing the test'
        }
      ]
    }
    act(() => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: scheme },
          createElement(MobileNativeChatTaskList, { list, presentation: 'composer' })
        )
      )
    })
    const strip = renderer!.root.findByProps({ testID: 'composer-task-progress' })
    const texts: string[] = []
    for (const node of strip.findAllByType('Text')) {
      if (typeof node.props.children === 'string') {
        texts.push(node.props.children)
      }
    }
    return { strip, texts }
  }

  it("shows Claude's plan as a checklist instead of the raw JSON of its input", () => {
    const { texts, tasks, line, runArg } = render(CLAUDE_PLAN)
    expect(tasks.map((task) => task.text)).toEqual([
      'Read the parser',
      // The step that is running takes the agent's own present-tense wording.
      'Writing the test',
      'Run the gate'
    ])
    expect(texts).toContain('1/3')
    // Collapsed, the row itself is the only thing on screen, so it says how far
    // along the plan is instead of the first 28 characters of its JSON.
    expect(line).toEqual(['1/3 · Writing the test'])
    // The run header used to stand the first 28 characters of that JSON in for
    // an argument: `{"todos":[{"content":"Read t`. Name the plan the same way
    // the row does.
    expect(runArg).toEqual(['1/3 · Writing the test'])
    expect(texts.some((text) => text.includes('{"todos"'))).toBe(false)
    // And nothing pretty-prints the input underneath it. `"status": "` with the
    // space is `JSON.stringify(…, null, 2)`; the old expanded detail was that.
    expect(texts.some((text) => text.includes('"status": "'))).toBe(false)
  })

  it("shows Codex's plan too, under its own field names and its own spelling", () => {
    const { texts, tasks, line, runArg } = render(CODEX_PLAN)
    expect(tasks.map((task) => task.text)).toEqual([
      'Read the parser',
      'Write the failing test',
      'Run the gate'
    ])
    expect(texts).toContain('1/3')
    expect(texts).toContain('Splitting the parser work in two.')
    expect(line).toEqual(['1/3 · Write the failing test'])
    expect(runArg).toEqual(['1/3 · Write the failing test'])
    expect(texts.some((text) => text.includes('"plan"'))).toBe(false)
    expect(texts.some((text) => text.includes('"status": "'))).toBe(false)
  })

  it('diffs a later turn against the plan from an earlier message', () => {
    const { texts } = render(todoWrite([{ content: 'Read the parser', status: 'completed' }]), 'light', {
      todowrite: {
        tasks: [{ content: 'Read the parser', status: 'pending' }]
      }
    })
    expect(texts).toContain('Completed Read the parser')
  })

  it('says what changed when the agent revises its plan inside one turn', () => {
    const { texts } = render(CLAUDE_PLAN_UPDATED)
    expect(texts).toContain('Completed Read the parser')
    expect(texts).toContain('Added Tag the release')
    // The first call still shows the whole list: nothing came before it.
    expect(texts).toContain('Reading the parser')
  })

  it('keeps the provider error visible when the plan call failed', () => {
    const { texts, tasks } = render(FAILED_PLAN)
    expect(tasks).toEqual([])
    expect(texts).toContain('InputValidationError: todos is required')
  })

  it('tints a finished step for the theme in use, in light and in dark', () => {
    const light = render(CLAUDE_PLAN)
    const lightDone = light.tasks[0]?.color
    act(() => renderer?.unmount())
    renderer = null
    const dark = render(CLAUDE_PLAN, 'dark')
    const darkDone = dark.tasks[0]?.color
    expect(lightDone).toBe(lightColors.success)
    expect(darkDone).toBe(darkColors.success)
    expect(lightDone).not.toBe(darkDone)
  })

  it('offers the latest plan as a collapsed Tasks strip for the composer', () => {
    const { strip, texts } = renderComposer()
    expect(texts).toContain('Tasks')
    expect(texts).toContain('1/2')
    expect(strip.findAll((node) => node.props?.testID === 'task-list-row')).toEqual([])
  })

  it('expands the composer strip into the checklist on tap', () => {
    const { strip } = renderComposer()
    act(() => {
      strip.findByType('Pressable').props.onPress()
    })
    expect(
      strip
        .findAll((node) => node.props?.testID === 'task-list-row')
        .map((node) => String(node.props.children ?? ''))
    ).toEqual(['Read the parser', 'Writing the test'])
  })

  it('paints the composer strip from the theme in light and in dark', () => {
    const light = styleValue(renderComposer('light').strip.props.style, 'backgroundColor')
    act(() => renderer?.unmount())
    renderer = null
    const dark = styleValue(renderComposer('dark').strip.props.style, 'backgroundColor')
    expect(light).toBe(lightColors.bgSunken)
    expect(dark).toBe(darkColors.bgSunken)
    expect(light).not.toBe(dark)
  })

  it('tints the running step for the theme in use, in light and in dark', () => {
    const light = render(CLAUDE_PLAN)
    const lightActive = light.tasks[1]?.color
    act(() => renderer?.unmount())
    renderer = null
    const dark = render(CLAUDE_PLAN, 'dark')
    const darkActive = dark.tasks[1]?.color
    expect(lightActive).toBe(lightColors.text)
    expect(darkActive).toBe(darkColors.text)
    expect(lightActive).not.toBe(darkActive)
  })
})
