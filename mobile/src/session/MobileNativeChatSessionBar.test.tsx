import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatTaskList } from '../../../src/shared/native-chat-task-list'
import type { MobileGitStatusResult } from '../source-control/mobile-git-status'
import { darkColors, lightColors } from '../theme/tokens'

// The Claude Android app's session bar and todo card (1.261009.20): a todo
// pill "N/M tasks" with a progress ring that opens a card titled "N/M tasks
// complete"; a diff pill "Diff +A -R" (each count hidden at zero) labelled
// "Open diff" for a screen reader. Code UI's own sizes and colours.

const back = vi.hoisted(() => ({ handlers: [] as (() => boolean)[] }))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  BackHandler: {
    addEventListener: (_event: string, handler: () => boolean) => {
      back.handlers.push(handler)
      return { remove: () => back.handlers.splice(back.handlers.indexOf(handler), 1) }
    }
  },
  Keyboard: { dismiss: vi.fn() },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1, flatten: (s: unknown) => s },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('react-native-svg', () => ({ default: 'Svg', Circle: 'Circle' }))
vi.mock('lucide-react-native', () =>
  new Proxy({}, { get: (_t, name) => (typeof name === 'string' ? name : undefined), has: () => true })
)

import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatSessionBar } from './MobileNativeChatSessionBar'
import { sessionDiffTotals, type SessionDiffTotals } from './mobile-native-chat-session-bar-model'

// The plan from claude-task-tools-list.test.ts's real session, one step on.
const PLAN: NativeChatTaskList = {
  tasks: [
    { content: 'Scaffold Flutter app: project, theme, data layer, auth, nav shell', status: 'completed' },
    {
      content: 'Build five Flutter screens per mockups via parallel agents',
      status: 'in_progress',
      activeForm: 'Building the five Flutter screens'
    },
    { content: 'QA pass, bundle export, contrast gate, commit Tiles of Fact rebuild', status: 'pending' }
  ]
}

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function mount(props: {
  list: NativeChatTaskList | null
  diff?: SessionDiffTotals | null
  onOpenDiff?: () => void
  working?: boolean
  scheme?: 'light' | 'dark'
}) {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={props.scheme ?? 'light'}>
        <MobileNativeChatSessionBar
          list={props.list}
          diff={props.diff}
          onOpenDiff={props.onOpenDiff}
          working={props.working}
        />
      </ThemeProvider>
    )
  })
}

function byTestId(id: string): ReactTestInstance[] {
  return renderer!.root.findAll((node) => node.props.testID === id && typeof node.type === 'string')
}
function textsIn(node: ReactTestInstance): string[] {
  return node
    .findAll((child) => (child.type as unknown) === 'Text')
    .map((child) => child.props.children)
    .filter((child): child is string => typeof child === 'string')
}
function pill(id: string): ReactTestInstance {
  return renderer!.root.find((node) => node.props.testID === id && typeof node.props.onPress === 'function')
}
function colourOf(node: ReactTestInstance): string | undefined {
  const styles = [node.props.style].flat(3) as ({ color?: string } | null)[]
  return styles.findLast((style) => style?.color)?.color
}

describe('the todo pill', () => {
  it('says how far along the plan is, in the Claude app’s words', () => {
    mount({ list: PLAN })
    const todo = pill('todo-pill')
    expect(textsIn(todo)).toEqual(['1/3 tasks'])
    expect(todo.props.accessibilityLabel).toBe('1 of 3 tasks done')
    expect(todo.findAll((node) => (node.type as unknown) === 'Svg')).toHaveLength(1)
  })

  it('reads one task as one task, and shows nothing with no plan or an empty one', () => {
    mount({ list: { tasks: [{ content: 'Fix the parser', status: 'pending' }] } })
    expect(pill('todo-pill').props.accessibilityLabel).toBe('0 of 1 task done')
    act(() => renderer?.unmount())
    mount({ list: { tasks: [] } })
    expect(renderer!.toJSON()).toBeNull()
    act(() => renderer?.unmount())
    mount({ list: null })
    expect(renderer!.toJSON()).toBeNull()
  })

  it('swaps the ring for a check once every task is done', () => {
    mount({ list: { tasks: PLAN.tasks.map((task) => ({ ...task, status: 'completed' as const })) } })
    const todo = pill('todo-pill')
    expect(textsIn(todo)).toEqual(['3/3 tasks'])
    expect(todo.findAll((node) => (node.type as unknown) === 'Svg')).toHaveLength(0)
    expect(todo.findAll((node) => (node.type as unknown) === 'Check')).toHaveLength(1)
  })
})

