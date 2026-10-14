import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatTaskList } from '../../../src/shared/native-chat-task-list'
import { darkColors, lightColors } from '../theme/tokens'

// The Claude app fades what sits beside its to-do pill in over 150 ms on
// cubic-bezier(0.4, 0, 0.2, 1) when it appears, and takes it away at once
// (yfy.java:3873: `animateFloatAsState(shown ? 1 : 0, shown ? tween(150) : snap)`).
// A value that animates starts at its target, so a pill that is there when the
// screen opens does not fade: only one that arrives while the screen is open does.

const seen = vi.hoisted(() => ({
  timings: [] as { to: number; config: { duration?: number; easing?: unknown } | undefined }[],
  reduced: false as boolean | null
}))

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  BackHandler: { addEventListener: () => ({ remove: () => undefined }) },
  Keyboard: { dismiss: vi.fn() },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1, flatten: (s: unknown) => s },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('react-native-svg', () => ({ default: 'Svg', Circle: 'Circle' }))
vi.mock(
  'lucide-react-native',
  () =>
    new Proxy(
      {},
      { get: (_t, name) => (typeof name === 'string' ? name : undefined), has: () => true }
    )
)
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => seen.reduced }))
// The repo's stand-in, with a value that is kept across renders and every tween recorded.
vi.mock('react-native-reanimated', async (importOriginal) => {
  const React = await import('react')
  return {
    ...(await importOriginal<typeof import('react-native-reanimated')>()),
    useSharedValue: (initial: number) => React.useRef({ value: initial }).current,
    withTiming: (to: number, config?: { duration?: number; easing?: unknown }) => {
      seen.timings.push({ to, config })
      return to
    }
  }
})

import { ThemeProvider } from '../theme/theme-context'
import { claudeEase, TODO_PILL_FADE_MS } from './claude-motion-spec'
import { MobileNativeChatSessionBar } from './MobileNativeChatSessionBar'

const PLAN: NativeChatTaskList = {
  tasks: [
    { content: 'Scaffold the app', status: 'completed' },
    { content: 'Build the screens', status: 'in_progress', activeForm: 'Building the screens' },
    { content: 'QA pass', status: 'pending' }
  ]
}

const flat = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...([] as unknown[]).concat(style).flat(Infinity).filter(Boolean))

let renderer: ReactTestRenderer | null = null

function bar(list: NativeChatTaskList | null, scheme: 'light' | 'dark', diff = false) {
  return (
    <ThemeProvider initialPreference={scheme}>
      <MobileNativeChatSessionBar
        list={list}
        diff={diff ? { files: 1, added: 4, removed: 1 } : null}
        onOpenDiff={diff ? () => undefined : undefined}
      />
    </ThemeProvider>
  )
}
function mount(
  list: NativeChatTaskList | null,
  scheme: 'light' | 'dark' = 'light',
  diff = false
): void {
  act(() => {
    renderer = create(bar(list, scheme, diff))
  })
}
function update(
  list: NativeChatTaskList | null,
  scheme: 'light' | 'dark' = 'light',
  diff = false
): void {
  act(() => renderer!.update(bar(list, scheme, diff)))
}
const byTestId = (id: string): ReactTestInstance[] =>
  renderer!.root.findAll((node) => node.props.testID === id && typeof node.type === 'string')
const fadeOf = (): ReactTestInstance[] =>
  renderer!.root.findAll(
    (node) => node.props.testID === 'todo-pill-fade' && typeof node.type === 'string'
  )
const pillAlpha = (): unknown => flat(fadeOf()[0]!.props.style).opacity

beforeEach(() => {
  seen.timings.length = 0
  seen.reduced = false
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe.each([
  ['light', lightColors],
  ['dark', darkColors]
] as const)('the todo pill in a %s session', (scheme, palette) => {
  it('fades in over 150 ms on the Claude curve when a plan arrives while the screen is open', () => {
    mount(null, scheme)
    expect(byTestId('todo-pill')).toHaveLength(0)
    update(PLAN, scheme)
    expect(byTestId('todo-pill')).toHaveLength(1)
    expect(seen.timings).toEqual([
      { to: 1, config: { duration: TODO_PILL_FADE_MS, easing: claudeEase } }
    ])
    expect(TODO_PILL_FADE_MS).toBe(150)
    expect(flat(byTestId('todo-pill')[0]!.props.style({ pressed: false })).borderColor).toBe(
      palette.border
    )
  })

  it('is drawn clear on its first frame, and full once the tween has run', () => {
    mount(null, scheme)
    update(PLAN, scheme)
    // The stand-in lands a tween at once, but the frame already drawn is the one it started from.
    expect(pillAlpha()).toBe(0)
    update({ tasks: [...PLAN.tasks] }, scheme)
    expect(pillAlpha()).toBe(1)
  })
})

describe('when the pill does not fade', () => {
  it('shows a plan that is already there when the screen opens at once, with no tween', () => {
    mount(PLAN)
    expect(byTestId('todo-pill')).toHaveLength(1)
    expect(seen.timings).toEqual([])
    expect(fadeOf().length === 0 || pillAlpha() === 1).toBe(true)
  })

  it('brings the pill back at once when the todo card is closed', () => {
    mount(PLAN)
    act(() => byTestId('todo-pill')[0]!.props.onPress())
    expect(byTestId('todo-pill')).toHaveLength(0)
    act(() =>
      renderer!.root.find((node) => node.props.accessibilityLabel === 'Close').props.onPress()
    )
    expect(byTestId('todo-pill')).toHaveLength(1)
    expect(seen.timings).toEqual([])
  })

  it('takes the pill away at once when the plan goes, with no exit tween', () => {
    mount(null)
    update(PLAN)
    seen.timings.length = 0
    update(null)
    expect(byTestId('todo-pill')).toHaveLength(0)
    expect(seen.timings).toEqual([])
  })

  it('fades each new plan in, after the last one went', () => {
    mount(null)
    update(PLAN)
    update(null)
    update(PLAN)
    expect(seen.timings).toHaveLength(2)
  })

  it.each([true, null])('shows an arriving plan at once while reduced motion is %s', (reduced) => {
    seen.reduced = reduced
    mount(null)
    update(PLAN)
    expect(byTestId('todo-pill')).toHaveLength(1)
    // `null` is the OS not having said yet: an entrance does not wait, so it plays.
    expect(seen.timings).toHaveLength(reduced === null ? 1 : 0)
  })

  it('leaves the diff pill beside it alone: it is not what the app fades', () => {
    mount(null, 'light', true)
    update(PLAN, 'light', true)
    expect(byTestId('diff-pill')).toHaveLength(1)
    expect(seen.timings).toHaveLength(1)
    const fade = fadeOf()[0]!
    expect(fade.findAll((node) => node.props.testID === 'diff-pill')).toEqual([])
  })

  it('draws a plan of one task, and an empty plan not at all', () => {
    mount(null)
    update({ tasks: [{ content: 'Only', status: 'pending' }] })
    expect(byTestId('todo-pill')).toHaveLength(1)
    update({ tasks: [] })
    expect(byTestId('todo-pill')).toHaveLength(0)
  })
})
