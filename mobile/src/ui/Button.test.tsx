import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default }
}))

import { Button } from './Button'

function render(props: Parameters<typeof Button>[0]): ReactTestRenderer {
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(createElement(Button, props))
  })
  return renderer!
}

function alignSelfOf(element: ReactTestRenderer): string | undefined {
  const node = element.root.findAll((n) => Array.isArray(n.props.style) || typeof n.props.style === 'object')[0]
  const styles = ([] as unknown[]).concat(node?.props.style ?? [])
  const merged = Object.assign({}, ...styles.filter(Boolean).map((s) => (Array.isArray(s) ? Object.assign({}, ...s) : s)))
  return merged.alignSelf
}

// Seen on the Galaxy S23 (2026-09-09): the empty workspace's "New tab" button
// sat at the left edge under centred text, because the button pinned itself to
// flex-start whatever its parent asked. The fix is a prop, so nothing else moves.
describe('Button alignment', () => {
  it('hugs the start by default so existing compact buttons stay put', () => {
    expect(alignSelfOf(render({ label: 'Retry' }))).toBe('flex-start')
  })

  it('follows a centred parent when asked, on any screen width', () => {
    expect(alignSelfOf(render({ label: 'New tab', align: 'center' }))).toBe('center')
  })

  it('still stretches when block, whatever align says', () => {
    expect(alignSelfOf(render({ label: 'Pair', block: true, align: 'center' }))).toBe('stretch')
  })
})

/** The style React Native finally paints: nested arrays flattened, later
 *  entries winning, as StyleSheet.flatten does. PressScale appends its animated
 *  style after the button's own; Reanimated keeps that entry's first-render
 *  values in place in the array (PropsFilter, reanimated 4.5.1), which the
 *  shared test double reproduces by returning the factory's output. */
function paintedStyle(element: ReactTestRenderer): Record<string, unknown> {
  const node = element.root.findAll((n) => (n.type as unknown) === 'Pressable')[0]
  const flatten = (style: unknown): Record<string, unknown> =>
    Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : ((style ?? {}) as Record<string, unknown>)
  return flatten(node?.props.style)
}

// Every disabled Button drew at full strength: PressScale's press style
// carried `opacity: 1` at rest and sat after the button's `opacity: 0.5`, so
// the dim never reached the screen. A Submit waiting on an unanswered question,
// or on its own send, looked exactly like a live one and its tap did nothing
// visible (ask card, reported 2026-09-25 and 2026-09-28).
describe('a disabled Button', () => {
  it('reads as disabled: the press spring does not paint over its dim', () => {
    expect(paintedStyle(render({ label: 'Submit', disabled: true })).opacity).toBe(0.5)
  })

  it('and an enabled one stays at full strength', () => {
    expect(paintedStyle(render({ label: 'Submit' })).opacity ?? 1).toBe(1)
  })

  it('a loading one is not dimmed: its spinner is the feedback', () => {
    expect(paintedStyle(render({ label: 'Sending…', loading: true })).opacity ?? 1).toBe(1)
  })
})