describe('the todo card', () => {
  it('opens from the pill with "N/M tasks complete" and every task in its own words', () => {
    mount({ list: PLAN })
    act(() => pill('todo-pill').props.onPress())
    const card = byTestId('todo-card')[0]!
    expect(textsIn(card)[0]).toBe('1/3 tasks complete')
    expect(byTestId('todo-card-row').map((row) => row.props.children)).toEqual(PLAN.tasks.map((t) => t.content))
    expect(byTestId('todo-pill')).toEqual([])
  })

  it('strikes a done task through and marks it with a check in a tinted circle', () => {
    mount({ list: PLAN })
    act(() => pill('todo-pill').props.onPress())
    const rows = byTestId('todo-card-row')
    const struck = rows.map((row) =>
      ([row.props.style].flat(3) as ({ textDecorationLine?: string } | null)[]).some(
        (style) => style?.textDecorationLine === 'line-through'
      )
    )
    expect(struck).toEqual([true, false, false])
    expect(byTestId('todo-done-mark')).toHaveLength(1)
  })

  it('spins the running task while the agent works, and draws a third of a ring when it does not', () => {
    mount({ list: PLAN, working: true })
    act(() => pill('todo-pill').props.onPress())
    expect(byTestId('todo-running-spinner')).toHaveLength(1)
    act(() => renderer?.unmount())
    mount({ list: PLAN, working: false })
    act(() => pill('todo-pill').props.onPress())
    expect(byTestId('todo-running-spinner')).toHaveLength(0)
    const arcs = renderer!.root
      .findAll((node) => (node.type as unknown) === 'Circle' && node.props.strokeDasharray)
      .map((node) => node.props.strokeDasharray as string)
    expect(arcs).toHaveLength(1)
    const [shown, whole] = arcs[0]!.split(' ').map(Number)
    expect(shown! / whole!).toBeCloseTo(1 / 3)
  })

  it('joins the rows with a rail that stops at the last one, and a one-task card has none', () => {
    mount({ list: PLAN })
    act(() => pill('todo-pill').props.onPress())
    expect(byTestId('todo-rail')).toHaveLength(2)
    act(() => renderer?.unmount())
    mount({ list: { tasks: [PLAN.tasks[1]!] } })
    act(() => pill('todo-pill').props.onPress())
    expect(byTestId('todo-rail')).toHaveLength(0)
  })

  it('closes on its X and on Android Back, back to the pill', () => {
    mount({ list: PLAN })
    act(() => pill('todo-pill').props.onPress())
    act(() => renderer!.root.find((node) => node.props.accessibilityLabel === 'Close' && node.props.onPress).props.onPress())
    expect(byTestId('todo-card')).toEqual([])
    act(() => pill('todo-pill').props.onPress())
    let handled = false
    act(() => {
      handled = back.handlers.at(-1)!()
    })
    expect(handled).toBe(true)
    expect(byTestId('todo-card')).toEqual([])
    expect(back.handlers).toHaveLength(0)
  })

  // Opus review, 2026-10-12: the open flag outlived the plan, so the next plan
  // (after a /clear, or another session in the same view) came up as a card
  // nobody opened, holding Back.
  it('comes back as a pill, not an open card, when the plan goes away and a new one arrives', () => {
    mount({ list: PLAN })
    act(() => pill('todo-pill').props.onPress())
    expect(byTestId('todo-card')).toHaveLength(1)
    const update = (list: NativeChatTaskList | null) =>
      act(() =>
        renderer!.update(
          <ThemeProvider initialPreference="light">
            <MobileNativeChatSessionBar list={list} />
          </ThemeProvider>
        )
      )
    update(null)
    expect(renderer!.toJSON()).toBeNull()
    update({ tasks: [{ content: 'Fix the parser', status: 'pending' }] })
    expect(byTestId('todo-card')).toEqual([])
    expect(textsIn(pill('todo-pill'))).toEqual(['0/1 tasks'])
    expect(back.handlers).toHaveLength(0)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('paints the card and its marks from the %s theme', (scheme, palette) => {
    mount({ list: PLAN, scheme })
    act(() => pill('todo-pill').props.onPress())
    const card = byTestId('todo-card')[0]!
    expect(([card.props.style].flat(3) as { backgroundColor?: string }[]).find((s) => s?.backgroundColor)?.backgroundColor).toBe(
      palette.bgPanel
    )
    const mark = byTestId('todo-done-mark')[0]!
    expect(([mark.props.style].flat(3) as { backgroundColor?: string }[])[0]?.backgroundColor).toBe(palette.successSoft)
    expect(mark.findByType('Check' as never).props.color).toBe(palette.success)
  })
})

describe('the diff pill', () => {
  it('shows Diff with the added and removed lines, and opens the changes', () => {
    const onOpenDiff = vi.fn()
    mount({ list: null, diff: { files: 3, added: 128, removed: 14 }, onOpenDiff })
    const diff = pill('diff-pill')
    expect(diff.props.accessibilityLabel).toBe('Open diff')
    expect(textsIn(diff)).toEqual(['Diff', '+128', '-14'])
    act(() => diff.props.onPress())
    expect(onOpenDiff).toHaveBeenCalledTimes(1)
  })

  it('hides a count that is zero, and the pill with no change or no way to open it', () => {
    mount({ list: null, diff: { files: 1, added: 40, removed: 0 }, onOpenDiff: () => {} })
    expect(textsIn(pill('diff-pill'))).toEqual(['Diff', '+40'])
    act(() => renderer?.unmount())
    mount({ list: null, diff: null, onOpenDiff: () => {} })
    expect(renderer!.toJSON()).toBeNull()
    act(() => renderer?.unmount())
    mount({ list: null, diff: { files: 1, added: 2, removed: 1 } })
    expect(renderer!.toJSON()).toBeNull()
  })

  it('sits after the todo pill', () => {
    mount({ list: PLAN, diff: { files: 1, added: 2, removed: 1 }, onOpenDiff: () => {} })
    const bar = byTestId('session-bar')[0]!
    const order = bar
      .findAll((node) => (node.type as unknown) === 'Pressable' && typeof node.props.testID === 'string')
      .map((n) => n.props.testID)
    expect(order).toEqual(['todo-pill', 'diff-pill'])
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('colours the counts from the %s theme', (scheme, palette) => {
    mount({ list: null, diff: { files: 1, added: 2, removed: 1 }, onOpenDiff: () => {}, scheme })
    const counts = pill('diff-pill').findAll((node) => (node.type as unknown) === 'Text' && /^[+-]\d/.test(String(node.props.children)))
    expect(counts.map(colourOf)).toEqual([palette.diffAddText, palette.diffDelText])
  })
})

describe('the diff totals from git.status', () => {
  const entry = (path: string, area: 'staged' | 'unstaged' | 'untracked', added?: number, removed?: number) => ({
    path,
    status: area === 'untracked' ? ('untracked' as const) : ('modified' as const),
    area,
    ...(added === undefined ? {} : { added }),
    ...(removed === undefined ? {} : { removed })
  })

  it('sums every row, staged and unstaged alike, and counts a file once', () => {
    const status = {
      entries: [
        entry('mobile/src/a.ts', 'staged', 10, 2),
        entry('mobile/src/a.ts', 'unstaged', 3, 1),
        entry('docs/new.md', 'untracked', 40),
        entry('assets/logo.png', 'unstaged')
      ]
    } as unknown as MobileGitStatusResult
    expect(sessionDiffTotals(status)).toEqual({ files: 3, added: 53, removed: 3 })
  })

  it('has no totals for a clean tree or a status it could not read', () => {
    expect(sessionDiffTotals({ entries: [] } as unknown as MobileGitStatusResult)).toBeNull()
    expect(sessionDiffTotals(null)).toBeNull()
  })
})
